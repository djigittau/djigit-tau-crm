-- Тестовые аккаунты и данные для tests/rls.cjs. Пароль всех qa.*: QaTest-2026!
-- После проверки обязательно выполнить tests/qa_cleanup.sql.
do $$
declare r record; uid uuid; b1 uuid; b2 uuid; tr uuid; cat uuid; st uuid; sa uuid;
begin
  insert into public.branches (name) values ('QA Филиал 1') returning id into b1;
  insert into public.branches (name) values ('QA Филиал 2') returning id into b2;
  for r in select * from (values ('director','QA Директор',null),('manager','QA Управляющий',1),('manager2','QA Управляющий 2',2),('admin','QA Админ',1),('trainer','QA Тренер',1),('sales','QA Продажи',1)) v(login, name, br) loop
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'qa.'||r.login||'@test.djigittau.kz', extensions.crypt('QaTest-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', 'qa.'||r.login||'@test.djigittau.kz', 'email_verified', true), now(), now(), now());
    insert into public.profiles (id, full_name, email, role, status) values (uid, r.name, 'qa.'||r.login||'@test.djigittau.kz', replace(r.login,'2','')::public.app_role, 'active');
    if r.br is not null then insert into public.employee_branches (profile_id, branch_id) values (uid, case r.br when 1 then b1 else b2 end); end if;
    if r.login = 'trainer' then tr := uid; end if;
  end loop;
  select id into cat from public.expense_categories where code = 'rent';
  insert into public.students (full_name, branch_id) values ('QA Ученик 1', b1) returning id into st;
  insert into public.students (full_name, branch_id) values ('QA Ученик 2', b2);
  insert into public.expenses (branch_id, category_id, amount) values (b1, cat, 1000), (b2, cat, 2000);
  insert into public.payments (branch_id, amount, method) values (b1, 5000, 'cash'), (b2, 7000, 'cash');
  insert into public.fines (profile_id, branch_id, amount, reason) values (tr, b1, 500, 'QA штраф');
  insert into public.sales (student_id, branch_id, title, price, lessons_total) values (st, b1, 'QA Абонемент 8 занятий', 30000, 8) returning id into sa;
  insert into public.payments (sale_id, student_id, branch_id, amount, method) values (sa, st, b1, 30000, 'kaspi');
end $$;
