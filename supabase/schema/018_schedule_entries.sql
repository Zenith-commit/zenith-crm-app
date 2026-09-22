create type public.schedule_entry_type as enum ('inspection', 'work');
create type public.schedule_entry_status as enum ('tentative', 'confirmed');

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  technician_id uuid not null references public.users(id),
  entry_type public.schedule_entry_type not null,
  status public.schedule_entry_status not null,
  scheduled_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.schedule_entries is 'A dispatch-calendar booking: one job, one technician, one date/time range. Multiple confirmed rows per job represent a multi-day work booking. entry_type is fixed at creation from jobs.status at that moment (Quote -> inspection, else -> work) and never changes afterward. Both inspection and work rows pass through tentative status: each is tentative unless the job already has a confirmed entry of that same entry_type, in which case the new entry is directly confirmed. Completed-status jobs are the one exception -- always a directly-confirmed work entry.';
