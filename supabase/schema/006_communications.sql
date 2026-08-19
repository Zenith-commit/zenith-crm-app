create type public.communication_type as enum ('email', 'sms');
create type public.communication_direction as enum ('outbound', 'inbound');

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  type public.communication_type not null,
  direction public.communication_direction not null,
  sender text,
  recipient text,
  subject text,
  body text not null,
  sent_by uuid references public.users(id),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.communications is 'Email/SMS sent or received on a job. Mocked/simulated feature -- no real email or SMS provider is connected; "Send" and "Simulate Incoming Reply" both just insert a row here. Stands in for the real Outlook/M365 and SMS integrations until a professional developer finalizes those.';
