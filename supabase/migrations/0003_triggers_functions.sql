-- DJIGIT TAU CRM · 0003 · Триггеры целостности, журнал действий, серверные функции, справочники.

create function private.tz() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.crm_settings where key = 'timezone'), 'Asia/Almaty')
$$;

create function private.local_date(t timestamptz) returns date
language sql stable set search_path = '' as $$ select (t at time zone private.tz())::date $$;

-- ---------- журнал действий ----------
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb; r jsonb; b uuid; hdr json;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  r := coalesce(n, o);
  b := case when tg_table_name = 'branches' then (r ->> 'id')::uuid else (r ->> 'branch_id')::uuid end;
  if b is null and r ? 'lesson_id' then b := private.lesson_branch((r ->> 'lesson_id')::uuid); end if;
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then hdr := null;
  end;
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, branch_id, old_data, new_data, ip)
  values (auth.uid(), private.my_role(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'profile_id', r ->> 'key'), b, o, n,
          coalesce(hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip'));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','branches','employee_branches','parents','students','groups','group_trainers',
    'group_members','lessons','attendance','shifts','trial_leads','sales','payments','bonuses','fines',
    'salary_accruals','salary_payments','expenses','expense_categories','employee_insurance','crm_settings']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function private.audit()', t);
  end loop;
end $$;

create function private.touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger touch before update on public.students for each row execute function private.touch();
create trigger touch before update on public.trial_leads for each row execute function private.touch();
create trigger touch before update on public.expenses for each row execute function private.touch();

-- ---------- сотрудники ----------
create function private.guard_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id <> old.id then raise exception 'Нельзя менять идентификатор сотрудника'; end if;
  if old.role = 'director' and old.status = 'active' and (new.role <> 'director' or new.status <> 'active')
     and not exists (select 1 from public.profiles where role = 'director' and status = 'active' and id <> old.id) then
    raise exception 'Нельзя снять или заблокировать последнего директора';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard before update on public.profiles for each row execute function private.guard_profiles();

-- Управляющий филиала автоматически получает доступ к нему.
create function private.branch_manager_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_id is not null then
    if not exists (select 1 from public.profiles where id = new.manager_id and role in ('manager','director')) then
      raise exception 'Ответственным может быть только управляющий';
    end if;
    insert into public.employee_branches (profile_id, branch_id) values (new.manager_id, new.id)
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger manager_access after insert or update of manager_id on public.branches
  for each row execute function private.branch_manager_access();

-- Сотрудник меняет только свой телефон и фото; роль и статус — только директор.
create function public.update_my_profile(p_phone text, p_photo_url text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare r public.profiles;
begin
  if private.my_role() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.profiles set phone = nullif(trim(p_phone), ''), photo_url = nullif(trim(p_photo_url), '')
  where id = auth.uid() returning * into r;
  return r;
end $$;

-- ---------- посещаемость ----------
create function private.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.lessons; d date;
begin
  select * into l from public.lessons where id = new.lesson_id;
  if l.status = 'cancelled' then raise exception 'Занятие отменено: отметки не ставятся'; end if;
  if tg_op = 'UPDATE' and (new.lesson_id <> old.lesson_id or new.student_id <> old.student_id) then
    raise exception 'Отметку нельзя перенести на другое занятие или ученика';
  end if;
  d := private.local_date(l.starts_at);
  if new.status <> 'makeup' and not exists (
    select 1 from public.group_members m
    where m.group_id = l.group_id and m.student_id = new.student_id
      and m.joined_at <= d and (m.left_at is null or m.left_at >= d)) then
    raise exception 'Ученик не в этой группе. Для отработки выберите статус «Отработка»';
  end if;
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end $$;
create trigger guard before insert or update on public.attendance for each row execute function private.guard_attendance();

-- ---------- смены ----------
create function private.guard_shifts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id <> old.profile_id then raise exception 'Нельзя передать смену другому сотруднику'; end if;
  if new.started_at is distinct from old.started_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    new.adjusted_by := auth.uid();
    new.adjusted_at := now();
  end if;
  return new;
end $$;
create trigger guard before update on public.shifts for each row execute function private.guard_shifts();

create function public.start_shift(p_branch uuid default null) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare r public.shifts; b uuid := p_branch;
begin
  if private.my_role() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if b is null then
    select branch_id into b from public.employee_branches where profile_id = auth.uid() order by created_at limit 1;
  end if;
  if b is not null and not private.has_branch(b) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  if exists (select 1 from public.shifts where profile_id = auth.uid() and ended_at is null) then
    raise exception 'Сначала завершите открытую смену';
  end if;
  insert into public.shifts (profile_id, branch_id) values (auth.uid(), b) returning * into r;
  return r;
end $$;

create function public.end_shift(p_note text default null) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare r public.shifts;
begin
  if private.my_role() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.shifts set ended_at = greatest(now(), started_at + interval '1 minute'),
                           note = coalesce(nullif(trim(p_note), ''), note)
  where profile_id = auth.uid() and ended_at is null returning * into r;
  if r.id is null then raise exception 'Открытой смены нет'; end if;
  return r;
end $$;

-- ---------- пробники: родитель без дублей и история статусов ----------
create function private.trial_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is not null and new.parent_id is null then
    select id into new.parent_id from public.parents where phone_norm = private.norm_phone(new.phone);
    if new.parent_id is null and new.branch_id is not null and coalesce(trim(new.parent_name), '') <> '' then
      insert into public.parents (full_name, phone, branch_id) values (trim(new.parent_name), new.phone, new.branch_id)
      returning id into new.parent_id;
    end if;
  end if;
  if new.status = 'refused' and coalesce(trim(new.refusal_reason), '') = '' then
    raise exception 'Укажите причину отказа';
  end if;
  return new;
end $$;
create trigger before_write before insert or update on public.trial_leads for each row execute function private.trial_before();

create function private.trial_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.trial_events (trial_lead_id, kind, to_status, text, author_id)
    values (new.id, 'status', new.status, 'Заявка создана', auth.uid());
  elsif new.status <> old.status then
    insert into public.trial_events (trial_lead_id, kind, from_status, to_status, author_id)
    values (new.id, 'status', old.status, new.status, auth.uid());
  end if;
  return null;
end $$;
create trigger after_write after insert or update of status on public.trial_leads for each row execute function private.trial_after();

-- ---------- расходы: зарплата, страховка и бонусы ведутся в своих таблицах ----------
create function private.guard_expenses() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.expense_categories where id = new.category_id and code in ('salary','insurance','bonus')) then
    raise exception 'Эта статья ведётся в разделах «Зарплаты», «Медстраховка» и «Бонусы»';
  end if;
  return new;
end $$;
create trigger guard before insert or update on public.expenses for each row execute function private.guard_expenses();

-- ---------- зарплата ----------
create function private.guard_accruals() returns trigger
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
    if old.status <> 'draft' and not private.is_director() then
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
create trigger guard before insert or update or delete on public.salary_accruals
  for each row execute function private.guard_accruals();

-- Расчёт за месяц: Оклад + занятия (scheduled и completed, без cancelled) × единая ставка + бонусы − штрафы.
-- Посещаемость учеников на оплату тренера не влияет.
create function public.salary_preview(p_period date, p_branch uuid)
returns table (profile_id uuid, full_name text, role public.app_role, base_amount numeric, lessons_count int,
               lesson_rate numeric, bonus_amount numeric, fine_amount numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  with per as (
    select date_trunc('month', p_period)::date as m0, (date_trunc('month', p_period) + interval '1 month')::date as m1),
  rate as (
    select coalesce((select (value #>> '{}')::numeric from public.crm_settings where key = 'lesson_rate'), 0) as v),
  x as (
    select p.id, p.full_name, p.role, eb.base_salary,
      (select count(*)::int from public.lessons l
        where l.trainer_id = p.id and l.branch_id = p_branch and l.status in ('scheduled','completed')
          and private.local_date(l.starts_at) >= per.m0 and private.local_date(l.starts_at) < per.m1) as lc,
      rate.v,
      (select coalesce(sum(amount), 0) from public.bonuses b
        where b.profile_id = p.id and b.branch_id = p_branch and b.given_on >= per.m0 and b.given_on < per.m1) as bonus,
      (select coalesce(sum(amount), 0) from public.fines f
        where f.profile_id = p.id and f.branch_id = p_branch and f.fined_on >= per.m0 and f.fined_on < per.m1) as fine
    from public.employee_branches eb join public.profiles p on p.id = eb.profile_id, per, rate
    where eb.branch_id = p_branch and private.office(p_branch))
  select id, full_name, role, base_salary, lc, v, bonus, fine, base_salary + lc * v + bonus - fine from x
$$;

-- Создаёт или обновляет черновики начислений. Утверждённые не трогает.
create function public.accrue_salaries(p_period date, p_branch uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.office(p_branch) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  insert into public.salary_accruals as a (profile_id, branch_id, period, base_amount, lessons_count, lesson_rate,
                                           bonus_amount, fine_amount, created_by)
  select s.profile_id, p_branch, date_trunc('month', p_period)::date, s.base_amount, s.lessons_count, s.lesson_rate,
         s.bonus_amount, s.fine_amount, auth.uid()
  from public.salary_preview(p_period, p_branch) s
  on conflict (profile_id, branch_id, period) do update set
    base_amount = excluded.base_amount, lessons_count = excluded.lessons_count, lesson_rate = excluded.lesson_rate,
    bonus_amount = excluded.bonus_amount, fine_amount = excluded.fine_amount
  where a.status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- расписание: занятия по слотам групп ----------
create function public.generate_lessons(p_from date, p_to date, p_branch uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.office(p_branch) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 92 then raise exception 'Период — от 1 до 93 дней'; end if;
  insert into public.lessons (group_id, branch_id, trainer_id, starts_at, duration_min)
  select g.id, g.branch_id,
         (select t.trainer_id from public.group_trainers t where t.group_id = g.id order by t.trainer_id limit 1),
         (d::date + s.start_time) at time zone private.tz(), g.duration_min
  from public.groups g
  join public.group_slots s on s.group_id = g.id
  cross join generate_series(p_from, p_to, interval '1 day') d
  where g.branch_id = p_branch and g.status = 'active' and extract(isodow from d) = s.weekday
  on conflict (group_id, starts_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.update_my_profile(text, text), public.start_shift(uuid), public.end_shift(text),
  public.salary_preview(date, uuid), public.accrue_salaries(date, uuid), public.generate_lessons(date, date, uuid)
  from public, anon;
grant execute on function public.update_my_profile(text, text), public.start_shift(uuid), public.end_shift(text),
  public.salary_preview(date, uuid), public.accrue_salaries(date, uuid), public.generate_lessons(date, date, uuid)
  to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------- справочники ----------
insert into public.expense_categories (code, name, is_system) values
  ('rent',      'Аренда залов',           true),
  ('utilities', 'Коммунальные услуги',    true),
  ('extra',     'Дополнительные расходы', true),
  ('other',     'Прочие расходы',         true),
  ('salary',    'Зарплаты',               true),
  ('insurance', 'Медицинская страховка',  true),
  ('bonus',     'Бонусы',                 true);

insert into public.crm_settings (key, value) values
  ('timezone',    '"Asia/Almaty"'),
  ('currency',    '"KZT"'),
  ('lesson_rate', '0');
