-- Удаляет всё, что создано tests/qa_setup.sql и тестами: филиалы «QA…», аккаунты qa.*@test.djigittau.kz и их записи журнала.
-- Реальные данные не затрагиваются: всё отбирается по тестовым филиалам и аккаунтам.
do $$
declare ids uuid[]; bs uuid[];
begin
  select array_agg(id) into ids from auth.users where email like 'qa.%@test.djigittau.kz';
  select array_agg(id) into bs from public.branches where name like 'QA%';
  set local session_replication_role = replica; -- без защит «платёж не удаляется» и без новых записей журнала
  delete from public.fines where branch_id = any(bs);
  delete from public.payments where branch_id = any(bs);
  delete from public.expenses where branch_id = any(bs);
  delete from public.students where branch_id = any(bs);
  delete from public.trial_leads where branch_id = any(bs);
  delete from public.audit_logs where actor_id = any(ids) or branch_id = any(bs) or entity_id = any(select unnest(ids)::text) or entity_id = any(select unnest(bs)::text);
  delete from public.employee_branches where profile_id = any(ids) or branch_id = any(bs);
  delete from public.profiles where id = any(ids);
  delete from public.branches where id = any(bs);
  delete from auth.identities where user_id = any(ids);
  delete from auth.users where id = any(ids);
end $$;
