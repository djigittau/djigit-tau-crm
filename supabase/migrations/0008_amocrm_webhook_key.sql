-- DJIGIT TAU CRM · 0008 · Ключ webhook amoCRM: случайный, хранится в закрытой схеме, читает только сервер.

alter table private.amocrm_credentials add column webhook_key text;
insert into private.amocrm_credentials (id, webhook_key) values (1, encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do update set webhook_key = coalesce(private.amocrm_credentials.webhook_key, excluded.webhook_key);

drop function public.amocrm_creds();
create function public.amocrm_creds()
returns table (domain text, access_token text, refresh_token text, expires_at timestamptz, webhook_key text)
language sql security definer set search_path = '' as $$
  select domain, access_token, refresh_token, expires_at, webhook_key from private.amocrm_credentials where id = 1
$$;
revoke all on function public.amocrm_creds() from public, anon, authenticated;
grant execute on function public.amocrm_creds() to service_role;
