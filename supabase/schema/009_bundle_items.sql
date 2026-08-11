create table public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  materials_catalog_id uuid not null references public.materials_catalog(id) on delete restrict,
  default_qty numeric(10, 2) not null default 0,
  default_markup_pct numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bundle_items is 'Line items belonging to a bundle template, each referencing a materials_catalog row with a default qty (may be 0, still shown so staff can adjust) and default markup %. Admin/office only -- technicians have no access. Copied onto a job as job_line_items when a bundle is applied to a job.';
