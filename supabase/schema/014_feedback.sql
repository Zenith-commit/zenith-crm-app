create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.users(id),
  message text not null,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.feedback is 'Free-text suggestions/feedback submitted by any staff member about the CRM or the company.';
