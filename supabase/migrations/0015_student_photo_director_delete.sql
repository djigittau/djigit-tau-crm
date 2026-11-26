-- DJIGIT TAU CRM · 0015 · Директор может удалить любое фото ученика (в том числе оставшееся от удалённой карточки).
drop policy students_photo_delete on storage.objects;
create policy students_photo_delete on storage.objects for delete to authenticated using (
  bucket_id = 'students' and (private.is_director() or exists (
    select 1 from public.students s where s.id::text = (storage.foldername(name))[1] and private.clients(s.branch_id))));
-- Чтобы удалить, файл нужно видеть: директор видит все фото учеников.
drop policy students_photo_select on storage.objects;
create policy students_photo_select on storage.objects for select to authenticated using (
  bucket_id = 'students' and (private.is_director() or exists (select 1 from public.students s where s.id::text = (storage.foldername(name))[1])));
-- Фото сотрудников и так публичны; чтение через API нужно, чтобы удалять старые файлы.
create policy staff_photo_select on storage.objects for select to authenticated using (bucket_id = 'staff');
