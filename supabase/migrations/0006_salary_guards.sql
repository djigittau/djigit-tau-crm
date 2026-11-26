-- DJIGIT TAU CRM · 0006 · Зарплата: закрытие начисления управляющим и проверка выплат.

-- Утверждённое начисление: суммы меняет только директор; управляющий может лишь отметить «Выплачено».
create or replace function private.guard_accruals() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;  -- серверные задачи
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not private.is_director() then raise exception 'Удалить можно только черновик'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' and not private.boss(new.branch_id) then
    raise exception 'Утверждает управляющий или директор';
  end if;
  if tg_op = 'UPDATE' then
    if (new.profile_id, new.branch_id, new.period) is distinct from (old.profile_id, old.branch_id, old.period) then
      raise exception 'Нельзя менять сотрудника, филиал или месяц начисления';
    end if;
    if old.status <> 'draft' and not private.is_director() and not (
         old.status = 'approved' and new.status = 'paid' and private.boss(new.branch_id)
         and (new.base_amount, new.lessons_count, new.lesson_rate, new.bonus_amount, new.fine_amount, new.comment)
             is not distinct from (old.base_amount, old.lessons_count, old.lesson_rate, old.bonus_amount, old.fine_amount, old.comment)) then
      raise exception 'Утверждённое начисление может изменить только директор';
    end if;
    if new.status <> old.status and new.status <> 'draft' and not private.boss(new.branch_id) then
      raise exception 'Утверждает управляющий или директор';
    end if;
    if new.status = 'approved' and old.status = 'draft' then new.approved_by := auth.uid(); end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Выплата: только по утверждённому начислению того же сотрудника и филиала, не больше начисленного.
create function private.guard_salary_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.salary_accruals; paid numeric;
begin
  if new.accrual_id is null then return new; end if;
  select * into a from public.salary_accruals where id = new.accrual_id for update;
  if a.status = 'draft' then raise exception 'Сначала утвердите начисление'; end if;
  if a.profile_id <> new.profile_id or a.branch_id <> new.branch_id then raise exception 'Выплата не совпадает с начислением'; end if;
  select coalesce(sum(amount), 0) into paid from public.salary_payments where accrual_id = new.accrual_id;
  if paid + new.amount > a.total then raise exception 'Выплата больше начисленного: осталось %', a.total - paid; end if;
  return new;
end $$;
create trigger guard before insert on public.salary_payments for each row execute function private.guard_salary_payment();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
