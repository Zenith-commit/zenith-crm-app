create type public.job_status as enum ('Quote', 'Work Order', 'Scheduled', 'Completed');
create type public.job_type as enum ('Tile Roofing', 'Metal Roofing', 'Roof Replacement');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  status public.job_status not null default 'Quote',
  job_type public.job_type not null,
  assigned_to uuid references public.users(id),
  description text,
  quoted_price numeric(10, 2),
  invoiced boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobs is 'A roofing job for a client, tracked from quote through completion. Invoicing is a separate future feature -- see the invoiced flag.';
