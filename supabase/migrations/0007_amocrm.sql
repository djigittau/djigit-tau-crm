-- DJIGIT TAU CRM · 0007 · amoCRM → CRM: хранение токенов OAuth и ежечасная синхронизация.

-- Токены OAuth лежат в private.amocrm_credentials. Читать и писать их может только сервер (service_role).
create function public.amocrm_creds() returns table (domain text, access_token text, refresh_token text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select domain, access_token, refresh_token, expires_at from private.amocrm_credentials where id = 1
$$;

create function public.amocrm_save_creds(p_domain text, p_access text, p_refresh text, p_expires timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into private.amocrm_credentials (id, domain, access_token, refresh_token, expires_at, updated_at)
  values (1, p_domain, p_access, p_refresh, p_expires, now())
  on conflict (id) do update set domain = excluded.domain, access_token = excluded.access_token,
    refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = now()
$$;

revoke all on function public.amocrm_creds(), public.amocrm_save_creds(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.amocrm_creds(), public.amocrm_save_creds(text, text, text, timestamptz) to service_role;

-- Раз в час — догрузка изменений, пропущенных webhook. Ключ вызова — секрет agents_key из Vault.
select cron.schedule('amocrm-sync-hourly', '17 * * * *', $cron$
  select net.http_post(
    url := 'https://qfrspiobhvugslvcvjdn.supabase.co/functions/v1/amocrm',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-agents-key', (select decrypted_secret from vault.decrypted_secrets where name = 'agents_key')),
    body := '{"action":"sync","kind":"periodic"}'::jsonb,
    timeout_milliseconds := 60000)
$cron$);
