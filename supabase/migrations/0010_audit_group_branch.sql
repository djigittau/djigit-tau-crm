-- DJIGIT TAU CRM · 0010 · Журнал: тренеры и состав группы получают филиал группы, чтобы их видел управляющий филиала.
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb; r jsonb; b uuid; hdr json;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  r := coalesce(n, o);
  b := case when tg_table_name = 'branches' then (r ->> 'id')::uuid else (r ->> 'branch_id')::uuid end;
  if b is null and r ? 'lesson_id' then b := private.lesson_branch((r ->> 'lesson_id')::uuid); end if;
  if b is null and r ? 'group_id' then select g.branch_id into b from public.groups g where g.id = (r ->> 'group_id')::uuid; end if;
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then hdr := null;
  end;
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, branch_id, old_data, new_data, ip)
  values (auth.uid(), private.my_role(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'profile_id', r ->> 'key', r ->> 'group_id'), b, o, n,
          coalesce(hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip'));
  return null;
end $$;

-- Прошлые записи о составе и тренерах групп — тоже с филиалом группы.
update public.audit_logs a set branch_id = g.branch_id
from public.groups g
where a.entity in ('group_members', 'group_trainers') and a.branch_id is null
  and g.id = (coalesce(a.new_data, a.old_data) ->> 'group_id')::uuid;
