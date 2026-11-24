-- =====================================================================
-- ТЗ v2, этап 1: архитектура БД под 5 ролей.
-- Роли в базе: owner = Директор, manager = Управляющий, admin = Администратор,
--              sales = Отдел продаж, teacher = Тренер.
-- Только добавления: существующие таблицы и функции не удаляются.
-- =====================================================================

-- ---------- 1. Справочник ролей (подписи для интерфейса) ----------
create table if not exists public.roles (
  code  public.app_role primary key,
  title text not null,
  sort  smallint not null
);
insert into public.roles (code, title, sort) values
  ('owner','Директор',1), ('manager','Управляющий',2), ('admin','Администратор',3),
  ('sales','Отдел продаж',4), ('teacher','Тренер',5)
on conflict (code) do update set title = excluded.title, sort = excluded.sort;
alter table public.roles enable row level security;
create policy roles_select on public.roles for select to authenticated using (true);

-- ---------- 2. Хелперы прав: Управляющий получает права администратора + контроль ----------
create or replace function private.manager(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['owner','manager','admin']::public.app_role[]) and private.has_branch(b)
$$;
create or replace function private.office(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['owner','manager','admin','sales']::public.app_role[]) and private.has_branch(b)
$$;
create or replace function private.office_any() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['owner','manager','admin','sales']::public.app_role[])
$$;
-- boss = Директор или Управляющий своего филиала (согласование, исправления, удаление)
create or replace function private.boss(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['owner','manager']::public.app_role[]) and private.has_branch(b)
$$;
create or replace function private.staff_any() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['owner','manager','admin']::public.app_role[])
$$;
revoke all on function private.boss(uuid), private.staff_any() from public, anon;
grant execute on function private.boss(uuid), private.staff_any() to authenticated;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role_txt text; v_role public.app_role;
begin
  v_role_txt := nullif(trim(new.raw_app_meta_data->>'role'), '');
  if v_role_txt is not null and v_role_txt not in ('owner','manager','admin','sales','teacher') then
    v_role_txt := null;
  end if;
  v_role := v_role_txt::public.app_role;
  insert into public.profiles (id, full_name, phone, role, is_active, email)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 200),
          left(new.raw_user_meta_data->>'phone', 32),
          v_role, v_role is not null, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- 3. Профили сотрудников (employees) и филиалы ----------
alter table public.profiles
  add column if not exists email text,
  add column if not exists photo_url text,
  add column if not exists position text,
  add column if not exists hired_on date,
  add column if not exists personal_note text,
  add column if not exists must_change_password boolean not null default false;

alter table public.branches
  add column if not exists admin_id uuid references public.profiles(id) on delete set null,
  add column if not exists manager_id uuid references public.profiles(id) on delete set null;
create index if not exists branches_admin_idx on public.branches(admin_id);
create index if not exists branches_manager_idx on public.branches(manager_id);

-- ---------- 4. Посещаемость: комментарий и причина; права по матрице ТЗ ----------
alter table public.attendance
  add column if not exists comment text,
  add column if not exists reason text;
-- Админ: только просмотр; отдел продаж: нет доступа; тренер: свои группы.
drop policy if exists att_select on public.attendance;
drop policy if exists att_insert on public.attendance;
drop policy if exists att_update on public.attendance;
drop policy if exists att_delete on public.attendance;
create policy att_select on public.attendance for select to authenticated
  using (private.manager(private.lesson_branch(lesson_id)) or private.teaches_lesson(lesson_id));
create policy att_insert on public.attendance for insert to authenticated
  with check (private.boss(private.lesson_branch(lesson_id)) or private.teaches_lesson(lesson_id));
create policy att_update on public.attendance for update to authenticated
  using (private.boss(private.lesson_branch(lesson_id)) or private.teaches_lesson(lesson_id))
  with check (private.boss(private.lesson_branch(lesson_id)) or private.teaches_lesson(lesson_id));
