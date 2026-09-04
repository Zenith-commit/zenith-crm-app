alter table public.roof_reports enable row level security;

create policy "roof_reports_admin_all" on public.roof_reports
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "roof_reports_office_select" on public.roof_reports
  for select
  using (public.current_app_role() = 'office');

create policy "roof_reports_office_insert" on public.roof_reports
  for insert
  with check (public.current_app_role() = 'office');

-- No office update, no delete for anyone (immutable and permanent once
-- created -- editing metadata after generation wouldn't regenerate the
-- stored .docx, so the row and the document could silently disagree).
-- No technician policy at all -- zero access, not even read. Roof Report
-- is staff-only end to end (confirmed 2026-09-04).
