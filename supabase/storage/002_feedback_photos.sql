insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

create policy "feedback_photos_admin_all" on storage.objects
  for all
  using (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  )
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  );

create policy "feedback_photos_office_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'office'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "feedback_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'technician'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
