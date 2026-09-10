create table public.queues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.queues is 'Admin/office-defined job organization folders (e.g. "To Quote"), independent of job_status. A job belongs to at most one queue at a time. Deleting a queue does not delete its jobs -- jobs.queue_id is on delete set null, so affected jobs simply become unqueued.';

alter table public.jobs
  add column queue_id uuid references public.queues(id) on delete set null;

comment on column public.jobs.queue_id is 'Which queues folder this job is currently filed under, or null if unqueued. Manually assigned only -- no automatic status-based logic. Independent of jobs.status.';
