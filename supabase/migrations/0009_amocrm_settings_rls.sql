-- DJIGIT TAU CRM · 0009 · Настройки amoCRM (домен, client_id, state OAuth, соответствия) видит только директор.
drop policy crm_settings_select on public.crm_settings;
create policy crm_settings_select on public.crm_settings for select to authenticated
  using (private.my_role() is not null and (key not like 'amocrm%' or private.is_director()));
