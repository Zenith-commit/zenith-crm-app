create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  item_number text,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bundles is 'Reusable job-type template library (e.g. "Concrete Roof Restoration"). Admin/office only -- technicians have no access. Line items live in bundle_items.';
