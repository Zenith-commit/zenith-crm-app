alter table public.bundle_items enable row level security;

create policy "bundle_items_admin_all" on public.bundle_items
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "bundle_items_office_select" on public.bundle_items
  for select
  using (public.current_app_role() = 'office');

create policy "bundle_items_office_insert" on public.bundle_items
  for insert
  with check (public.current_app_role() = 'office');

create policy "bundle_items_office_update" on public.bundle_items
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Unlike bundles/materials_catalog, office DOES get a delete policy here.
-- bundle_items rows are child line items of a bundle's editable table,
-- removed/recreated constantly as routine editing by whoever can edit
-- the bundle (admin or office) -- not a standalone "hard-delete a
-- record" action that needs restricting. Narrowing this to select/
-- insert/update-only initially broke office's bundle-edit-remove-line-
-- item flow; this policy restores it deliberately, explicit rather than
-- reverting to a blanket `for all`.
create policy "bundle_items_office_delete" on public.bundle_items
  for delete
  using (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as materials_catalog and bundles.
