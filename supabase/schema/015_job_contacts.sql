create table public.job_contacts (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.job_contacts is 'A job-specific contact person (e.g. on-site tenant or foreman), separate from and independent of the linked client''s own contact info in public.clients. Editing this never updates public.clients. At most one row per job -- job_id is the primary key, so "no override set" is a missing row, not a row of nulls.';
