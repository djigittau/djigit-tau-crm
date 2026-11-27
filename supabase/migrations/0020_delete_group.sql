-- DJIGIT TAU CRM · 0020 · Удаление группы офисом филиала.
-- Группу с отмеченной посещаемостью удалить нельзя (история занятий и учеников) — только перевести в архив.
-- Иначе удаляются её занятия, записи учеников в группу, дни и тренеры; ученики остаются без группы, пробники — без группы.
create function public.delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.groups where id = p_group;
  if b is null then raise exception 'Группа не найдена'; end if;
  if not private.office(b) then raise exception 'Нет доступа к группе' using errcode = '42501'; end if;
  if exists (select 1 from public.attendance a join public.lessons l on l.id = a.lesson_id where l.group_id = p_group) then
    raise exception 'В группе уже отмечена посещаемость — удалить нельзя. Переведите группу в архив.';
  end if;
  delete from public.lessons where group_id = p_group;
  delete from public.group_members where group_id = p_group;
  delete from public.groups where id = p_group; -- group_slots, group_trainers — каскадом; trial_leads.group_id → null
end $$;

revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;
