create type public.job_status as enum ('Quote', 'Scheduled', 'In Progress', 'Completed', 'Invoiced');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  status public.job_status not null default 'Quote',
  assigned_to uuid references public.users(id),
  description text,
  quoted_price numeric(10, 2),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobs is 'A roofing job for a client, tracked from quote through invoicing.';
