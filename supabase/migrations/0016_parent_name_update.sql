-- DJIGIT TAU CRM · 0016 · Родитель по телефону: если он уже есть и указано ФИО — ФИО обновляется.
-- Отдельной страницы «Родители» больше нет: ФИО родителя правится в карточке ученика.
-- Обновляет только сотрудник с доступом к филиалу родителя (как и правка родителя напрямую).
create or replace function public.find_or_create_parent(p_name text, p_phone text, p_branch uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.parents;
begin
  if not private.clients(p_branch) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  if private.norm_phone(p_phone) is null or length(private.norm_phone(p_phone)) < 11 then
    raise exception 'Укажите телефон родителя полностью';
  end if;
  select * into r from public.parents where phone_norm = private.norm_phone(p_phone);
  if r.id is null then
    if coalesce(trim(p_name), '') = '' then raise exception 'Укажите ФИО родителя'; end if;
    insert into public.parents (full_name, phone, branch_id) values (trim(p_name), trim(p_phone), p_branch) returning * into r;
  elsif coalesce(trim(p_name), '') <> '' and trim(p_name) <> r.full_name and private.clients(r.branch_id) then
    update public.parents set full_name = trim(p_name) where id = r.id;
  end if;
  return r.id;
end $$;
