-- Защищаем только зафиксированные (закрытые) смены. Открытую смену правят RLS-политики (только руководство) и end_shift().
create or replace function private.guard_work_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.ended_at is null or current_setting('app.shift_rpc', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if not private.boss(old.branch_id) then
    raise exception 'Изменять зафиксированные смены может только директор или управляющий';
  end if;
  new.corrected_by := auth.uid();
  new.corrected_at := now();
  return new;
end $$;