-- DJIGIT TAU CRM · 0002 · Безопасность: проверка роли и филиала на уровне базы (RLS).
-- Кнопки во frontend лишь повторяют эти правила. Обойти их через API нельзя.
-- Директор — всё. Управляющий и администратор — назначенные филиалы.
-- Отдел продаж — пробники, родители, ученики и свои продажи в своих филиалах. Тренер — свои группы.

-- ---------- функции проверки (security definer: читают profiles в обход RLS, без рекурсии) ----------
create function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create function private.is_director() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'director', false)
$$;

create function private.role_in(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = any(roles), false)
$$;

-- Сотрудник назначен на филиал (директор — на все).
create function private.has_branch(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director() or (private.my_role() is not null and exists (
    select 1 from public.employee_branches where profile_id = auth.uid() and branch_id = b))
$$;

-- Офис филиала: директор, управляющий или администратор этого филиала.
create function private.office(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director() or (private.role_in('{manager,admin}') and private.has_branch(b))
$$;

-- Руководство филиала: директор или назначенный управляющий.
create function private.boss(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director() or (private.my_role() = 'manager' and private.has_branch(b))
$$;

-- Работа с клиентами филиала: офис + отдел продаж.
create function private.clients(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director() or (private.role_in('{manager,admin,sales}') and private.has_branch(b))
$$;

create function private.trains_group(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'trainer' and exists (
    select 1 from public.group_trainers where group_id = g and trainer_id = auth.uid())
$$;

create function private.trains_student(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'trainer' and exists (
    select 1 from public.group_members m join public.group_trainers t on t.group_id = m.group_id
    where m.student_id = s and m.left_at is null and t.trainer_id = auth.uid())
$$;

create function private.group_branch(g uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select branch_id from public.groups where id = g $$;

create function private.lesson_branch(l uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select branch_id from public.lessons where id = l $$;

create function private.lesson_group(l uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select group_id from public.lessons where id = l $$;

create function private.trial_branch(t uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select branch_id from public.trial_leads where id = t $$;

-- Пробник без филиала (например, из amoCRM) виден директору, офису и отделу продаж, чтобы его разобрать.
create function private.can_trial(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when b is null then private.role_in('{director,manager,admin,sales}') else private.clients(b) end
$$;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------- доступ к таблицам ----------
revoke all on all tables in schema private from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','branches','employee_branches','dance_types','parents','students','groups',
    'group_trainers','group_slots','group_members','lessons','attendance','shifts','trial_leads','trial_events',
    'sales','payments','bonuses','fines','salary_accruals','salary_payments','expense_categories','expenses',
    'employee_insurance','crm_settings','amocrm_mappings','amocrm_sync_logs','amocrm_webhook_events','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Журнал и интеграция пишутся только сервером (триггеры и Edge Functions).
revoke insert, update, delete on public.audit_logs, public.amocrm_mappings, public.amocrm_sync_logs,
  public.amocrm_webhook_events from authenticated;

-- profiles: сотрудник видит себя и коллег по своим филиалам. Менять роль и статус — только директор.
-- Аккаунты создаёт только Edge Function директора (service role), поэтому insert-политики нет.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or private.is_director() or (private.my_role() is not null and exists (
    select 1 from public.employee_branches a join public.employee_branches b on a.branch_id = b.branch_id
    where a.profile_id = profiles.id and b.profile_id = auth.uid())));
create policy profiles_update on public.profiles for update to authenticated
  using (private.is_director()) with check (private.is_director());

create policy branches_select on public.branches for select to authenticated using (private.has_branch(id));
create policy branches_write on public.branches for all to authenticated
  using (private.is_director()) with check (private.is_director());

create policy employee_branches_select on public.employee_branches for select to authenticated using (
  profile_id = auth.uid() or private.office(branch_id));
create policy employee_branches_write on public.employee_branches for all to authenticated
  using (private.is_director()) with check (private.is_director());

create policy dance_types_select on public.dance_types for select to authenticated using (private.my_role() is not null);
create policy dance_types_write on public.dance_types for all to authenticated
  using (private.role_in('{director,manager,admin}')) with check (private.role_in('{director,manager,admin}'));

-- родители и ученики
create policy parents_select on public.parents for select to authenticated using (
  private.clients(branch_id) or exists (select 1 from public.students s where s.parent_id = parents.id and private.clients(s.branch_id)));
create policy parents_insert on public.parents for insert to authenticated with check (private.clients(branch_id));
create policy parents_update on public.parents for update to authenticated
  using (private.clients(branch_id)) with check (private.clients(branch_id));
create policy parents_delete on public.parents for delete to authenticated using (private.is_director());

create policy students_select on public.students for select to authenticated using (
  private.clients(branch_id) or private.trains_student(id));
create policy students_insert on public.students for insert to authenticated with check (private.clients(branch_id));
create policy students_update on public.students for update to authenticated
  using (private.clients(branch_id)) with check (private.clients(branch_id));
create policy students_delete on public.students for delete to authenticated using (private.is_director());

-- группы и расписание: менять может офис филиала; тренер видит только свои группы
create policy groups_select on public.groups for select to authenticated using (
  private.clients(branch_id) or private.trains_group(id));
create policy groups_write on public.groups for all to authenticated
  using (private.office(branch_id)) with check (private.office(branch_id));

create policy group_trainers_select on public.group_trainers for select to authenticated using (
  private.clients(private.group_branch(group_id)) or trainer_id = auth.uid());
create policy group_trainers_write on public.group_trainers for all to authenticated
  using (private.office(private.group_branch(group_id))) with check (private.office(private.group_branch(group_id)));

create policy group_slots_select on public.group_slots for select to authenticated using (
  private.clients(private.group_branch(group_id)) or private.trains_group(group_id));
create policy group_slots_write on public.group_slots for all to authenticated
  using (private.office(private.group_branch(group_id))) with check (private.office(private.group_branch(group_id)));

create policy group_members_select on public.group_members for select to authenticated using (
  private.clients(private.group_branch(group_id)) or private.trains_group(group_id));
create policy group_members_write on public.group_members for all to authenticated
  using (private.clients(private.group_branch(group_id))) with check (private.clients(private.group_branch(group_id)));

create policy lessons_select on public.lessons for select to authenticated using (
  private.clients(branch_id) or private.trains_group(group_id));
create policy lessons_write on public.lessons for all to authenticated
  using (private.office(branch_id)) with check (private.office(branch_id));

-- посещаемость: тренер своей группы или офис филиала; удалить отметку может только директор
create policy attendance_select on public.attendance for select to authenticated using (
  private.clients(private.lesson_branch(lesson_id)) or private.trains_group(private.lesson_group(lesson_id)));
create policy attendance_insert on public.attendance for insert to authenticated with check (
  private.office(private.lesson_branch(lesson_id)) or private.trains_group(private.lesson_group(lesson_id)));
create policy attendance_update on public.attendance for update to authenticated
  using (private.office(private.lesson_branch(lesson_id)) or private.trains_group(private.lesson_group(lesson_id)))
  with check (private.office(private.lesson_branch(lesson_id)) or private.trains_group(private.lesson_group(lesson_id)));
create policy attendance_delete on public.attendance for delete to authenticated using (private.is_director());

-- смены: открываются и закрываются функциями start_shift/end_shift; время правит офис (не свои смены)
create policy shifts_select on public.shifts for select to authenticated using (
  profile_id = auth.uid() or private.office(branch_id));
create policy shifts_update on public.shifts for update to authenticated
  using (private.is_director() or (private.office(branch_id) and profile_id <> auth.uid()))
  with check (private.is_director() or (private.office(branch_id) and profile_id <> auth.uid()));
create policy shifts_delete on public.shifts for delete to authenticated using (private.is_director());

-- пробники
create policy trial_leads_select on public.trial_leads for select to authenticated using (private.can_trial(branch_id));
create policy trial_leads_insert on public.trial_leads for insert to authenticated with check (private.can_trial(branch_id));
create policy trial_leads_update on public.trial_leads for update to authenticated
  using (private.can_trial(branch_id)) with check (private.can_trial(branch_id));
create policy trial_leads_delete on public.trial_leads for delete to authenticated using (private.is_director());

create policy trial_events_select on public.trial_events for select to authenticated using (
  private.can_trial(private.trial_branch(trial_lead_id)));
create policy trial_events_insert on public.trial_events for insert to authenticated with check (
  private.can_trial(private.trial_branch(trial_lead_id)) and author_id = auth.uid());
create policy trial_events_update on public.trial_events for update to authenticated
  using (author_id = auth.uid() or private.office(private.trial_branch(trial_lead_id)))
  with check (private.can_trial(private.trial_branch(trial_lead_id)));
create policy trial_events_delete on public.trial_events for delete to authenticated using (private.is_director());

-- продажи и платежи: менеджер продаж видит свои; удалять нельзя никому (только отмена и возврат)
create policy sales_select on public.sales for select to authenticated using (
  private.office(branch_id) or (private.my_role() = 'sales' and manager_id = auth.uid() and private.has_branch(branch_id)));
create policy sales_insert on public.sales for insert to authenticated with check (private.clients(branch_id));
create policy sales_update on public.sales for update to authenticated
  using (private.boss(branch_id)) with check (private.boss(branch_id));

create policy payments_select on public.payments for select to authenticated using (
  private.office(branch_id) or (private.my_role() = 'sales' and private.has_branch(branch_id)
    and exists (select 1 from public.sales s where s.id = payments.sale_id and s.manager_id = auth.uid())));
create policy payments_insert on public.payments for insert to authenticated with check (
  private.clients(branch_id) and received_by = auth.uid());
create policy payments_update on public.payments for update to authenticated
  using (private.is_director()) with check (private.is_director());

-- бонусы и штрафы: сотрудник видит свои
create policy bonuses_select on public.bonuses for select to authenticated using (profile_id = auth.uid() or private.office(branch_id));
create policy bonuses_insert on public.bonuses for insert to authenticated with check (private.boss(branch_id));
create policy bonuses_update on public.bonuses for update to authenticated using (private.boss(branch_id)) with check (private.boss(branch_id));
create policy bonuses_delete on public.bonuses for delete to authenticated using (private.is_director());

create policy fines_select on public.fines for select to authenticated using (profile_id = auth.uid() or private.office(branch_id));
create policy fines_insert on public.fines for insert to authenticated with check (private.office(branch_id) and profile_id <> auth.uid());
create policy fines_update on public.fines for update to authenticated using (private.boss(branch_id)) with check (private.boss(branch_id));
create policy fines_delete on public.fines for delete to authenticated using (private.is_director());

-- зарплата: сотрудник видит свои начисления и выплаты; утверждённые меняет только директор (триггер в 0003)
create policy salary_accruals_select on public.salary_accruals for select to authenticated using (
  profile_id = auth.uid() or private.office(branch_id));
create policy salary_accruals_insert on public.salary_accruals for insert to authenticated with check (private.office(branch_id));
create policy salary_accruals_update on public.salary_accruals for update to authenticated
  using (private.office(branch_id)) with check (private.office(branch_id));
create policy salary_accruals_delete on public.salary_accruals for delete to authenticated using (private.is_director());

create policy salary_payments_select on public.salary_payments for select to authenticated using (
  profile_id = auth.uid() or private.office(branch_id));
create policy salary_payments_insert on public.salary_payments for insert to authenticated with check (
  private.office(branch_id) and paid_by = auth.uid());
create policy salary_payments_update on public.salary_payments for update to authenticated
  using (private.is_director()) with check (private.is_director());

-- расходы и страховка
create policy expense_categories_select on public.expense_categories for select to authenticated using (private.my_role() is not null);
create policy expense_categories_insert on public.expense_categories for insert to authenticated with check (
  private.role_in('{director,manager,admin}') and not is_system);
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (private.is_director() and not is_system) with check (private.is_director() and not is_system);
create policy expense_categories_delete on public.expense_categories for delete to authenticated using (private.is_director() and not is_system);

create policy expenses_select on public.expenses for select to authenticated using (private.office(branch_id));
create policy expenses_insert on public.expenses for insert to authenticated with check (private.office(branch_id));
create policy expenses_update on public.expenses for update to authenticated using (private.office(branch_id)) with check (private.office(branch_id));
create policy expenses_delete on public.expenses for delete to authenticated using (private.boss(branch_id));

create policy employee_insurance_select on public.employee_insurance for select to authenticated using (
  profile_id = auth.uid() or private.office(branch_id));
create policy employee_insurance_insert on public.employee_insurance for insert to authenticated with check (private.office(branch_id));
create policy employee_insurance_update on public.employee_insurance for update to authenticated
  using (private.office(branch_id)) with check (private.office(branch_id));
create policy employee_insurance_delete on public.employee_insurance for delete to authenticated using (private.boss(branch_id));

-- настройки, интеграция, журнал
create policy crm_settings_select on public.crm_settings for select to authenticated using (private.my_role() is not null);
create policy crm_settings_write on public.crm_settings for all to authenticated
  using (private.is_director()) with check (private.is_director());

create policy amocrm_mappings_select on public.amocrm_mappings for select to authenticated using (private.is_director());
create policy amocrm_sync_logs_select on public.amocrm_sync_logs for select to authenticated using (private.is_director());
create policy amocrm_webhook_events_select on public.amocrm_webhook_events for select to authenticated using (private.is_director());

create policy audit_logs_select on public.audit_logs for select to authenticated using (
  private.is_director() or (private.my_role() = 'manager' and branch_id is not null and private.has_branch(branch_id)));
