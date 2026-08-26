alter table public.invoices enable row level security;

create policy "invoices_admin_all" on public.invoices
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "invoices_office_select" on public.invoices
  for select
  using (public.current_app_role() = 'office');

create policy "invoices_office_insert" on public.invoices
  for insert
  with check (public.current_app_role() = 'office');

create policy "invoices_office_update" on public.invoices
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No office delete (invoices are immutable once created). No policy
-- at all for technicians -- deny by default, same as
-- materials_catalog/bundles. The office_update policy exists only so
-- paid_amount can be edited after creation; nothing else on an
-- invoice is ever updated.
