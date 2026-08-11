# Materials & Services Catalog — Design Spec

**Date:** 2026-08-11
**Status:** Approved

## Background

Original Day 1-2 plan included per-job receipt logging with OCR/auto-extraction (`job_costs` table). Scope has changed: workers send receipts via WhatsApp separately, so OCR/auto-extraction is no longer needed. What's needed instead is a **Materials & Services catalog** — a reusable price list similar to ServiceM8's catalog — as its own table. This is not per-job cost logging; it's a standing list of items/services with sell price, purchase cost, and tax handling, usable across jobs later.

## Relationship to `job_costs`

`job_costs` (added Day 1-2) logs actual money spent on a specific job (vendor, amount, date) — an expense ledger entry. The materials catalog is a reusable price list, not tied to any job. These are different concepts and `job_costs` is left as-is; no changes to its schema, policies, or UI. They may connect later (e.g. pulling a catalog item onto a job to create a cost line), but that's job-billing integration, explicitly out of scope for this spec.

## Scope

In scope:
- `materials_catalog` table + RLS
- List screen (`/catalog`)
- Create screen (`/catalog/new`)
- Detail/edit screen (`/catalog/:id`)
- Nav link, admin/office only

Out of scope (explicitly deferred):
- Bundles/kits of catalog items
- Job billing integration (attaching catalog items to a job/quote)
- Inactive-item filter/toggle on the list view
- Computed tax-inclusive/exclusive display math

## Data model

New table `materials_catalog`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `item_number` | `text` | optional, not unique-constrained |
| `description` | `text` | required — the item's name/description (single field, matching ServiceM8's own field naming) |
| `item_type` | `text` | `'material'` or `'service'`, enforced via check constraint |
| `price` | `numeric(10,2)` | required — sell price |
| `purchase_cost` | `numeric(10,2)` | optional — what the business pays for it |
| `tax_rate` | `numeric(4,2)` | not null, default `10.00` (Australia GST) — stored per row rather than hardcoded in app code so it can be overridden later without a migration |
| `price_includes_tax` | `boolean` | not null, default `false` |
| `active` | `boolean` | not null, default `true` — archive flag; inactive items are excluded from the default list view instead of being hard-deleted, so future references (job billing integration) don't break |
| `created_at` | `timestamptz` | not null, default `now()` |

File: `supabase/schema/007_materials_catalog.sql`, following the same style as `004_job_costs.sql`.

## Access control

Admin/office only, hidden from technicians — same pattern as `job_costs`:
- `admin`: full access (select/insert/update/delete)
- `office`: full access (select/insert/update/delete)
- `technician`: no policy at all; RLS denies by default

File: `supabase/policies/008_materials_catalog_policies.sql`, following the same style as `005_job_costs_policies.sql`.

## UI

- **Routes**: `/catalog` (list), `/catalog/new` (create), `/catalog/:id` (detail/edit, inline edit toggle)
- **Nav**: "Catalog" link added to `AppShell`, rendered only when `profile.role !== 'technician'` (matches existing "Add Client" guard pattern)
- **`useMaterialsCatalog` hook**: mirrors `useClients` — fetches active rows ordered by `description`, returns `{ items, loading, error }`
- **`CatalogList` page**: table with columns Item #, Description, Type, Price, Purchase Cost, Tax Incl.?; "Add Item" link; shows `active = true` items only
- **`CatalogForm` component**: mirrors `ClientForm` — controlled inputs per field; `item_type` as a select (Material/Service); `price_includes_tax` as a select (Yes/No), defaulting to No; `tax_rate` pre-filled `10.00`; `price`/`purchase_cost` as `type="number" step="0.01"` inputs
- **`CatalogNew` / `CatalogDetail` pages**: thin wrappers around `CatalogForm`, same insert/update pattern as `ClientNew`/`ClientDetail`

No additional route guard beyond nav-link hiding and RLS — consistent with how the rest of the app handles technician access (e.g. `/clients/new` isn't blocked client-side either; RLS is the actual enforcement).

Tax fields are stored and displayed as entered — no computed inclusive/exclusive price shown on screen (deferred; not wired to billing yet).

## Testing

No automated JS test suite in this project (manual role-by-role verification is the existing pattern). Verification for this feature:
- `npm run build` / `npx oxlint` as a compile-cleanliness check
- Manual SQL Editor check that `materials_catalog` RLS denies technician access (same impersonation technique used for other tables)
- Manual sign-in as admin/office: create, edit, list an item; confirm nav link and pages are hidden for a technician sign-in
