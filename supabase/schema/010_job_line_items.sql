create table public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  materials_catalog_id uuid references public.materials_catalog(id) on delete restrict,
  item_code_snapshot text,
  item_name_snapshot text not null,
  qty numeric(10, 2) not null default 1,
  cost_inc_gst_snapshot numeric(10, 2) not null,
  markup_pct numeric(5, 2) not null default 0,
  price_inc_gst numeric(10, 2) generated always as (cost_inc_gst_snapshot * (1 + markup_pct / 100)) stored,
  total_inc_gst numeric(10, 2) generated always as (cost_inc_gst_snapshot * (1 + markup_pct / 100) * qty) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_line_items is 'Per-job billing line items, created by copying a bundle''s items onto a job (materials_catalog_id, item_code_snapshot, item_name_snapshot, cost_inc_gst_snapshot are copied at that time) and then freely edited, or added as one-off lines not tied to any bundle or catalog item. price_inc_gst and total_inc_gst are stored generated columns. Admin/office full access; technicians see qty + item_name_snapshot only, via get_my_job_line_items() -- never the base table directly.';
