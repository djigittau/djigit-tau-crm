-- Первый директор в новом проекте. Выполнить один раз в Supabase → SQL Editor после миграций.
-- Впишите email, имя и временный пароль. При первом входе CRM попросит сменить пароль.
do $$
declare uid uuid := gen_random_uuid();
        v_email text := 'director@example.kz';   -- ← email директора
        v_name  text := 'Имя Фамилия';            -- ← имя
        v_pass  text := 'Временный-пароль-1';     -- ← временный пароль
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(v_email), extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{"must_change":true}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', lower(v_email), 'email_verified', true), now(), now(), now());
  insert into public.profiles (id, full_name, email, role, status) values (uid, v_name, lower(v_email), 'director', 'active');
end $$;
