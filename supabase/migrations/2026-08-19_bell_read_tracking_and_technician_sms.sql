-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19, following live testing feedback on the
-- mocked email/SMS feature.
--
-- 1. Adds real read-tracking to the notification bell. Previously the
--    bell just counted inbound rows from the last 24h with no persistent
--    state, so clicking a notification didn't make it disappear.
--    read_at is a single column (not a per-user read-state table) --
--    this app committed to a single shared company mailbox model, so
--    "read" is a property of the message itself, matching that model.
--
-- 2. Opens SMS (not email) to technicians -- a real workflow need (e.g.
--    sending an "on my way" text before arriving at a job). Uses the
--    existing technician_owns_job() helper, same scoping as everywhere
--    else technician access is scoped. Technician INSERT is restricted
--    to direction = 'outbound' -- "Simulate Incoming Reply" is a staff-
--    only demo affordance for showing off the notification bell, not a
--    real technician action.

alter table public.communications add column read_at timestamptz;

create policy "communications_technician_sms_select" on public.communications
  for select
  using (
    public.current_app_role() = 'technician'
    and type = 'sms'
    and public.technician_owns_job(job_id)
  );

create policy "communications_technician_sms_insert" on public.communications
  for insert
  with check (
    public.current_app_role() = 'technician'
    and type = 'sms'
    and direction = 'outbound'
    and public.technician_owns_job(job_id)
  );
