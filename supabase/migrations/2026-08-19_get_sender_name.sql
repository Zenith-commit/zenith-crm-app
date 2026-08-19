-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19.
--
-- Fixes a blank "Sent by" name in the communications UI. The frontend
-- previously resolved sender names via a PostgREST embedded join to
-- users (users!communications_sent_by_fkey(full_name)), which is RLS-
-- gated on the *joined* table -- a technician's users RLS only allows
-- reading their own row (users_select_own), so the embed silently
-- returned null for anyone else's messages. Same class of bug also
-- affected the notification bell's embedded join to jobs (technicians
-- have zero SELECT policy on jobs at all) -- fixed on the frontend side
-- by branching the bell's query through get_my_jobs() + a direct
-- clients select for technicians, no schema change needed for that part.
--
-- get_sender_name() is deliberately NOT an open "look up any user's name
-- by id" function -- that would be a real access regression, since
-- technicians currently can't see the staff directory at all (only
-- office can, per users_office_select_all). It only resolves a name if
-- there's a communications row proving the caller is already entitled
-- to know it -- the exact same predicate as the communications RLS
-- policies, not a new permission. Verified live: resolves a real name
-- for a legitimate admin/office or technician caller, returns null for
-- an unauthenticated/no-app-role caller (fail-closed) and for a caller
-- asking about a sender tied only to messages they can't see (wrong
-- type or wrong job).

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

comment on function public.get_sender_name(uuid) is 'Resolves a communications.sent_by id to a display name, scoped to exactly the same rows the caller could already see via communications RLS -- not a general user-directory lookup. Used because PostgREST embedded joins to users silently return null under technician RLS.';
