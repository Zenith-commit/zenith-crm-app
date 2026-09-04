create type public.roof_type_option as enum ('Tiled Roof', 'Metal Roof', 'Asbestos Roof', 'Others');

create table public.roof_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sequence_num integer not null,
  client_name text,
  property_address text,
  date_of_inspection date,
  inspector text,
  work_order text,
  roof_type public.roof_type_option,
  roof_age text,
  roof_pitch text,
  urgent_observations text[] not null default '{}',
  urgent_recommendations text[] not null default '{}',
  preventive_observations text[] not null default '{}',
  preventive_recommendations text[] not null default '{}',
  photo_paths text[] not null default '{}',
  docx_path text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, sequence_num)
);

comment on table public.roof_reports is 'A generated roof inspection report (.docx), snapshotted at generation time. Multiple reports per job are allowed (e.g. re-inspection after repairs) -- sequence_num is a per-job counter, same shape as invoices.sequence_num. Immutable and permanent once created: no update or delete policy for anyone.';
