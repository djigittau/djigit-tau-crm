-- DJIGIT TAU CRM · 0011 · Сообщение о переплате зарплаты — сумма в виде денег («41 000 ₸», а не «41000.00»).
create or replace function private.guard_salary_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.salary_accruals; paid numeric;
begin
  if new.accrual_id is null then return new; end if;
  select * into a from public.salary_accruals where id = new.accrual_id for update;
  if a.status = 'draft' then raise exception 'Сначала утвердите начисление'; end if;
  if a.profile_id <> new.profile_id or a.branch_id <> new.branch_id then raise exception 'Выплата не совпадает с начислением'; end if;
  select coalesce(sum(amount), 0) into paid from public.salary_payments where accrual_id = new.accrual_id;
  if paid + new.amount > a.total then
    raise exception 'Выплата больше начисленного: осталось %', replace(to_char(round(a.total - paid), 'FM999,999,999,990'), ',', ' ') || ' ₸';
  end if;
  return new;
end $$;
