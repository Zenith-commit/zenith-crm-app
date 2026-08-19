-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19.
--
-- Fixes a security gap found while deciding the hard-delete-vs-archive
-- question for clients/bundles: materials_catalog, bundles, and
-- bundle_items each had a single office "for all" policy, which
-- (unlike clients/jobs) let office hard-delete rows -- unused by any UI,
-- but present at the RLS layer. Narrowed to explicit select/insert/update
-- policies, matching the pattern already used for office on clients/jobs.
--
-- No new policy was needed for admin -- admin's existing "_admin_all"
-- policies on clients and bundles are `for all`, which already covers
-- DELETE. Hard-delete UI (Bundle/Client "Delete Permanently", admin-only)
-- relies on those existing policies plus the pre-existing FK restrict
-- constraints (job_applied_bundles.bundle_id, jobs.client_id) as the
-- real safety net against deleting anything with real history.
--
-- Follow-up correction (same day): narrowing bundle_items' office
-- policy broke BundleDetail's existing edit-save flow, which removes
-- line items via a direct delete() call as a routine part of editing --
-- available to office, not just admin. Added bundle_items_office_delete
-- back explicitly (not a revert to `for all`) since that's a normal,
-- frequent operation on child line-item rows, unlike hard-deleting a
-- standalone bundles/materials_catalog/clients record. Re-verified live:
-- office editing a bundle, removing a line item, and saving persists
-- correctly after reload.

-- materials_catalog
drop policy "materials_catalog_office_all" on public.materials_catalog;

create policy "materials_catalog_office_select" on public.materials_catalog
  for select using (public.current_app_role() = 'office');

create policy "materials_catalog_office_insert" on public.materials_catalog
  for insert with check (public.current_app_role() = 'office');

create policy "materials_catalog_office_update" on public.materials_catalog
  for update using (public.current_app_role() = 'office') with check (public.current_app_role() = 'office');

-- bundles
drop policy "bundles_office_all" on public.bundles;

create policy "bundles_office_select" on public.bundles
  for select using (public.current_app_role() = 'office');

create policy "bundles_office_insert" on public.bundles
  for insert with check (public.current_app_role() = 'office');

create policy "bundles_office_update" on public.bundles
  for update using (public.current_app_role() = 'office') with check (public.current_app_role() = 'office');

-- bundle_items
drop policy "bundle_items_office_all" on public.bundle_items;

create policy "bundle_items_office_select" on public.bundle_items
  for select using (public.current_app_role() = 'office');

create policy "bundle_items_office_insert" on public.bundle_items
  for insert with check (public.current_app_role() = 'office');

create policy "bundle_items_office_update" on public.bundle_items
  for update using (public.current_app_role() = 'office') with check (public.current_app_role() = 'office');

create policy "bundle_items_office_delete" on public.bundle_items
  for delete using (public.current_app_role() = 'office');
