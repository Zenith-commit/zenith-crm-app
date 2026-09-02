alter table public.feedback enable row level security;

create policy "feedback_admin_all" on public.feedback
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "feedback_office_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'office'
    and submitted_by = auth.uid()
  );

create policy "feedback_technician_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'technician'
    and submitted_by = auth.uid()
  );
