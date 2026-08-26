create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_line_item_id uuid references public.job_line_items(id) on delete set null,
  item_name_snapshot text not null,
  qty numeric(10, 2) not null,
  unit_price_inc_gst_snapshot numeric(10, 2) not null,
  total_inc_gst_snapshot numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

comment on table public.invoice_line_items is 'Line items on an invoice, snapshotted from job_line_items at the moment an invoice is created (via create_invoice()) -- not a live reference. This is what lets the same job_line_items row be selected onto more than one invoice, and means a later edit or deletion of the source job_line_items row can never retroactively change an invoice that has already been generated. job_line_item_id is kept only as an optional traceability pointer back to the source row (on delete set null).';
