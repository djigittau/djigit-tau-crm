-- DJIGIT TAU CRM · 0013 · Зарплата тренера — процент от абонементов; профиль сотрудника.
-- Тренер: свой % от оплат абонементов учеников его групп за месяц (минус возвраты) + бонусы − штрафы. Без оклада и ставки за занятие.
-- Остальные сотрудники: оклад по филиалу + бонусы − штрафы.
-- Оплата относится к группе, в которой ученик был на дату начала абонемента; у группы с двумя тренерами — поровну.

alter table public.profiles
  add column birth_date date,
  add column bio text check (length(bio) <= 2000),
  add column salary_percent numeric(5,2) check (salary_percent between 0 and 100);

insert into public.crm_settings (key, value) values ('trainer_percent', '0') on conflict (key) do nothing;

alter table public.salary_accruals
  add column sales_amount numeric(12,2) not null default 0,
  add column percent numeric(5,2) not null default 0 check (percent between 0 and 100),
  add column percent_amount numeric(12,2) generated always as (round(sales_amount * percent / 100, 2)) stored;
alter table public.salary_accruals drop column total;
alter table public.salary_accruals add column total numeric(12,2) generated always as
  (base_amount + lessons_count * lesson_rate + round(sales_amount * percent / 100, 2) + bonus_amount - fine_amount) stored;

-- Утверждённое начисление: суммы меняет только директор (добавлены поля процента).
create or replace function private.guard_accruals() returns trigger
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
    if old.status <> 'draft' and not private.is_director() and not (
         old.status = 'approved' and new.status = 'paid' and private.boss(new.branch_id)
         and (new.base_amount, new.lessons_count, new.lesson_rate, new.sales_amount, new.percent, new.bonus_amount, new.fine_amount, new.comment)
             is not distinct from (old.base_amount, old.lessons_count, old.lesson_rate, old.sales_amount, old.percent, old.bonus_amount, old.fine_amount, old.comment)) then
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

-- Оплаты абонементов (минус возвраты) за месяц, приходящиеся на тренера в филиале.
create function private.trainer_sales(p_trainer uuid, p_branch uuid, m0 date, m1 date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(
    (case when pay.kind = 'refund' then -pay.amount else pay.amount end)
    / (select count(*) from public.group_members gm2 join public.groups g2 on g2.id = gm2.group_id
        where gm2.student_id = s.student_id and g2.branch_id = s.branch_id
          and gm2.joined_at <= s.valid_from and (gm2.left_at is null or gm2.left_at > s.valid_from))
    / (select count(*) from public.group_trainers gt2 where gt2.group_id = gm.group_id)
  ), 0)
  from public.payments pay
  join public.sales s on s.id = pay.sale_id
  join public.group_members gm on gm.student_id = s.student_id
    and gm.joined_at <= s.valid_from and (gm.left_at is null or gm.left_at > s.valid_from)
  join public.groups g on g.id = gm.group_id and g.branch_id = s.branch_id
  join public.group_trainers gt on gt.group_id = gm.group_id and gt.trainer_id = p_trainer
  where s.branch_id = p_branch
    and private.local_date(pay.paid_at) >= m0 and private.local_date(pay.paid_at) < m1
$$;

drop function public.salary_preview(date, uuid);
create function public.salary_preview(p_period date, p_branch uuid)
returns table (profile_id uuid, full_name text, role public.app_role, base_amount numeric, lessons_count int,
               lesson_rate numeric, sales_amount numeric, percent numeric, bonus_amount numeric, fine_amount numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  with per as (
    select date_trunc('month', p_period)::date as m0, (date_trunc('month', p_period) + interval '1 month')::date as m1),
  def as (
    select coalesce((select (value #>> '{}')::numeric from public.crm_settings where key = 'trainer_percent'), 0) as v),
  x as (
    select p.id, p.full_name, p.role,
      case when p.role = 'trainer' then 0 else eb.base_salary end as base,
      (select count(*)::int from public.lessons l
        where l.trainer_id = p.id and l.branch_id = p_branch and l.status in ('scheduled','completed')
          and private.local_date(l.starts_at) >= per.m0 and private.local_date(l.starts_at) < per.m1) as lc,
      case when p.role = 'trainer' then round(private.trainer_sales(p.id, p_branch, per.m0, per.m1), 2) else 0 end as sales,
      case when p.role = 'trainer' then coalesce(p.salary_percent, def.v) else 0 end as pct,
      (select coalesce(sum(amount), 0) from public.bonuses b
        where b.profile_id = p.id and b.branch_id = p_branch and b.given_on >= per.m0 and b.given_on < per.m1) as bonus,
      (select coalesce(sum(amount), 0) from public.fines f
        where f.profile_id = p.id and f.branch_id = p_branch and f.fined_on >= per.m0 and f.fined_on < per.m1) as fine
    from public.employee_branches eb join public.profiles p on p.id = eb.profile_id, per, def
    where eb.branch_id = p_branch and private.office(p_branch))
  select id, full_name, role, base, lc, 0::numeric, sales, pct, bonus, fine, base + round(sales * pct / 100, 2) + bonus - fine from x
$$;

-- Черновики начислений по новой формуле. Утверждённые не трогает. Ставка за занятие больше не начисляется (0).
create or replace function public.accrue_salaries(p_period date, p_branch uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.office(p_branch) then raise exception 'Нет доступа к филиалу' using errcode = '42501'; end if;
  insert into public.salary_accruals as a (profile_id, branch_id, period, base_amount, lessons_count, lesson_rate,
                                           sales_amount, percent, bonus_amount, fine_amount, created_by)
  select s.profile_id, p_branch, date_trunc('month', p_period)::date, s.base_amount, s.lessons_count, 0,
         s.sales_amount, s.percent, s.bonus_amount, s.fine_amount, auth.uid()
  from public.salary_preview(p_period, p_branch) s
  on conflict (profile_id, branch_id, period) do update set
    base_amount = excluded.base_amount, lessons_count = excluded.lessons_count, lesson_rate = 0,
    sales_amount = excluded.sales_amount, percent = excluded.percent,
    bonus_amount = excluded.bonus_amount, fine_amount = excluded.fine_amount
  where a.status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.salary_preview(date, uuid) from public, anon;
grant execute on function public.salary_preview(date, uuid) to authenticated;
revoke all on function private.trainer_sales(uuid, uuid, date, date) from public, anon;

-- Свой профиль: телефон, фото, дата рождения, «О себе». Роль, филиалы, процент и дату приёма меняет директор.
drop function public.update_my_profile(text, text);
create function public.update_my_profile(p_phone text, p_photo_url text, p_birth_date date, p_bio text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare r public.profiles;
begin
  if private.my_role() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.profiles set phone = nullif(trim(p_phone), ''), photo_url = nullif(trim(p_photo_url), ''),
         birth_date = p_birth_date, bio = nullif(trim(p_bio), '')
  where id = auth.uid() returning * into r;
  return r;
end $$;
revoke all on function public.update_my_profile(text, text, date, text) from public, anon;
grant execute on function public.update_my_profile(text, text, date, text) to authenticated;
