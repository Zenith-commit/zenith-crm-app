insert into storage.buckets (id, name, public)
values ('roof-report-photos', 'roof-report-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('roof-report-docs', 'roof-report-docs', false)
on conflict (id) do nothing;

-- Input photos: staff (admin+office) full access, including delete --
-- before Generate is clicked, an uploaded photo is compose-time working
-- data (staff should be able to remove a mis-uploaded photo), not a
-- permanent record, same reasoning as bundle_items_office_delete. No
-- technician access at all -- Roof Report is staff-only end to end
-- (confirmed 2026-09-04).
create policy "roof_report_photos_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'roof-report-photos'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'roof-report-photos'
    and public.current_app_role() in ('admin', 'office')
  );

-- Output documents: staff can read (download), nobody can write via the
-- anon key at all -- only the Edge Function's service-role client writes
-- here, which bypasses RLS entirely. The deliberate absence of an
-- insert/update/delete policy is defense-in-depth (fail-closed if
-- anything ever tried to write here directly), matching this project's
-- established security-hardening rigor.
create policy "roof_report_docs_admin_office_select" on storage.objects
  for select
  using (
    bucket_id = 'roof-report-docs'
    and public.current_app_role() in ('admin', 'office')
  );
