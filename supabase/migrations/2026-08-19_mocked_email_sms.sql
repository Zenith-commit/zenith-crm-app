-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19, adding real columns to the communications
-- table for the mocked email/SMS feature.
--
-- This single feature satisfies both the Outlook/Microsoft 365 email
-- integration and SMS integration backlog items -- deliberately mocked,
-- not real: no Azure app registration, no Microsoft Graph API, no real
-- SMS provider, no Edge Function, no real credentials. Goal is to
-- demonstrate the intended UX (compose, send, log, notify) so a
-- professional developer can finalize the real integrations later.
--
-- communications had sat as an empty placeholder since Day 1-2
-- ("Placeholder for week-2 Outlook integration") -- confirmed 0 rows
-- before this ran, so columns were added not null directly, no backfill.

create type public.communication_type as enum ('email', 'sms');
create type public.communication_direction as enum ('outbound', 'inbound');

alter table public.communications
  add column type public.communication_type not null default 'email',
  add column direction public.communication_direction not null default 'outbound',
  add column sender text,
  add column recipient text,
  add column subject text,
  add column body text not null default '',
  add column sent_by uuid references public.users(id);

alter table public.communications alter column type drop default;
alter table public.communications alter column direction drop default;
alter table public.communications alter column body drop default;
