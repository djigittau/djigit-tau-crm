-- DJIGIT TAU CRM · 0001 · Основная схема: типы, таблицы, связи, ограничения, индексы.
-- Права доступа (RLS) — в 0002, триггеры и серверные функции — в 0003.

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

-- ---------- типы ----------
create type public.app_role          as enum ('director','manager','admin','sales','trainer');
create type public.employee_status   as enum ('active','blocked','deactivated');
create type public.student_status    as enum ('active','frozen','left');
create type public.gender            as enum ('male','female');
create type public.group_status      as enum ('active','archived');
create type public.lesson_status     as enum ('scheduled','completed','cancelled');
create type public.attendance_status as enum ('present','absent','excused','makeup');
create type public.trial_status      as enum ('new','contacted','booked','attended','thinking','bought','refused');
create type public.payment_method    as enum ('kaspi','halyk','cash','card','transfer','other');
create type public.accrual_status    as enum ('draft','approved','paid');

-- Телефон к виду 7XXXXXXXXXX, чтобы находить родителя при повторной заявке.
create function private.norm_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d = '' then null
    when length(d) = 11 and left(d, 1) = '8' then '7' || substr(d, 2)
    when length(d) = 10 then '7' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

-- ---------- сотрудники и филиалы ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text,
  phone       text,
  role        public.app_role not null,
  status      public.employee_status not null default 'active',
  photo_url   text,
  hired_at    date default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  address     text,
  phone       text,
  manager_id  uuid references public.profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Назначение сотрудника на филиал. Оклад — по филиалу, чтобы зарплата была привязана к филиалу.
create table public.employee_branches (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  base_salary  numeric(12,2) not null default 0 check (base_salary >= 0),
  created_at   timestamptz not null default now(),
  primary key (profile_id, branch_id)
);
create index employee_branches_branch_idx on public.employee_branches(branch_id);

create table public.dance_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  is_active  boolean not null default true
);

-- ---------- родители и ученики ----------
create table public.parents (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text not null,
  phone2      text,
  phone_norm  text generated always as (private.norm_phone(phone)) stored,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  comment     text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index parents_phone_norm_key on public.parents(phone_norm);
create index parents_branch_idx on public.parents(branch_id);

create table public.students (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null check (length(trim(full_name)) > 0),
  birth_date     date,
  gender         public.gender,
  parent_id      uuid references public.parents(id) on delete restrict,
  branch_id      uuid not null references public.branches(id) on delete restrict,
  dance_type_id  uuid references public.dance_types(id) on delete set null,
  start_date     date default current_date,
  status         public.student_status not null default 'active',
  comment        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index students_branch_idx on public.students(branch_id);
create index students_parent_idx on public.students(parent_id);

-- ---------- группы, расписание, занятия ----------
create table public.groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  branch_id      uuid not null references public.branches(id) on delete restrict,
  dance_type_id  uuid references public.dance_types(id) on delete set null,
  age_category   text,
  duration_min   int not null default 60 check (duration_min between 15 and 300),
  capacity       int check (capacity > 0),
  status         public.group_status not null default 'active',
  created_at     timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.group_trainers (
  group_id    uuid not null references public.groups(id) on delete cascade,
  trainer_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, trainer_id)
);
create index group_trainers_trainer_idx on public.group_trainers(trainer_id);

-- Дни и время занятий группы (1 = понедельник … 7 = воскресенье).
create table public.group_slots (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),
  start_time  time not null,
  unique (group_id, weekday, start_time)
);

-- Состав группы с историей переходов: строка закрывается left_at, новая открывается в другой группе.
create table public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete restrict,
  student_id  uuid not null references public.students(id) on delete cascade,
  joined_at   date not null default current_date,
  left_at     date,
  check (left_at is null or left_at >= joined_at)
);
create unique index group_members_active_key on public.group_members(group_id, student_id) where left_at is null;
create index group_members_student_idx on public.group_members(student_id);

create table public.lessons (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete restrict,
  branch_id      uuid not null references public.branches(id) on delete restrict,
  trainer_id     uuid references public.profiles(id) on delete set null,
  starts_at      timestamptz not null,
  duration_min   int not null check (duration_min between 15 and 300),
  status         public.lesson_status not null default 'scheduled',
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  unique (group_id, starts_at)
);
create index lessons_branch_time_idx on public.lessons(branch_id, starts_at);
create index lessons_trainer_time_idx on public.lessons(trainer_id, starts_at);

