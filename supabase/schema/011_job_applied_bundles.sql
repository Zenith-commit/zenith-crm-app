create table public.job_applied_bundles (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  bundle_id uuid not null references public.bundles(id) on delete restrict,
  bundle_name_snapshot text not null,
  applied_at timestamptz not null default now(),
  applied_by uuid references public.users(id)
);

comment on table public.job_applied_bundles is 'Tracks each "a bundle was applied to a job" event, so job_line_items can be grouped by originating bundle and a whole applied bundle can be removed in one action (job_line_items.applied_bundle_id cascades on delete). The same bundle can be applied to the same job more than once, each producing its own row here.';

alter table public.job_line_items
  add column applied_bundle_id uuid references public.job_applied_bundles(id) on delete cascade;

comment on column public.job_line_items.applied_bundle_id is 'Which job_applied_bundles event this line came from. Null for one-off lines not tied to any bundle -- those are unaffected by a job_applied_bundles deletion. Deleting the parent job_applied_bundles row cascades to remove every line item that belonged to it (the "remove whole bundle" action).';
