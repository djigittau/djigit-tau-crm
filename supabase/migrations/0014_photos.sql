-- DJIGIT TAU CRM · 0014 · Фото сотрудников и учеников (Supabase Storage).
-- staff — публичная корзина (аватар в шапке и карточках); путь <profile_id>/<файл>. Своё фото меняет сотрудник, любое — директор.
-- students — закрытая корзина, ссылки временные; путь <student_id>/<файл>. Видят те, кто видит ученика; меняет офис и продажи филиала.
alter table public.students add column photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('staff', 'staff', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('students', 'students', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy staff_photo_write on storage.objects for insert to authenticated with check (
  bucket_id = 'staff' and private.my_role() is not null
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_director()));
create policy staff_photo_update on storage.objects for update to authenticated using (
  bucket_id = 'staff' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_director()));
create policy staff_photo_delete on storage.objects for delete to authenticated using (
  bucket_id = 'staff' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_director()));

-- Подзапрос к students идёт с правами пользователя (RLS учеников), поэтому чужих учеников не видно.
create policy students_photo_select on storage.objects for select to authenticated using (
  bucket_id = 'students' and exists (select 1 from public.students s where s.id::text = (storage.foldername(name))[1]));
create policy students_photo_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'students' and exists (select 1 from public.students s where s.id::text = (storage.foldername(name))[1] and private.clients(s.branch_id)));
create policy students_photo_update on storage.objects for update to authenticated using (
  bucket_id = 'students' and exists (select 1 from public.students s where s.id::text = (storage.foldername(name))[1] and private.clients(s.branch_id)));
create policy students_photo_delete on storage.objects for delete to authenticated using (
  bucket_id = 'students' and exists (select 1 from public.students s where s.id::text = (storage.foldername(name))[1] and private.clients(s.branch_id)));