create policy att_delete on public.attendance for delete to authenticated
  using (private.boss(private.lesson_branch(lesson_id)));

-- ---------- 5. Справочники: виды танца и категории (пустые, заполняет студия) ----------
create table if not exists public.dance_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists dance_types_name_uq on public.dance_types (lower(name));
create table if not exists public.lesson_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists lesson_categories_name_uq on public.lesson_categories (lower(name));
alter table public.dance_types enable row level security;
alter table public.lesson_categories enable row level security;
create policy dance_types_select on public.dance_types for select to authenticated using ((select private.my_role()) is not null);
create policy dance_types_write on public.dance_types for all to authenticated using ((select private.staff_any())) with check ((select private.staff_any()));
create policy lesson_categories_select on public.lesson_categories for select to authenticated using ((select private.my_role()) is not null);
create policy lesson_categories_write on public.lesson_categories for all to authenticated using ((select private.staff_any())) with check ((select private.staff_any()));

-- ---------- 6. Пробные занятия + история ----------
do $$ begin
  create type public.trial_status as enum ('new','awaiting','confirmed','attended','no_show','thinking','bought','refused');
exception when duplicate_object then null; end $$;

create table if not exists public.trial_lessons (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  student_name text not null check (length(trim(student_name)) between 1 and 200),
  parent_name text,
  phone text not null check (length(trim(phone)) between 5 and 32),
  age smallint check (age between 2 and 90),
  category_id uuid references public.lesson_categories(id) on delete set null,
  dance_type_id uuid references public.dance_types(id) on delete set null,
  trial_date date,
  trial_time time,
  group_id uuid references public.groups(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  manager_id uuid references public.profiles(id) on delete set null,
  status public.trial_status not null default 'new',
  refusal_reason text,
  callback_at timestamptz,
  comment text,
  student_id uuid references public.students(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_refusal_reason check (status <> 'refused' or nullif(trim(refusal_reason), '') is not null)
);
create index if not exists trial_branch_status_idx on public.trial_lessons (branch_id, status);
create index if not exists trial_manager_idx on public.trial_lessons (manager_id);
create index if not exists trial_date_idx on public.trial_lessons (trial_date);
create index if not exists trial_group_idx on public.trial_lessons (group_id);
create index if not exists trial_teacher_idx on public.trial_lessons (teacher_id);
create index if not exists trial_category_idx on public.trial_lessons (category_id);
create index if not exists trial_dance_idx on public.trial_lessons (dance_type_id);
create index if not exists trial_student_idx on public.trial_lessons (student_id);
create index if not exists trial_created_by_idx on public.trial_lessons (created_by);

create table if not exists public.trial_status_history (
  id bigint generated always as identity primary key,
  trial_id uuid not null references public.trial_lessons(id) on delete cascade,
  kind text not null check (kind in ('create','status','comment','call','reschedule','transfer')),
  from_status public.trial_status,
  to_status public.trial_status,
  body text,
  author_id uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists trial_hist_trial_idx on public.trial_status_history (trial_id, created_at);
create index if not exists trial_hist_author_idx on public.trial_status_history (author_id);

create or replace function private.trial_branch(t uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select branch_id from public.trial_lessons where id = t
$$;

create or replace function private.trial_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.trial_status_history (trial_id, kind, to_status, body, author_id)
    values (new.id, 'create', new.status, new.comment, auth.uid());
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.trial_status_history (trial_id, kind, from_status, to_status, body, author_id)
    values (new.id, 'status', old.status, new.status,
            case when new.status = 'refused' then new.refusal_reason end, auth.uid());
  end if;
  if (new.trial_date, new.trial_time) is distinct from (old.trial_date, old.trial_time) then
    insert into public.trial_status_history (trial_id, kind, body, author_id)
    values (new.id, 'reschedule',
            coalesce(old.trial_date::text,'—')||' '||coalesce(left(old.trial_time::text,5),'')||' → '||
            coalesce(new.trial_date::text,'—')||' '||coalesce(left(new.trial_time::text,5),''), auth.uid());
  end if;
  if new.manager_id is distinct from old.manager_id then
    insert into public.trial_status_history (trial_id, kind, body, author_id)
    values (new.id, 'transfer',
            coalesce((select full_name from public.profiles where id = old.manager_id),'—')||' → '||
            coalesce((select full_name from public.profiles where id = new.manager_id),'—'), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists trial_lessons_log on public.trial_lessons;
create trigger trial_lessons_log after insert or update on public.trial_lessons
  for each row execute function private.trial_log();
drop trigger if exists touch_trial_lessons on public.trial_lessons;
create trigger touch_trial_lessons before update on public.trial_lessons
  for each row execute function private.touch_updated_at();

alter table public.trial_lessons enable row level security;
alter table public.trial_status_history enable row level security;
create policy trial_select on public.trial_lessons for select to authenticated using (private.office(branch_id));
create policy trial_insert on public.trial_lessons for insert to authenticated with check (private.office(branch_id));
create policy trial_update on public.trial_lessons for update to authenticated using (private.office(branch_id)) with check (private.office(branch_id));
create policy trial_delete on public.trial_lessons for delete to authenticated using (private.boss(branch_id));
-- История только дописывается: вручную можно добавить комментарий или звонок.
create policy trial_hist_select on public.trial_status_history for select to authenticated
  using (private.office(private.trial_branch(trial_id)));
create policy trial_hist_insert on public.trial_status_history for insert to authenticated
  with check (kind in ('comment','call') and author_id = (select auth.uid()) and private.office(private.trial_branch(trial_id)));

-- ---------- 7. Смены сотрудников (рабочее время тренеров и продаж) ----------
create table if not exists public.shift_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  plan_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, plan_date, start_time)
);
create index if not exists shift_plans_branch_date_idx on public.shift_plans (branch_id, plan_date);
create index if not exists shift_plans_created_by_idx on public.shift_plans (created_by);

create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  plan_id uuid references public.shift_plans(id) on delete set null,
  planned_start timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  late_minutes integer generated always as (
    case when planned_start is null or started_at <= planned_start then 0
         else floor(extract(epoch from (started_at - planned_start)) / 60)::integer end) stored,
  hours numeric(6,2) generated always as (
    case when ended_at is null then null
         else round((extract(epoch from (ended_at - started_at)) / 3600)::numeric, 2) end) stored,
  note text,
  corrected_by uuid references public.profiles(id) on delete set null,
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint work_shift_order check (ended_at is null or ended_at > started_at)
);
create unique index if not exists work_shifts_one_open on public.work_shifts (profile_id) where ended_at is null;
create index if not exists work_shifts_profile_idx on public.work_shifts (profile_id, started_at desc);
create index if not exists work_shifts_branch_idx on public.work_shifts (branch_id, started_at desc);
create index if not exists work_shifts_plan_idx on public.work_shifts (plan_id);
create index if not exists work_shifts_ended_by_idx on public.work_shifts (ended_by);
create index if not exists work_shifts_corrected_by_idx on public.work_shifts (corrected_by);

-- Закрытую смену может исправить только Директор или Управляющий; исправление помечается.
create or replace function private.guard_work_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.shift_rpc', true) = 'on' then
    return new;  -- закрытие своей смены через end_shift()
  end if;
  if not private.boss(old.branch_id) then
    raise exception 'Изменять зафиксированные смены может только директор или управляющий';
  end if;
  new.corrected_by := auth.uid();
  new.corrected_at := now();
  return new;
end $$;
drop trigger if exists work_shifts_guard on public.work_shifts;
create trigger work_shifts_guard before update on public.work_shifts
  for each row execute function private.guard_work_shift();

alter table public.shift_plans enable row level security;
alter table public.work_shifts enable row level security;
create policy shift_plans_select on public.shift_plans for select to authenticated
  using (profile_id = (select auth.uid()) or private.manager(branch_id));
create policy shift_plans_write on public.shift_plans for all to authenticated
  using (private.manager(branch_id)) with check (private.manager(branch_id));
-- Своя смена — видна себе; Админ/Управляющий/Директор — контроль по филиалу.
create policy work_shifts_select on public.work_shifts for select to authenticated
  using (profile_id = (select auth.uid()) or private.manager(branch_id));
create policy work_shifts_update on public.work_shifts for update to authenticated
  using (private.boss(branch_id)) with check (private.boss(branch_id));
create policy work_shifts_delete on public.work_shifts for delete to authenticated
  using ((select private.is_owner()));
-- Вставка только через start_shift(): чтобы время начала ставил сервер, а не браузер.

create or replace function public.start_shift(p_branch uuid)
returns public.work_shifts language plpgsql security definer set search_path = '' as $$
declare v_plan public.shift_plans; v_row public.work_shifts; v_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if private.my_role() is null then raise exception 'Нет доступа'; end if;
  if not private.has_branch(p_branch) then raise exception 'Нет доступа к этому филиалу'; end if;
  if exists (select 1 from public.work_shifts where profile_id = auth.uid() and ended_at is null) then
    raise exception 'Смена уже начата';
  end if;
  select * into v_plan from public.shift_plans
   where profile_id = auth.uid() and branch_id = p_branch and plan_date = v_today
   order by start_time limit 1;
  insert into public.work_shifts (profile_id, branch_id, plan_id, planned_start)
  values (auth.uid(), p_branch, v_plan.id,
          case when v_plan.id is null then null
               else (v_plan.plan_date + v_plan.start_time) at time zone 'Asia/Almaty' end)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.end_shift(p_note text default null)
returns public.work_shifts language plpgsql security definer set search_path = '' as $$
declare v_row public.work_shifts;
begin
  perform set_config('app.shift_rpc', 'on', true);
  update public.work_shifts set ended_at = now(), ended_by = auth.uid(), note = coalesce(p_note, note)
   where profile_id = auth.uid() and ended_at is null
  returning * into v_row;
  perform set_config('app.shift_rpc', 'off', true);
  if v_row.id is null then raise exception 'Нет открытой смены'; end if;
  return v_row;
end $$;
revoke all on function public.start_shift(uuid), public.end_shift(text) from public, anon;
grant execute on function public.start_shift(uuid), public.end_shift(text) to authenticated;

-- Пропущенные смены: план есть, смены в этот день нет (день уже прошёл).
create or replace view public.shift_misses with (security_invoker = on) as
select p.id plan_id, p.profile_id, p.branch_id, p.plan_date, p.start_time, p.end_time
from public.shift_plans p
where p.plan_date < (now() at time zone 'Asia/Almaty')::date
  and not exists (
    select 1 from public.work_shifts w
     where w.profile_id = p.profile_id
       and (w.started_at at time zone 'Asia/Almaty')::date = p.plan_date);

-- ---------- 8. Расходы: категории, аренда, коммуналка, страховка, прочие, штрафы ----------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('utility','extra')),
  name text not null check (length(trim(name)) between 1 and 100),
  is_system boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists expense_categories_uq on public.expense_categories (scope, lower(name));
create index if not exists expense_categories_created_by_idx on public.expense_categories (created_by);
-- Виды коммунальных услуг перечислены в ТЗ — это структура, а не данные студии.
insert into public.expense_categories (scope, name, is_system, created_by) values
  ('utility','Электричество',true,null), ('utility','Вода',true,null), ('utility','Отопление',true,null),
  ('utility','Интернет',true,null), ('utility','Уборка',true,null), ('utility','Вывоз мусора',true,null),
  ('utility','Прочие коммунальные расходы',true,null)
on conflict do nothing;

-- Согласование: менять статус согласования может только Директор или Управляющий.
create or replace function private.guard_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.approval_status <> 'pending' and not private.boss(new.branch_id) then
      new.approval_status := 'pending'; new.approved_by := null; new.approved_at := null;
    end if;
  elsif new.approval_status is distinct from old.approval_status then
    if not private.boss(new.branch_id) then
      raise exception 'Согласовывать расходы может только директор или управляющий';
    end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

create table if not exists public.rent (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  address text,
  landlord text,
  amount numeric(12,2) not null check (amount >= 0),
  pay_date date,
  period_from date,
  period_to date,
  pay_status text not null default 'unpaid' check (pay_status in ('unpaid','partial','paid')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  comment text,
  paid_tx_id uuid references public.transactions(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_to is null or period_from is null or period_to >= period_from)
);
create table if not exists public.utilities (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  category_id uuid not null references public.expense_categories(id),
  amount numeric(12,2) not null check (amount >= 0),
  period_month date,
  pay_date date,
  pay_status text not null default 'unpaid' check (pay_status in ('unpaid','partial','paid')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  comment text,
  paid_tx_id uuid references public.transactions(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.insurance (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company text not null,
  amount numeric(12,2) not null check (amount >= 0),
  period_from date,
  period_to date,
  pay_date date,
  pay_status text not null default 'unpaid' check (pay_status in ('unpaid','partial','paid')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  comment text,
  paid_tx_id uuid references public.transactions(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  title text not null check (length(trim(title)) between 1 and 200),
  category_id uuid references public.expense_categories(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  spent_on date not null default ((now() at time zone 'Asia/Almaty')::date),
  responsible_id uuid references public.profiles(id) on delete set null,
  comment text,
  pay_status text not null default 'unpaid' check (pay_status in ('unpaid','partial','paid')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_tx_id uuid references public.transactions(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type public.fine_status as enum ('assigned','disputed','withheld','cancelled');
exception when duplicate_object then null; end $$;
create table if not exists public.fines (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position text,
  reason text not null check (length(trim(reason)) between 1 and 500),
  amount numeric(12,2) not null check (amount >= 0),
  fined_on date not null default ((now() at time zone 'Asia/Almaty')::date),
  assigned_by uuid default auth.uid() references public.profiles(id) on delete set null,
  status public.fine_status not null default 'assigned',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Индексы по внешним ключам и фильтрам
create index if not exists rent_branch_idx on public.rent (branch_id, pay_date);
create index if not exists rent_approved_by_idx on public.rent (approved_by);
create index if not exists rent_tx_idx on public.rent (paid_tx_id);
create index if not exists rent_created_by_idx on public.rent (created_by);
create index if not exists utilities_branch_idx on public.utilities (branch_id, period_month);
create index if not exists utilities_category_idx on public.utilities (category_id);
create index if not exists utilities_approved_by_idx on public.utilities (approved_by);
create index if not exists utilities_tx_idx on public.utilities (paid_tx_id);
create index if not exists utilities_created_by_idx on public.utilities (created_by);
create index if not exists insurance_branch_idx on public.insurance (branch_id, pay_date);
create index if not exists insurance_profile_idx on public.insurance (profile_id);
create index if not exists insurance_approved_by_idx on public.insurance (approved_by);
create index if not exists insurance_tx_idx on public.insurance (paid_tx_id);
create index if not exists insurance_created_by_idx on public.insurance (created_by);
create index if not exists expenses_branch_idx on public.expenses (branch_id, spent_on);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists expenses_responsible_idx on public.expenses (responsible_id);
create index if not exists expenses_approved_by_idx on public.expenses (approved_by);
create index if not exists expenses_tx_idx on public.expenses (paid_tx_id);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists fines_branch_idx on public.fines (branch_id, fined_on);
create index if not exists fines_profile_idx on public.fines (profile_id, fined_on desc);
create index if not exists fines_assigned_by_idx on public.fines (assigned_by);

-- Триггеры: согласование, updated_at, журнал действий
do $$ declare t text; begin
  foreach t in array array['rent','utilities','insurance','expenses'] loop
    execute format('drop trigger if exists %1$s_approval on public.%1$s', t);
    execute format('create trigger %1$s_approval before insert or update on public.%1$s for each row execute function private.guard_approval()', t);
  end loop;
  foreach t in array array['fines'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function private.touch_updated_at()', t);
  end loop;
  foreach t in array array['rent','utilities','insurance','expenses','fines','expense_categories',
                           'trial_lessons','work_shifts','shift_plans','dance_types','lesson_categories',
                           'attendance','branches'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function private.audit()', t);
  end loop;
end $$;

-- RLS: расходы, зарплаты, штрафы — Админ/Управляющий своего филиала и Директор.
-- Тренер и отдел продаж доступа не имеют. Удаляют только Директор и Управляющий.
alter table public.expense_categories enable row level security;
alter table public.rent enable row level security;
alter table public.utilities enable row level security;
alter table public.insurance enable row level security;
alter table public.expenses enable row level security;
alter table public.fines enable row level security;

create policy expense_categories_select on public.expense_categories for select to authenticated using ((select private.staff_any()));
create policy expense_categories_insert on public.expense_categories for insert to authenticated
  with check ((select private.staff_any()) and not is_system);
create policy expense_categories_update on public.expense_categories for update to authenticated
  using ((select private.has_role(array['owner','manager']::public.app_role[])) and not is_system)
  with check (not is_system);
create policy expense_categories_delete on public.expense_categories for delete to authenticated
  using ((select private.has_role(array['owner','manager']::public.app_role[])) and not is_system);

do $$ declare t text; begin
  foreach t in array array['rent','utilities','insurance','expenses','fines'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.manager(branch_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.manager(branch_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.manager(branch_id)) with check (private.manager(branch_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.boss(branch_id))', t);
  end loop;
end $$;

-- Задолженности по расходам (неоплаченные записи всех реестров)
create or replace view public.expense_debts with (security_invoker = on) as
  select 'rent'::text kind, id, branch_id, coalesce(landlord, 'Аренда') title, amount, pay_date due_date, pay_status from public.rent where pay_status <> 'paid'
  union all
  select 'utility', u.id, u.branch_id, c.name, u.amount, u.pay_date, u.pay_status
    from public.utilities u join public.expense_categories c on c.id = u.category_id where u.pay_status <> 'paid'
  union all
  select 'insurance', id, branch_id, company, amount, pay_date, pay_status from public.insurance where pay_status <> 'paid'
  union all
  select 'expense', id, branch_id, title, amount, spent_on, pay_status from public.expenses where pay_status <> 'paid';

-- ---------- 9. Зарплаты: поля ТЗ поверх существующих расчётных листов ----------
alter table public.payslips
  add column if not exists position text,
  add column if not exists pay_date date;
create or replace view public.salaries with (security_invoker = on) as
  select s.id, s.month, s.branch_id, s.profile_id, s.teacher_id, s.person_name, s.position,
         s.base as salary, s.bonus as extra_pay, s.deduct as deductions, s.advance,
         (s.base + s.bonus - s.deduct - s.advance) as to_pay, s.pay_date, s.status
    from public.payslips s;

-- ---------- 10. Права на таблицы и представления ----------
do $$ declare t text; begin
  foreach t in array array['roles','dance_types','lesson_categories','trial_lessons','trial_status_history',
                           'shift_plans','work_shifts','expense_categories','rent','utilities','insurance',
                           'expenses','fines'] loop
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;
revoke all on public.shift_misses, public.expense_debts, public.salaries from anon;
grant select on public.shift_misses, public.expense_debts, public.salaries to authenticated;
revoke insert, update, delete on public.roles from authenticated;
revoke update, delete on public.trial_status_history from authenticated;
revoke insert on public.work_shifts from authenticated;
