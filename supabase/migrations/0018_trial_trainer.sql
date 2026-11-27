-- DJIGIT TAU CRM · 0018 · Пробный урок закрепляется за тренером; тренер видит свои пробники (без телефонов родителей).
alter table public.trial_leads add column trainer_id uuid references public.profiles(id) on delete set null;
create index trial_leads_trainer_idx on public.trial_leads(trainer_id, trial_at);

-- Тренер пробника — только активный тренер филиала заявки.
create function private.guard_trial_trainer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.trainer_id is not null and (tg_op = 'INSERT' or new.trainer_id is distinct from old.trainer_id) and not exists (
    select 1 from public.profiles p join public.employee_branches eb on eb.profile_id = p.id
    where p.id = new.trainer_id and p.role = 'trainer' and p.status = 'active' and eb.branch_id = new.branch_id) then
    raise exception 'Тренер не работает в филиале заявки';
  end if;
  return new;
end $$;
create trigger guard_trainer before insert or update on public.trial_leads for each row execute function private.guard_trial_trainer();

-- Тренеры филиала для формы пробника (продажи не видят назначения сотрудников напрямую). groups — группы тренера, чтобы подставить по группе.
create function public.trial_trainers(p_branch uuid) returns table (id uuid, full_name text, groups uuid[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, coalesce(array_agg(gt.group_id) filter (where gt.group_id is not null), '{}')
  from public.profiles p
  join public.employee_branches eb on eb.profile_id = p.id and eb.branch_id = p_branch
  left join public.group_trainers gt on gt.trainer_id = p.id
  where p.role = 'trainer' and p.status = 'active' and private.can_trial(p_branch)
  group by p.id, p.full_name
  order by p.full_name
$$;

-- Пробники тренера: закреплённые за ним или (если тренер не указан) в его группах. Без телефонов и данных оплаты.
create function public.my_trials() returns table (
  id uuid, child_name text, child_birth_date date, parent_name text, trial_at timestamptz, status public.trial_status,
  group_name text, branch_name text, dance_name text, manager_name text, comment text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.child_name, t.child_birth_date, t.parent_name, t.trial_at, t.status,
         g.name, b.name, d.name, m.full_name, t.comment
  from public.trial_leads t
  left join public.groups g on g.id = t.group_id
  left join public.branches b on b.id = t.branch_id
  left join public.dance_types d on d.id = t.dance_type_id
  left join public.profiles m on m.id = t.manager_id
  where private.my_role() = 'trainer'
    and (t.trainer_id = auth.uid()
         or (t.trainer_id is null and exists (select 1 from public.group_trainers gt where gt.group_id = t.group_id and gt.trainer_id = auth.uid())))
  order by t.trial_at nulls last, t.created_at desc
$$;

revoke all on function public.trial_trainers(uuid), public.my_trials() from public, anon;
grant execute on function public.trial_trainers(uuid), public.my_trials() to authenticated;
