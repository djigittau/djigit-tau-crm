-- DJIGIT TAU CRM · 0005 · Продажа абонемента одним действием.
-- Пробник → ученик → группа → продажа → платёж → статус «Купил абонемент». Всё в одной транзакции.

-- Ключ повтора: повторное нажатие «Продать» с тем же ключом вернёт уже созданную продажу.
alter table public.sales add column idempotency_key text unique;

create function public.buy_subscription(
  p_trial uuid, p_student uuid, p_group uuid, p_title text, p_lessons int,
  p_price numeric, p_discount numeric, p_paid numeric, p_method public.payment_method, p_key text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.trial_leads; s public.students; sid uuid := p_student; r uuid;
begin
  if p_key is not null then
    select id into r from public.sales where idempotency_key = p_key;
    if r is not null then return r; end if;
  end if;

  if p_trial is not null then
    select * into t from public.trial_leads where id = p_trial;
    if t.id is null or not private.can_trial(t.branch_id) then raise exception 'Нет доступа к пробнику' using errcode = '42501'; end if;
    if t.branch_id is null then raise exception 'Укажите филиал в пробнике'; end if;
    sid := coalesce(sid, t.student_id);
    if sid is null then
      insert into public.students (full_name, birth_date, parent_id, branch_id, dance_type_id)
      values (t.child_name, t.child_birth_date, t.parent_id, t.branch_id, t.dance_type_id) returning id into sid;
    end if;
  end if;

  select * into s from public.students where id = sid;
  if s.id is null or not private.clients(s.branch_id) then raise exception 'Нет доступа к ученику' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Укажите название абонемента'; end if;
  if p_lessons is not null and p_lessons <= 0 then raise exception 'Количество занятий должно быть больше нуля'; end if;
  if p_price is null or p_price < 0 or coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > p_price then
    raise exception 'Проверьте цену и скидку';
  end if;
  if coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > p_price - coalesce(p_discount, 0) then
    raise exception 'Оплата больше суммы к оплате';
  end if;

  if p_group is not null then perform public.move_student_group(sid, p_group); end if;

  insert into public.sales (student_id, parent_id, branch_id, trial_lead_id, manager_id, dance_type_id,
                            title, lessons_total, price, discount, idempotency_key)
  values (sid, s.parent_id, s.branch_id, p_trial,
          case when private.my_role() = 'sales' then auth.uid() else coalesce(t.manager_id, auth.uid()) end,
          s.dance_type_id, trim(p_title), p_lessons, p_price, coalesce(p_discount, 0), p_key)
  returning id into r;

  if coalesce(p_paid, 0) > 0 then
    insert into public.payments (sale_id, student_id, parent_id, branch_id, amount, method, received_by, idempotency_key)
    values (r, sid, s.parent_id, s.branch_id, p_paid, p_method, auth.uid(), p_key);
  end if;

  if p_trial is not null then
    update public.trial_leads set status = 'bought', student_id = sid, refusal_reason = null where id = p_trial;
  end if;
  return r;
end $$;

revoke all on function public.buy_subscription(uuid, uuid, uuid, text, int, numeric, numeric, numeric, public.payment_method, text) from public, anon;
grant execute on function public.buy_subscription(uuid, uuid, uuid, text, int, numeric, numeric, numeric, public.payment_method, text) to authenticated;
