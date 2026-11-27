-- DJIGIT TAU CRM · 0019 · Филиалы: часы работы; администратор и управляющий добавляют и меняют свои филиалы и прикрепляют тренеров.
-- Удалять филиал, менять управляющего и закрывать филиал — по-прежнему только директор.

-- Часы работы: массив из 7 элементов (Пн…Вс), каждый ["10:00","21:00"] или null (выходной).
alter table public.branches add column hours jsonb
  check (hours is null or (jsonb_typeof(hours) = 'array' and jsonb_array_length(hours) = 7));

-- Сохранить филиал вместе с тренерами. p_id null — новый филиал (создатель-не директор прикрепляется к нему сам).
-- p_trainers — полный список тренеров филиала: недостающие прикрепляются, снятые открепляются.
create function public.save_branch(p_id uuid, p_name text, p_address text, p_phone text, p_hours jsonb, p_trainers uuid[],
  p_manager uuid default null, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid := p_id; dir boolean := private.is_director();
begin
  if not private.role_in('{director,manager,admin}') then raise exception 'Нет прав'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Введите название филиала'; end if;
  if p_hours is not null and (jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7) then
    raise exception 'Неверный формат часов работы';
  end if;
  if b is null then
    insert into public.branches (name, address, phone, hours, manager_id, is_active)
    values (trim(p_name), nullif(trim(p_address), ''), nullif(trim(p_phone), ''), p_hours,
            case when dir then p_manager end, case when dir then coalesce(p_active, true) else true end)
    returning id into b;
    if not dir then
      insert into public.employee_branches (profile_id, branch_id) values (auth.uid(), b);
    end if;
  else
    if not private.office(b) then raise exception 'Нет доступа к филиалу'; end if;
    update public.branches set name = trim(p_name), address = nullif(trim(p_address), ''), phone = nullif(trim(p_phone), ''),
      hours = p_hours,
      manager_id = case when dir then p_manager else manager_id end,
      is_active = case when dir then coalesce(p_active, is_active) else is_active end
    where id = b;
  end if;

  if p_trainers is not null then
    if exists (select 1 from unnest(p_trainers) t where not exists (
      select 1 from public.profiles p where p.id = t and p.role = 'trainer' and p.status = 'active')) then
      raise exception 'Можно прикрепить только действующего тренера';
    end if;
    delete from public.employee_branches eb using public.profiles p
    where eb.branch_id = b and p.id = eb.profile_id and p.role = 'trainer' and not (eb.profile_id = any(p_trainers));
    insert into public.employee_branches (profile_id, branch_id)
    select t, b from unnest(p_trainers) t on conflict do nothing;
  end if;
  return b;
end $$;

-- Все действующие тренеры студии для выбора в филиал (офис не видит тренеров чужих филиалов напрямую).
-- branches — только те филиалы тренера, что видны вызывающему.
create function public.branch_trainer_options() returns table (id uuid, full_name text, branches uuid[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name,
         coalesce(array_agg(eb.branch_id) filter (where eb.branch_id is not null and private.office(eb.branch_id)), '{}')
  from public.profiles p
  left join public.employee_branches eb on eb.profile_id = p.id
  where p.role = 'trainer' and p.status = 'active' and private.role_in('{director,manager,admin}')
  group by p.id, p.full_name
  order by p.full_name
$$;

revoke all on function public.save_branch(uuid, text, text, text, jsonb, uuid[], uuid, boolean), public.branch_trainer_options() from public, anon;
grant execute on function public.save_branch(uuid, text, text, text, jsonb, uuid[], uuid, boolean), public.branch_trainer_options() to authenticated;
