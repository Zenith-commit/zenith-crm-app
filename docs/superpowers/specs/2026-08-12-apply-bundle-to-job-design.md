# Apply Bundle to Job — Design Spec

**Date:** 2026-08-12
**Status:** Approved

## Background

Bundle management UI shipped (`d2a8086`): staff can build and archive reusable bundle templates at `/bundles`. This phase connects that library to actual jobs — the "Apply Bundle to Job" action and a billing section on the job detail page, per the four-table Job Billing Integration data model that's already schema/RLS-complete (`bundles`, `bundle_items`, `job_line_items`, `job_applied_bundles`).

## Relationship to existing screens

`JobDetail.jsx` today renders `<h1>`, an edit-toggle block for job scalar fields, then `<DiarySection jobId={job.id} />` always mounted below. `useJob.js` already branches on role — technicians go through the `get_my_jobs()` RPC (column-hiding `quoted_price`), staff get a direct `jobs` select. The new billing section follows both of these precedents: a role-branching component mounted the same way `DiarySection` is, and a technician read path built on an RPC rather than direct table access.

## Scope

In scope:
- `BillingSection` on `JobDetail`, placed between the job info block and `DiarySection`
- "Apply Bundle" action: `<select>` of active bundles + explicit "Apply" button (no auto-fire on change)
- `apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid)` — new Postgres function, the first write-capable function in this project
- Line items displayed as collapsible sections grouped by `applied_bundle_id`, plus an "Other items" group for one-off lines (`applied_bundle_id is null`)
- Editing an applied line item: form-style edit-then-Save (same interaction shape as `BundleForm`/`BundleLineItemsEditor`), not inline-per-field
- Adding a one-off line item not tied to any bundle
- Removing a whole applied bundle (delete the `job_applied_bundles` row, cascade handles its lines) and removing an individual line, both confirm-gated, staff only
- Extending `get_my_job_line_items()` to also return `applied_bundle_id`, so technicians get the same grouped view (still no cost/markup/price) — re-verified live with the same rigor as its original build, not assumed safe

Out of scope (explicitly deferred):
- Invoicing
- Dropping `job_costs`
- Any change to the bundle management screens shipped last phase, or to `bundles`/`bundle_items` schema
- Reordering line items (no `sort_order` anywhere in this data model, per the standing decision)

## Data model

No table changes. Two function changes:

**`apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid)` — new.** Inserts one `job_applied_bundles` row (`job_id`, `bundle_id`, `bundle_name_snapshot` read from `bundles.name` at call time, `applied_by = auth.uid()`), then inserts one `job_line_items` row per matching `bundle_items` row, joined to `materials_catalog` for the snapshot fields: `item_code_snapshot` from `item_number`, `item_name_snapshot` from `description`, `cost_inc_gst_snapshot` from `purchase_cost`, `qty`/`markup_pct` from the bundle item's `default_qty`/`default_markup_pct`, `applied_bundle_id` set to the new header row's `id`. If the bundle has zero `bundle_items`, the function still succeeds — a `job_applied_bundles` header row with no lines, matching the "allow empty bundles" decision.

Both inserts happen inside one function call, which Postgres treats as a single atomic unit — if the line-item insert fails, the header insert rolls back too, so a partial apply (an orphaned empty-looking bundle section with no line items and no error visible to the user) can't happen. This is the first write-capable function in this codebase; everything existing (`current_app_role`, `technician_owns_job`, `technician_has_job_for_client`, `get_my_jobs`, `get_my_job_line_items`) is read-only. `SECURITY INVOKER` (the default) is sufficient — admin/office already have full INSERT rights on both tables via existing RLS, so the function needs atomicity, not elevated privilege. A technician calling it directly would still hit the same RLS denial on the `job_applied_bundles` insert that they'd hit calling the underlying tables directly today — no new bypass introduced, same protection shape as everywhere else in this app (nav-hiding keeps the button out of their UI; RLS is the actual backstop).

**`get_my_job_line_items(target_job_id uuid)` — modified.** Return table gains `applied_bundle_id uuid` alongside the existing `id, job_id, qty, item_name_snapshot`. Still no cost/markup/price columns. `technician_owns_job()` restriction logic is unchanged. Since `create or replace function` fully replaces a function's definition, this is a safe in-place edit to `supabase/policies/011_job_line_items_policies.sql` — re-running that one statement live is enough, no separate migration file needed (this isn't a table alteration).

