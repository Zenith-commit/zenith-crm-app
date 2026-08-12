# Job Billing UI, Phase 1: Bundle Management Screens — Design Spec

**Date:** 2026-08-12
**Status:** Draft — pending review

## Background

The full data layer for Job Billing Integration is built, RLS-verified live, committed and pushed: `bundles`, `bundle_items`, `job_line_items`, `job_applied_bundles`. No UI exists yet for any of it. This spec covers the first UI phase: bundle management only — creating, editing, listing, and archiving reusable job-type templates (bundles) and their line items. It does **not** cover applying a bundle to a job, the job detail billing section, or anything touching `job_line_items`/`job_applied_bundles` — that's a later phase, after this one is built and reviewed.

## Relationship to existing screens

This follows the same file/folder/hook/form conventions as the Materials & Services catalog (`/catalog`), which itself follows the `Client*`/`Job*` pattern already established in the app. That review (materials_catalog's list/create/edit implementation) directly informed this spec — see the "UI" section below for exactly what's reused vs. new.

## Scope

In scope:
- `/bundles` — list view of all bundles (active and archived both shown, with a status column)
- `/bundles/new` — create screen
- `/bundles/:id` — detail/edit screen (inline edit toggle, same pattern as `CatalogDetail`)
- Editable line-item sub-table inside the bundle form: add a material (active items only), set qty and markup per line, live per-row price/total, running Total Cost / Markup / Total Price footer
- Archive action (sets `active = false`)
- Nav link, admin/office only

Out of scope (explicitly deferred to a later phase):
- "Apply bundle to job" action
- Job detail page billing section
- Any change to `job_line_items` or `job_applied_bundles`
- Manual line-item reordering (`bundle_items` has no `sort_order` column by design — see prior decision; items display in insertion order)
- Un-archiving a bundle from the UI (archive is one-way for this phase; reactivating, if ever needed, is a direct DB action for now)
- Inactive-bundle filter/toggle beyond the status column already shown in the list (no separate "show archived" filter — archived bundles just appear in the same list with a status badge)

## Data model

No schema changes in this phase — `bundles` and `bundle_items` already exist and are RLS-verified live:

- `bundles`: `id, item_number, name, description, active, created_at, updated_at`
- `bundle_items`: `id, bundle_id, materials_catalog_id, default_qty, default_markup_pct, created_at, updated_at` — no cost column of its own; cost is read live from the joined `materials_catalog.purchase_cost` at render/save time, not snapshotted (snapshotting only happens later, when a bundle is applied to a job and copied into `job_line_items`).

**Cost calculation confirmed:** `materials_catalog.purchase_cost` is entered GST-inclusive already (not ex-GST). So for a bundle line item:

```
cost_inc_gst   = purchase_cost                          (direct, no tax_rate applied)
price_inc_gst  = cost_inc_gst × (1 + markup_pct / 100)
total_inc_gst  = price_inc_gst × qty
```

Same shape as the `job_line_items` generated columns, just sourcing `cost_inc_gst` straight from `materials_catalog.purchase_cost` instead of a stored snapshot column, since a bundle template should always reflect the catalog's current cost, not a stale one.

## Access control

Already built, no changes needed: `bundles`/`bundle_items` RLS is admin/office full CRUD, zero technician access (verified live in prior phases). UI-level access mirrors the Catalog pattern exactly:

- Nav link ("Bundles") in `AppShell.jsx`, hidden when `profile?.role === 'technician'`
- No route guard component — none exists anywhere in this codebase. RLS is the actual enforcement; nav-link hiding is just UX, consistent with how `/catalog` and `/clients/new` are handled.

## UI

### File layout (mirrors `Catalog*`)

| New file | Models on |
|---|---|
| `src/pages/BundleList.jsx` | `CatalogList.jsx` |
| `src/pages/BundleNew.jsx` | `CatalogNew.jsx` |
| `src/pages/BundleDetail.jsx` | `CatalogDetail.jsx` |
| `src/components/BundleForm.jsx` | `CatalogForm.jsx` |
| `src/hooks/useBundles.js` | `useMaterialsCatalog.js` |

One genuinely new piece with no precedent in this codebase: the line-item editor (in-memory array of rows, add/remove, live-calculated totals). The closest existing thing, `DiarySection.jsx`, is append-only (each entry is its own immediate DB insert) — not an editable in-memory array. This gets built as a sub-component, `BundleLineItemsEditor.jsx`, used inside `BundleForm.jsx`. Hand-rolled `useState`, no new dependencies (no form library or table library added — matches the rest of the app).

### Routes (in `App.jsx`, flat, same style as existing routes)

```jsx
<Route path="/bundles" element={<BundleList />} />
<Route path="/bundles/new" element={<BundleNew />} />
<Route path="/bundles/:id" element={<BundleDetail />} />
```

### `useBundles` hook

Deliberately **does not** filter `.eq('active', true)` the way `useMaterialsCatalog` does — the bundle list needs to show both active and archived bundles (status is a visible column, not a filter). Fetches all rows ordered by `name`, returns `{ bundles, loading, error }`.

### `BundleList` page

Table columns: Name, Item #, Status (`Active` / `Archived` badge derived from `active`), link to `/bundles/:id`. "Add Bundle" link to `/bundles/new`. Same plain `<table>` markup and global CSS classes as `CatalogList` — no new styling approach.

### `BundleForm` component

Scalar fields, controlled inputs, same shape as `CatalogForm`:
- `name` — required (matches `bundles.name not null`)
- `item_number` — optional text
- `description` — optional text
- Embeds `BundleLineItemsEditor` for the line items

`initialValues` prop (`null` for create, `{ bundle, items }` for edit) plus `onSubmit`/`submitLabel`, same as `CatalogForm` — not a mode flag.

### `BundleLineItemsEditor` (new)

Renders the current in-memory array of line-item rows as a table:

| Column | Source |
|---|---|
| Material | select dropdown of `materials_catalog` where `active = true`, fetched once on mount |
| Item # / Description | read-only, pre-filled from the selected material |
| Qty | numeric input, `default_qty`, `min="0"`, `step="0.01"` |
| Markup % | numeric input, `default_markup_pct`, `min="0"`, `step="0.01"` |
| Price (inc. GST) | read-only, computed live: `purchase_cost × (1 + markup_pct/100)` |
| Total (inc. GST) | read-only, computed live: price × qty |
| — | "Remove" button per row |

"Add line" control at the bottom (select a material, appends a row with `default_qty = 0`, `default_markup_pct = 0` — matches the existing decision that qty can be 0 and the row still shows so staff can adjust). Footer row: **Total Cost** (`Σ purchase_cost × qty`), **Total Markup** (`Σ total_inc_gst − Σ (purchase_cost × qty)`, shown as a dollar amount), **Total Price** (`Σ total_inc_gst`).

Materials picker excludes `active = false` rows — this was flagged as a known gap during the materials_catalog phase and is implemented here for the first time.

### Save / reconcile logic (new pattern — no existing precedent for a nested one-to-many save in this codebase)

On submit, in sequence:
1. Insert or update the `bundles` row itself (scalar fields).
2. Reconcile `bundle_items` against the in-memory array compared to what was originally loaded:
   - Rows present at load but removed from the array → `delete`
   - Rows with no existing `id` (added during this edit) → `insert`
   - Rows with an existing `id` and changed `qty`/`markup_pct` → `update`

This is several sequential Supabase calls, not a single transaction or RPC — consistent with how the rest of this codebase does mutations (direct client calls under RLS, no server-side transaction wrapping anywhere yet). **Known limitation, called out explicitly rather than glossed over:** if a later call in the sequence fails (e.g. a delete succeeds but a subsequent insert fails), the bundle can end up partially saved. This matches the risk profile of the rest of the app (no other screen wraps multi-step writes in a transaction either) so it's not a regression, but it's worth naming as a real gap rather than assuming atomicity that doesn't exist. Not proposing a fix in this phase (would mean introducing an RPC/transaction pattern that doesn't exist anywhere else yet) — flagging for awareness only.

