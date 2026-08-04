create table public.job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  vendor text,
  amount numeric(10, 2) not null,
  cost_date date not null default current_date,
  description text,
  receipt_image_path text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.job_costs is 'Material/receipt costs logged against a job. Admin/office only -- technicians have no access.';
