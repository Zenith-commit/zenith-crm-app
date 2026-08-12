-- The first write-capable function in this project. Applies a bundle
-- to a job by inserting one job_applied_bundles header row and one
-- job_line_items row per bundle_items row, as a single atomic unit --
-- if any insert fails, the whole call rolls back, so a partial apply
-- (an empty-looking bundle section with no line items and no visible
-- error) can't happen. SECURITY INVOKER (the default -- no keyword
-- needed) is enough: admin/office already have full INSERT rights on
-- both tables via existing RLS, so this buys atomicity, not elevated
-- privilege. Because RLS still applies to every statement inside a
-- SECURITY INVOKER function, a technician calling this directly gets
-- no error -- the initial `select ... from bundles` already returns
-- zero rows under their RLS, so both inserts affect zero rows and the
-- function returns null. Safe (nothing is written or exposed), just
-- not a chatty failure -- acceptable since the Apply Bundle control
-- never renders for technicians in the UI anyway.
create or replace function public.apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_applied_bundle_id uuid;
begin
  insert into public.job_applied_bundles (job_id, bundle_id, bundle_name_snapshot, applied_by)
  select target_job_id, target_bundle_id, bundles.name, auth.uid()
  from public.bundles
  where bundles.id = target_bundle_id
  returning id into new_applied_bundle_id;

  insert into public.job_line_items (
    job_id, materials_catalog_id, item_code_snapshot, item_name_snapshot,
    qty, cost_inc_gst_snapshot, markup_pct, applied_bundle_id
  )
  select
    target_job_id,
    materials_catalog.id,
    materials_catalog.item_number,
    materials_catalog.description,
    bundle_items.default_qty,
    coalesce(materials_catalog.purchase_cost, 0),
    bundle_items.default_markup_pct,
    new_applied_bundle_id
  from public.bundle_items
  join public.materials_catalog on materials_catalog.id = bundle_items.materials_catalog_id
  where bundle_items.bundle_id = target_bundle_id;

  return new_applied_bundle_id;
end;
$$;

comment on function public.apply_bundle_to_job(uuid, uuid) is 'Applies a bundle to a job: inserts one job_applied_bundles header row and one job_line_items row per bundle_items row (snapshotting item_number/description/purchase_cost from materials_catalog at this moment; purchase_cost null coalesces to 0, matching the same convention used in the bundle editor), as a single atomic operation. Succeeds even if the bundle has zero bundle_items (an empty header row, by design). Returns the new job_applied_bundles.id, or null if the caller has no RLS access to the bundle (e.g. a technician).';