Error handling matches the existing convention: raw Supabase error message surfaced via `setError(error.message)`, no toast library, no retry logic.

A brand-new bundle can be saved with zero line items (an empty shell staff fills in via a later edit) — nothing in this phase requires at least one row.

### Archive action

Button on `BundleDetail`, visible when `active = true`, with a confirm step (`window.confirm` or an inline confirm state — same low-tech approach as the rest of the app, no modal component exists to build this into). On confirm, `update bundles set active = false where id = ...`. One-way for this phase (see Scope).

## Testing

No automated JS test suite in this project — manual verification is the existing pattern, same as every other phase:
- `npm run build` / `npx oxlint` as a compile-cleanliness check
- Manual sign-in as admin: create a bundle with 2+ line items, verify totals compute correctly, edit (add/remove/change a line), archive it, confirm it still shows in the list with an Archived badge
- Manual sign-in as office: same CRUD checks (RLS already verified live at the DB layer; this is a UI-level sanity pass, not re-verifying RLS)
- Manual sign-in as technician: confirm the "Bundles" nav link is hidden and `/bundles` is inaccessible (RLS already denies at the DB layer; this confirms the UI doesn't show a broken/empty page instead of just not linking to it)
- Confirm the materials picker in the line-item editor only ever offers `active = true` materials_catalog rows