**A read-path simplification worth noting:** unlike `bundle_items` (which has no stored cost and needs `bundleCalc.js`'s live-join formulas), `job_line_items` already has `price_inc_gst`/`total_inc_gst` as stored generated columns, computed once at insert time from the snapshot fields. Reading and displaying a job's existing billing lines is just reading those columns directly — no client-side recomputation needed. The one place client-side calc is still needed is the "add one-off line" form, where a live preview has to be computed before the row exists in the database (same formula, reused conceptually from `bundleCalc.js` but applied to `cost_inc_gst_snapshot` directly since it's already GST-inclusive with no further join needed).

## Access control

No RLS policy changes — `job_applied_bundles` and `job_line_items` policies are already live and correct (admin/office full CRUD, zero technician access to the base tables). The only access-control-relevant change is the `get_my_job_line_items()` return shape above, which stays within the same technician-safe column set (still nothing cost/markup/price-related).

## UI

### Placement and picker

`BillingSection` mounts in `JobDetail.jsx` between the existing job info block and `<DiarySection jobId={job.id} />`. For staff, it renders a running job total (sum of `total_inc_gst` across all line items, all groups) — technicians don't see this total at all, since it isn't just hidden in the UI, it's structurally unavailable: `get_my_job_line_items()` never returns `total_inc_gst`, so there's nothing to sum on the technician path. It also renders an "Apply Bundle" control (`<select>` fed by a new `useActiveBundles` hook mirroring `useActiveMaterials`, `active = true` only, plus an explicit "Apply" button — deliberately not auto-firing on selection, since this is an immediate database write, not staging in-memory state like the bundle editor's "Add line"), and the grouped line-item display.

### Grouping

Line items are grouped client-side by `applied_bundle_id` into collapsible sections (new component, no existing accordion/collapsible precedent in this codebase — same category of new work `BundleLineItemsEditor` was last phase), each labeled with `job_applied_bundles.bundle_name_snapshot`. A final "Other items" group holds lines where `applied_bundle_id is null`. The same bundle can produce multiple separate groups on one job if applied more than once (each apply creates its own `job_applied_bundles` row) — this is intentional, not deduped.

### Editing and adding lines

Editing an existing line item's qty/markup uses the same form-style edit-then-Save shape as `BundleForm` (not inline-per-cell) — load current values into a form, submit updates the row, matching the decision that a job's billing table, while it does get incrementally adjusted over time, still gets edited in discrete named sessions rather than cell-by-cell autosave. Adding a one-off line item (no bundle) is a direct insert with `applied_bundle_id = null`.

### Removal

"Remove Bundle" on a group deletes its `job_applied_bundles` row (confirm-gated, cascade removes its lines — already proven at the DB layer). "Remove" on an individual line item deletes that `job_line_items` row directly (confirm-gated). Both staff-only, matching every other mutating action in this app.

### Technician view

Same grouped/collapsible display, sourced from the extended `get_my_job_line_items()` RPC (now includes `applied_bundle_id`), rendering only qty + item name per line, no group totals (since totals require cost/price data technicians don't have), no Apply/Edit/Remove controls.

## Testing

No automated JS test suite — manual verification, same pattern as every prior phase:
- `npm run build` / `npx oxlint` as a compile-cleanliness check
- Manual SQL Editor re-verification of `get_my_job_line_items()` after the signature change: technician sees only their assigned job's items, `applied_bundle_id` is present and correct, still zero cost/markup/price columns exposed — full re-run of the original live-verification checklist, not assumed safe because it's "just adding a column"
- Manual sign-in as admin/office: apply a bundle (including an empty one) to a job, confirm the group and its line items appear correctly with correct totals; edit a line's qty/markup and confirm it persists on reload; add a one-off line; remove an individual line; remove a whole applied bundle and confirm only its lines disappear
- Manual sign-in as technician: confirm the grouped read-only view shows qty + name only, confirm no Apply/Edit/Remove controls are rendered, confirm a job not assigned to them still shows nothing
