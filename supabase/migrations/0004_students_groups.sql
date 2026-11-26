-- DJIGIT TAU CRM · 0004 · Ученики и группы: родитель без дублей, перевод между группами.

-- Находит родителя по телефону (8 701… = +7 701…) или создаёт нового. Дубль не появится,
-- даже если родитель записан в другом филиале и сотруднику не виден.
create function public.find_or_create_parent(p_name text, p_phone text, p_branch uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  if not private.clients(p_branch) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  if private.norm_phone(p_phone) is null or length(private.norm_phone(p_phone)) < 11 then
    raise exception 'Укажите телефон родителя полностью';
  end if;
  select id into r from public.parents where phone_norm = private.norm_phone(p_phone);
  if r is null then
    if coalesce(trim(p_name), '') = '' then raise exception 'Укажите имя родителя'; end if;
    insert into public.parents (full_name, phone, branch_id) values (trim(p_name), trim(p_phone), p_branch) returning id into r;
  end if;
  return r;
end $$;

-- Переводит ученика в группу: текущее членство закрывается сегодняшней датой, история сохраняется.
-- p_group = null — просто вывести из группы.
create function public.move_student_group(p_student uuid, p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.students; g public.groups; cnt int;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not private.clients(s.branch_id) then raise exception 'Нет доступа к ученику' using errcode = '42501'; end if;
  if p_group is not null then
    select * into g from public.groups where id = p_group;
    if g.id is null or g.branch_id <> s.branch_id then raise exception 'Группа должна быть в филиале ученика'; end if;
    if g.status <> 'active' then raise exception 'Группа в архиве'; end if;
    if exists (select 1 from public.group_members where student_id = p_student and group_id = p_group and left_at is null) then
      return;
    end if;
    select count(*) into cnt from public.group_members where group_id = p_group and left_at is null;
    if g.capacity is not null and cnt >= g.capacity then raise exception 'Группа заполнена (% из %)', cnt, g.capacity; end if;
  end if;
  update public.group_members set left_at = current_date where student_id = p_student and left_at is null
    and (p_group is null or group_id <> p_group);
  if p_group is not null then
    insert into public.group_members (group_id, student_id, joined_at) values (p_group, p_student, current_date);
  end if;
end $$;

revoke all on function public.find_or_create_parent(text, text, uuid), public.move_student_group(uuid, uuid) from public, anon;
grant execute on function public.find_or_create_parent(text, text, uuid), public.move_student_group(uuid, uuid) to authenticated;
