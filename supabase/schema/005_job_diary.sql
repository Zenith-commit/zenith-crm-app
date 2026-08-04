create table public.job_diary (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  entry_text text not null,
  photo_paths text[] not null default '{}',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.job_diary is 'Timestamped notes/photos logged against a job by whoever is on site.';
