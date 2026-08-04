insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('diary-photos', 'diary-photos', false)
on conflict (id) do nothing;

-- Receipts: admin + office only, matching job_costs access.
create policy "receipts_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'receipts'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'receipts'
    and public.current_app_role() in ('admin', 'office')
  );

-- Diary photos: admin/office full access.
create policy "diary_photos_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  );

-- Diary photos: technicians can upload/view files for their own
-- assigned jobs. Files must be uploaded under a path starting with
-- "<job_id>/..." -- storage.foldername(name) splits the path and
-- [1] is the first folder segment, i.e. the job id. Uses
-- technician_owns_job() rather than querying public.jobs directly --
-- a direct subquery would be blocked by jobs' own RLS, since
-- technicians have no SELECT policy on jobs.
create policy "diary_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and public.technician_owns_job(((storage.foldername(name))[1])::uuid)
  );

create policy "diary_photos_technician_select" on storage.objects
  for select
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and public.technician_owns_job(((storage.foldername(name))[1])::uuid)
  );
