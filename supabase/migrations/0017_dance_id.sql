-- DJIGIT TAU CRM · 0017 · Направление танца вводится текстом: находит существующее (без учёта регистра) или создаёт новое.
-- Можно офису и отделу продаж (продажи вписывают направление в заявку на пробное).
create function public.dance_id(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); r uuid;
begin
  if not private.role_in('{director,manager,admin,sales}') then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if n = '' then return null; end if;
  if length(n) > 60 then raise exception 'Название направления — до 60 символов'; end if;
  select id into r from public.dance_types where lower(name) = lower(n);
  if r is null then
    insert into public.dance_types (name) values (upper(left(n, 1)) || substr(n, 2)) returning id into r;
  else
    update public.dance_types set is_active = true where id = r and not is_active;
  end if;
  return r;
end $$;
revoke all on function public.dance_id(text) from public, anon;
grant execute on function public.dance_id(text) to authenticated;