-- Одна отметка на ученика на занятии.
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  status      public.attendance_status not null,
  note        text,
  marked_by   uuid references public.profiles(id) on delete set null,
  marked_at   timestamptz not null default now(),
  unique (lesson_id, student_id)
);
create index attendance_student_idx on public.attendance(student_id);

-- ---------- смены ----------
create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_min  int generated always as (
                  case when ended_at is null then null
                       else (extract(epoch from (ended_at - started_at)) / 60)::int end) stored,
  note          text,
  adjusted_by   uuid references public.profiles(id) on delete set null,
  adjusted_at   timestamptz,
  check (ended_at is null or ended_at > started_at)
);
create unique index shifts_one_open_key on public.shifts(profile_id) where ended_at is null;
create index shifts_branch_time_idx on public.shifts(branch_id, started_at);

-- ---------- пробные занятия ----------
create table public.trial_leads (
  id                uuid primary key default gen_random_uuid(),
  parent_id         uuid references public.parents(id) on delete set null,
  student_id        uuid references public.students(id) on delete set null,
  parent_name       text,
  child_name        text not null check (length(trim(child_name)) > 0),
  child_birth_date  date,
  phone             text,
  branch_id         uuid references public.branches(id) on delete restrict,
  group_id          uuid references public.groups(id) on delete set null,
  dance_type_id     uuid references public.dance_types(id) on delete set null,
  manager_id        uuid references public.profiles(id) on delete set null default auth.uid(),
  source            text,
  trial_at          timestamptz,
  status            public.trial_status not null default 'new',
  comment           text,
  refusal_reason    text,
  result            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index trial_leads_branch_status_idx on public.trial_leads(branch_id, status);
create index trial_leads_manager_idx on public.trial_leads(manager_id);
create index trial_leads_trial_at_idx on public.trial_leads(trial_at);

-- История пробника: смены статуса, комментарии, задачи и напоминания.
create table public.trial_events (
  id             uuid primary key default gen_random_uuid(),
  trial_lead_id  uuid not null references public.trial_leads(id) on delete cascade,
  kind           text not null check (kind in ('status','comment','task','system')),
  from_status    public.trial_status,
  to_status      public.trial_status,
  text           text,
  due_at         timestamptz,
  done           boolean not null default false,
  author_id      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index trial_events_lead_idx on public.trial_events(trial_lead_id, created_at);
create index trial_events_open_tasks_idx on public.trial_events(due_at) where kind = 'task' and not done;

-- ---------- продажи и платежи ----------
-- Продажа абонемента. Полная цена, скидка и к оплате — отдельно; деньги — в payments.
create table public.sales (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students(id) on delete restrict,
  parent_id      uuid references public.parents(id) on delete set null,
  branch_id      uuid not null references public.branches(id) on delete restrict,
  trial_lead_id  uuid references public.trial_leads(id) on delete set null,
  manager_id     uuid references public.profiles(id) on delete set null default auth.uid(),
  dance_type_id  uuid references public.dance_types(id) on delete set null,
  title          text not null check (length(trim(title)) > 0),
  lessons_total  int check (lessons_total > 0),
  price          numeric(12,2) not null check (price >= 0),
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  amount_due     numeric(12,2) generated always as (price - discount) stored,
  valid_from     date not null default current_date,
  valid_to       date,
  status         text not null default 'active' check (status in ('active','cancelled')),
  created_at     timestamptz not null default now(),
  check (discount <= price),
  check (valid_to is null or valid_to >= valid_from)
);
create index sales_branch_time_idx on public.sales(branch_id, created_at);
create index sales_student_idx on public.sales(student_id);
create index sales_manager_idx on public.sales(manager_id);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid references public.sales(id) on delete restrict,
  student_id       uuid references public.students(id) on delete restrict,
  parent_id        uuid references public.parents(id) on delete set null,
  branch_id        uuid not null references public.branches(id) on delete restrict,
  kind             text not null default 'payment' check (kind in ('payment','refund')),
  purpose          text not null default 'subscription' check (purpose in ('subscription','trial','other')),
  amount           numeric(12,2) not null check (amount > 0),
  method           public.payment_method not null,
  paid_at          timestamptz not null default now(),
  received_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  comment          text,
  idempotency_key  text unique,
  created_at       timestamptz not null default now()
);
create index payments_branch_time_idx on public.payments(branch_id, paid_at);
create index payments_student_idx on public.payments(student_id);
create index payments_sale_idx on public.payments(sale_id);

-- ---------- зарплата, бонусы, штрафы ----------
create table public.bonuses (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null check (length(trim(reason)) > 0),
  given_on    date not null default current_date,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index bonuses_profile_idx on public.bonuses(profile_id, given_on);

create table public.fines (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null check (length(trim(reason)) > 0),
  fined_on    date not null default current_date,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index fines_profile_idx on public.fines(profile_id, fined_on);

-- Зарплата = Оклад + Оплачиваемые занятия × Ставка + Бонусы − Штрафы.
create table public.salary_accruals (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete restrict,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  period          date not null check (extract(day from period) = 1),
  base_amount     numeric(12,2) not null default 0 check (base_amount >= 0),
  lessons_count   int not null default 0 check (lessons_count >= 0),
  lesson_rate     numeric(12,2) not null default 0 check (lesson_rate >= 0),
  lessons_amount  numeric(12,2) generated always as (lessons_count * lesson_rate) stored,
  bonus_amount    numeric(12,2) not null default 0 check (bonus_amount >= 0),
  fine_amount     numeric(12,2) not null default 0 check (fine_amount >= 0),
  total           numeric(12,2) generated always as (base_amount + lessons_count * lesson_rate + bonus_amount - fine_amount) stored,
  status          public.accrual_status not null default 'draft',
  comment         text,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, branch_id, period)
);
create index salary_accruals_branch_period_idx on public.salary_accruals(branch_id, period);

create table public.salary_payments (
  id               uuid primary key default gen_random_uuid(),
  accrual_id       uuid references public.salary_accruals(id) on delete restrict,
  profile_id       uuid not null references public.profiles(id) on delete restrict,
  branch_id        uuid not null references public.branches(id) on delete restrict,
  amount           numeric(12,2) not null check (amount > 0),
  method           public.payment_method not null default 'transfer',
  paid_on          date not null default current_date,
  paid_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  comment          text,
  idempotency_key  text unique,
  created_at       timestamptz not null default now()
);
create index salary_payments_branch_idx on public.salary_payments(branch_id, paid_on);

-- ---------- расходы и страховка ----------
create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null unique check (length(trim(name)) > 0),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete restrict,
  category_id     uuid not null references public.expense_categories(id) on delete restrict,
  amount          numeric(12,2) not null check (amount > 0),
  spent_on        date not null default current_date,
  method          public.payment_method,
  responsible_id  uuid references public.profiles(id) on delete set null,
  comment         text,
  related_ref     text,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index expenses_branch_time_idx on public.expenses(branch_id, spent_on);
create index expenses_category_idx on public.expenses(category_id);

create table public.employee_insurance (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete restrict,
  branch_id      uuid not null references public.branches(id) on delete restrict,
  provider       text,
  policy_number  text,
  amount         numeric(12,2) not null default 0 check (amount >= 0),
  valid_from     date,
  valid_to       date,
  paid_on        date,
  comment        text,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index employee_insurance_branch_idx on public.employee_insurance(branch_id, paid_on);

-- ---------- настройки и amoCRM ----------
create table public.crm_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table public.amocrm_mappings (
  id              uuid primary key default gen_random_uuid(),
  entity          text not null check (entity in ('contact','lead','task','user','pipeline','status','note')),
  external_id     bigint not null,
  internal_table  text,
  internal_id     uuid,
  raw             jsonb,
  synced_at       timestamptz not null default now(),
  unique (entity, external_id)
);
create index amocrm_mappings_internal_idx on public.amocrm_mappings(internal_table, internal_id);

create table public.amocrm_sync_logs (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind in ('initial','periodic','webhook','manual','oauth')),
  status         text not null default 'running' check (status in ('running','ok','error')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  items_in       int not null default 0,
  items_created  int not null default 0,
  items_updated  int not null default 0,
  error          text,
  details        jsonb
);

-- Каждое событие webhook обрабатывается один раз (event_key уникален).
create table public.amocrm_webhook_events (
  id            bigint generated always as identity primary key,
  event_key     text not null unique,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'pending' check (status in ('pending','ok','error','skipped')),
  error         text,
  payload       jsonb not null
);

-- Токены amoCRM: только в закрытой схеме, API их не отдаёт. Секрет клиента — в переменных Edge Functions.
create table private.amocrm_credentials (
  id             int primary key default 1 check (id = 1),
  domain         text,
  access_token   text,
  refresh_token  text,
  expires_at     timestamptz,
  updated_at     timestamptz not null default now()
);

-- ---------- журнал действий ----------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  public.app_role,
  action      text not null,
  entity      text not null,
  entity_id   text,
  branch_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip          text
);
create index audit_logs_at_idx on public.audit_logs(at desc);
create index audit_logs_entity_idx on public.audit_logs(entity, entity_id);
create index audit_logs_branch_idx on public.audit_logs(branch_id, at desc);
