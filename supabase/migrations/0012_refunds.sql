-- DJIGIT TAU CRM · 0012 · Возврат денег клиенту.
-- Возврат — отдельная запись payments (kind = 'refund') по продаже. Оформляет только директор или управляющий филиала,
-- с причиной, не больше оплаченного по этой продаже. Полный возврат закрывает абонемент. Платёж по-прежнему не удаляется.
create function private.guard_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.sales; paid numeric;
begin
  if new.kind <> 'refund' then return new; end if;
  if not private.boss(new.branch_id) then raise exception 'Возврат оформляет директор или управляющий филиала'; end if;
  if new.sale_id is null then raise exception 'Возврат оформляется по продаже'; end if;
  if coalesce(trim(new.comment), '') = '' then raise exception 'Укажите причину возврата'; end if;
  select * into s from public.sales where id = new.sale_id for update;
  if s.branch_id <> new.branch_id then raise exception 'Возврат не совпадает с филиалом продажи'; end if;
  select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into paid from public.payments where sale_id = new.sale_id;
  if new.amount > paid then
    raise exception 'Возврат больше оплаченного: можно вернуть %', replace(to_char(round(paid), 'FM999,999,999,990'), ',', ' ') || ' ₸';
  end if;
  -- Вернули всё — абонемент закрыт.
  if new.amount = paid then update public.sales set status = 'cancelled' where id = s.id; end if;
  new.student_id := s.student_id;
  new.parent_id := s.parent_id;
  return new;
end $$;
create trigger guard before insert on public.payments for each row execute function private.guard_payment();
