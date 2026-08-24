create type public.job_status as enum ('Quote', 'Work Order', 'Scheduled', 'Completed');

create sequence public.jobs_job_number_seq;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number integer not null default nextval('public.jobs_job_number_seq') unique,
  client_id uuid not null references public.clients(id),
  status public.job_status not null default 'Quote',
  assigned_to uuid references public.users(id),
  description text,
  site_address text,
  invoiced boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence public.jobs_job_number_seq owned by public.jobs.job_number;

comment on table public.jobs is 'A roofing job for a client, tracked from quote through completion. Invoicing is a separate future feature -- see the invoiced flag. job_number is a display-friendly sequential number (formatted client-side as "Job #0001" by formatJobNumber() in src/lib/jobConstants.js), backed by its own sequence rather than an identity column so a fresh install and the live backfilled sequence behave the same way.';
