alter table public.invoice_line_items enable row level security;

create policy "invoice_line_items_admin_all" on public.invoice_line_items
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "invoice_line_items_office_select" on public.invoice_line_items
  for select
  using (public.current_app_role() = 'office');

create policy "invoice_line_items_office_insert" on public.invoice_line_items
  for insert
  with check (public.current_app_role() = 'office');

-- No office update or delete -- line items are immutable once
-- created (unlike invoices.paid_amount, nothing on an
-- invoice_line_items row is ever edited after the fact). No policy
-- at all for technicians -- deny by default, same as job_line_items.
