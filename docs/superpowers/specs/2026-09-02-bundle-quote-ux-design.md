# Bundle/Quote UX Improvements — Design Spec

**Date:** 2026-09-02
**Status:** Approved

## Background

Third item (of the client's post-pilot feedback list, Phase A "quick win": "closer to ServiceM8"). Investigation surveyed the full bundle/quote surface — `BundleForm`/`BundleLineItemsEditor`/`BundleDetail`/`BundleList` (the template editor) and `BillingSection`/`BillingGroup`/`AddOneOffLineItemForm` (the job-side quoting UI) — and produced a longer list of possible improvements than could reasonably fit one pass. Three were selected for this pass; the rest (line-item editing ergonomics, drag-reorder, `default_qty` inconsistency, item code visibility on job billing, quote notes field, Quote PDF generation) are explicitly deferred, not forgotten — see "Out of scope" below.

**Two decisions in this spec were confirmed via direct answers in this session** (not independently re-verified with the client) — flagged explicitly at the point each is used, per instruction, rather than silently assumed:
- Duplicating a bundle copies its `item_number` verbatim (rather than blanking it).
- A duplicated job billing line item stays in the same bundle group as the original it was copied from.

## Relationship to existing screens

`MaterialPicker` replaces the plain `<select>` currently inline in both `BundleLineItemsEditor.jsx` (the "Add line" control) and `AddOneOffLineItemForm.jsx` (the "Material" control) — same component, different calling convention per caller (see below), no change to either component's surrounding form structure. "Duplicate Bundle" reuses `BundleForm`'s existing (already-built) support for a full pre-filled `initialValues.items` array — no changes to `BundleForm` itself. "Duplicate line item" adds one button each to `BundleLineItemsEditor` (in-memory clone) and `BillingGroup` (real DB insert), following the row-action pattern each already has (Remove; Remove/Edit).

## Scope

In scope:
- `MaterialPicker` component: searchable/filterable, used by both the bundle editor and one-off job line item forms
- "Duplicate Bundle" button on `BundleDetail`, pre-filling `/bundles/new` via router state
- "Duplicate line item" button in `BundleLineItemsEditor` (in-memory) and in `BillingGroup` (real insert, staff-only)
- Extending `useJobBilling`'s staff-role query with the extra columns the job-billing duplicate needs

Out of scope (explicitly deferred, not part of this pass):
- Line-item editing ergonomics on `BillingGroup` (inline-editable cells vs. today's Edit-then-Save-form-swap)
- Drag-and-drop / persisted reordering of line items (`bundle_items` has no `sort_order` column)
- The `default_qty` starting at `0` (bundle editor) vs. `1` (one-off items) inconsistency
- Showing item code/number on `BillingGroup`'s job-side table (currently name only)
- A quote-level notes/terms field, distinct from a bundle's own `description`
- Quote PDF generation (would reuse `src/lib/invoicePdf.js`'s pattern, same as the not-yet-scoped Roof Reports item) — a bigger, separately-scoped piece of work, not "polish"

## Data model

No new tables or columns. `MaterialPicker` and both duplicate actions read/write existing columns only.

## Access (RLS)

No changes. Everything here goes through existing admin/office policies on `bundles`, `bundle_items`, and `job_line_items` — all three actions are staff-only (Duplicate Bundle, Duplicate line item in both surfaces), matching the existing Edit/Remove/Archive/Delete precedent on the same screens. Technicians never see any of these buttons and have no insert access to `job_line_items` regardless.

## Frontend

### `MaterialPicker` (`src/components/MaterialPicker.jsx`, new)

Props: `materials` (array, already loaded by the caller via `useActiveMaterials()` — `MaterialPicker` does no fetching of its own), `onSelect(material)`, `selectedLabel` (string — what to show when nothing is being actively typed), `placeholder`.

Behavior:
- A text input plus a results list that opens on focus and closes on blur or selection.
- Filter: `materials.filter(m => m.description.toLowerCase().includes(q) || m.item_number?.toLowerCase().includes(q))`, case-insensitive, matched against either field. Empty query shows the full list (still browsable, not search-only).
- Selecting a result uses `onMouseDown` (not `onClick`) on each option, so the click registers before the input's `onBlur` closes the list — the standard combobox ordering gotcha.
- After calling `onSelect(material)`, the internal query clears and the list closes.
- When not focused and the query is empty, the input displays `selectedLabel` (or the placeholder if that's also empty) — this is what lets the two callers differ:
  - `BundleLineItemsEditor` passes `selectedLabel=""` always — after each immediate add, the picker returns to blank, ready for the next search (matches today's reset-after-add behavior).
  - `AddOneOffLineItemForm` passes `selectedLabel={selectedMaterial?.description ?? ''}` — the chosen material's name persists in the field until changed, since qty/markup are set afterward and the form isn't submitted yet.
- Real CSS from the start (`position: relative` on the wrapper, `position: absolute` on the results list, background/border/z-index) — not deferred to a follow-up fix this time.

### Duplicate Bundle (`BundleDetail.jsx`, `BundleNew.jsx`)

- `BundleDetail` gets a staff-only "Duplicate" button alongside Edit/Archive/Delete. On click, `navigate('/bundles/new', { state: { name: \`Copy of ${bundle.name}\`, item_number: bundle.item_number, description: bundle.description, items: items.map(item => ({ _key: item.id, id: null, materials_catalog_id: item.materials_catalog_id, item_number: item.item_number, description: item.description, purchase_cost: item.purchase_cost, default_qty: item.default_qty, default_markup_pct: item.default_markup_pct })) } })`.
  - `item_number` is copied verbatim — **confirmed via direct answer in this session**, not independently re-checked with the client. Reasoning offered at the time: `item_number` is already an optional, non-unique display label per this app's existing convention, so a duplicate carrying the same code isn't a new kind of ambiguity.
  - `_key` reuses each original `bundle_items.id` (already guaranteed unique within that bundle) rather than needing access to `BundleLineItemsEditor`'s private `newKey()` counter.
  - `id: null` on every duplicated item marks it as an unsaved new row, identical to how manually-added items already work.
- `BundleNew` reads `useLocation().state` and passes it as `initialValues` to `BundleForm` in place of `null`, when present. `BundleForm` already accepts a full `initialValues.items` array (built for edit mode) — no changes needed there.
- The duplicate always lands `active: true` regardless of the source bundle's status, for free — that's simply the existing `bundles.active` column default (`not null default true`) on a fresh insert via the normal create flow, not new logic.
- Nothing is persisted until the staff member reviews the pre-filled form and clicks "Create Bundle" — consistent with the New Job shortcut precedent, not an immediate silent DB copy.

### Duplicate line item — bundle editor (`BundleLineItemsEditor.jsx`)

New "Duplicate" button per row, next to "Remove". Clones the row (`materials_catalog_id`, `item_number`, `description`, `purchase_cost`, `default_qty`, `default_markup_pct`) with a fresh `_key` from the file's existing `newKey()` helper and `id: null`, inserted into the `items` array immediately after the original (not appended at the end). Nothing persists until the bundle form is saved — same as any other in-memory edit here.

### Duplicate line item — job billing (`BillingGroup.jsx`, `useJobBilling.js`)

New "Duplicate" button per row, next to "Edit"/"Remove", staff-only (matches those two already). On click, inserts a new `job_line_items` row: `{ job_id: item.job_id, materials_catalog_id: item.materials_catalog_id, item_code_snapshot: item.item_code_snapshot, item_name_snapshot: item.item_name_snapshot, qty: item.qty, cost_inc_gst_snapshot: item.cost_inc_gst_snapshot, markup_pct: item.markup_pct, applied_bundle_id: id }` (`price_inc_gst`/`total_inc_gst` are stored generated columns, never inserted directly — same as `AddOneOffLineItemForm` already does). `applied_bundle_id: id` uses `BillingGroup`'s own `id` prop (the group's `job_applied_bundles.id`, or `null` for "Other Items") — **the duplicate staying in the same group is confirmed via direct answer in this session**, not independently re-checked with the client.

This requires extending `useJobBilling`'s staff-role `job_line_items` select (currently `id, item_name_snapshot, qty, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id`) to also include `job_id, materials_catalog_id, item_code_snapshot, cost_inc_gst_snapshot` — the columns the duplicate insert needs that aren't already fetched for display. The technician RPC path (`get_my_job_line_items`) is untouched, since Duplicate is staff-only and technicians have no insert access to `job_line_items` regardless.

## Testing / verification plan

No RLS/DB changes to verify live beyond the existing staff-only gating already proven elsewhere. Manual browser verification:
- `MaterialPicker` in both the bundle editor and the one-off job form: empty-focus shows the full list, typing narrows by both description and item number, selecting via mouse works without the list closing first (the blur/mousedown ordering), and each caller's post-selection display behaves as designed (blank-and-reset vs. persists-until-changed)
- Duplicate Bundle: from an existing bundle (including an archived one), lands on a pre-filled New Bundle form with "Copy of {name}", the same `item_number`/`description`, and every line item present with correct qty/markup; nothing is created until "Create Bundle" is clicked; the result is `active: true` regardless of the source's status
- Duplicate line item (bundle editor): clones a row in place immediately after the original, in-memory only, discardable by navigating away without saving
- Duplicate line item (job billing): creates a real second row with matching qty/markup/material, staying inside the same collapsible bundle group as the original (or in "Other Items" if the original wasn't grouped); confirm technician sees no Duplicate button and the technician RPC view is unaffected
