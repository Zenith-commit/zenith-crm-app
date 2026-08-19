alter table public.communications enable row level security;

create policy "communications_admin_all" on public.communications
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "communications_office_select" on public.communications
  for select
  using (public.current_app_role() = 'office');

create policy "communications_office_insert" on public.communications
  for insert
  with check (public.current_app_role() = 'office');

create policy "communications_office_update" on public.communications
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Technicians get SMS only (view + send), never email -- a real
-- workflow need (e.g. an "on my way" text before arriving at a job),
-- scoped to jobs assigned to them via the existing technician_owns_job()
-- helper. INSERT is restricted to direction = 'outbound': "Simulate
-- Incoming Reply" is a staff-only demo affordance for the notification
-- bell, not a real technician action. No technician UPDATE policy --
-- nothing to edit today, and read_at (the bell's read-tracking) is only
-- ever set from the bell UI, which is fine since RLS is enforced
-- per-request regardless of which role's session sets it.
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

-- Resolves a communications.sent_by id to a display name. Frontend used
-- to do this via an embedded join to users, but that join is RLS-gated
-- on users -- a technician's users RLS only allows reading their own
-- row, so the embed silently returned null for anyone else's messages.
-- Deliberately NOT an open "look up any user's name by id" function --
-- that would be a real access regression, since technicians can't see
-- the staff directory at all otherwise (only office can, per
-- users_office_select_all in 002_users_policies.sql). Only resolves a
-- name if there's a communications row proving the caller is already
-- entitled to know it -- the exact same predicate as the policies
-- above, not a new permission.
create or replace function public.get_sender_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.full_name
  from public.users u
  where u.id = target_user_id
    and exists (
      select 1 from public.communications c
      where c.sent_by = target_user_id
        and (
          public.current_app_role() in ('admin', 'office')
          or (
            public.current_app_role() = 'technician'
            and c.type = 'sms'
            and public.technician_owns_job(c.job_id)
          )
        )
    );
$$;
