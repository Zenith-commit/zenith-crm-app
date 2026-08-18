# Zenith CRM — Project Context

This file is read automatically at the start of every Claude Code session in this repo. It captures standing decisions, conventions, and current status so nothing gets re-explained, guessed, or contradicted across sessions.

## Project

CRM-style job management app for **Zenith Roof Restorations and Replacements Pty Ltd**, an Australian roofing company. Modeled loosely on ServiceM8, with custom features the client requested beyond that reference.

## Tech Stack

- Frontend: Vite + React
- Backend: Supabase (Postgres + Auth + Storage)
- Access control: Row-Level Security (RLS) keyed off `role` on `public.users`
- Repo: https://github.com/Zenith-commit/zenith-crm (private, under Zenith's business GitHub account — not a personal account)

## Roles

Three roles: `admin`, `office`, `technician`.

- **admin / office** — full access to client data, jobs, materials catalog, bundles, job line items (including cost/price/markup), job diary, communications
- **technician** — assigned to jobs only once a job reaches `Scheduled` status (soft rule — not yet enforced in code, needs eventual enforcement); can see job details and diary; on job line items, technicians may see **qty and item name only** — cost, markup, and price must be hidden from them at the query/RLS level, not just the UI

## Conventions

- **Soft-archive, not hard delete** — every catalog-style table (materials_catalog, bundles, etc.) uses an `active` boolean flag instead of deleting rows
- **RLS pattern** — admin/office-only tables follow the same policy shape already proven on `materials_catalog`: SELECT/INSERT/UPDATE/DELETE restricted to `admin` and `office` roles, zero access for `technician`
- **item_number** fields are optional and NOT unique (used as a display label, not a key)
- Always verify RLS with a live test against a technician-role test account before marking a table "done" — don't just review the policy definition
- Test accounts already exist for all three roles (admin, office, technician) against the live Supabase project — use these for verification, no need to create new ones

## Job Status Pipeline

`Quote → Work Order → Scheduled → Completed`

## What's Built (verified, live)

- Schema, auth, RLS for core tables: `users`, `clients`, `jobs`, `job_diary`, `communications` (five of the six original Day 1-2 tables — `job_costs` was also created in Day 1-2 but is being dropped, see below)
- Brand styling (navy/orange/white), routing shell, role-aware dashboard
- Client list/detail/create/edit
- Job list/detail/create/edit
- Job diary with photo upload
- **Materials & Services catalog** (`materials_catalog` table + RLS, list/create/edit UI at `/catalog`, admin/office only) — fully built, tested, pushed to GitHub. Fields: item_number (optional/non-unique), description, item_type (material/service), price, purchase_cost, tax_rate (defaults 10% GST), price_includes_tax, active flag.
- **`bundles` table + RLS** — reusable job-type template library, admin/office only. Fields: item_number (optional/non-unique), name, description, active flag. RLS verified live (admin insert, office update/archive, technician blocked).
- **`bundle_items` table + RLS** — line items belonging to a bundle, each referencing a `materials_catalog` row via FK, with default_qty (numeric, can be 0) and default_markup_pct. No `active` flag (line removal is a hard delete) and no sort_order column (displays in insertion order). Admin/office only. RLS verified live (admin insert, office insert+update, technician blocked with visible_count = 0).
- **Bundle management UI** (`/bundles`, `/bundles/new`, `/bundles/:id`, admin/office only) — fully built, manually verified, pushed to GitHub. `BundleList` shows a status column and originally showed both active and archived bundles unfiltered, unlike the Catalog list — since superseded by the hide-archived-by-default toggle below. `BundleForm` + `BundleLineItemsEditor` provide an in-memory editable line-item table (add/remove rows from an active-only materials picker, live per-row price/total, running Total Cost / Total Markup [$ and %] / Total Price footer). Line-item cost formula: `cost_inc_gst = materials_catalog.purchase_cost` directly (confirmed GST-inclusive, no `tax_rate` applied on top). Edit-mode save reconciles the in-memory array against `bundle_items` by `id` (sequential insert/update/delete calls, not a transaction — a known, accepted limitation shared with the rest of this app). Archive is one-way (`active = false` behind a confirm step, no unarchive UI yet). Spec: `docs/superpowers/specs/2026-08-12-bundle-management-ui-design.md`; plan: `docs/superpowers/plans/2026-08-12-bundle-management-ui.md`.
- **`job_line_items` table + RLS + `get_my_job_line_items()` RPC** — the actual per-job billing lines (copied from a bundle or added as one-offs). Fields: job_id, materials_catalog_id (nullable, for one-off lines), item_code_snapshot, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct, applied_bundle_id (nullable FK -> job_applied_bundles, added when that table was built), plus stored generated columns price_inc_gst and total_inc_gst. Admin/office full CRUD, same pattern as bundles/bundle_items. Technicians have zero access to the base table — they read qty + item_name_snapshot only through `get_my_job_line_items(job_id)`, a `SECURITY DEFINER` RPC mirroring `get_my_jobs()`, restricted to jobs assigned to them via the existing `technician_owns_job()` helper. RLS + RPC verified live (admin insert, office insert/update/delete, generated columns compute correctly, technician blocked on base table, technician RPC returns qty/name only for their own assigned job and nothing for a job that isn't theirs). `get_my_job_line_items()` was later extended to also return `applied_bundle_id` (see Apply Bundle to Job entry below) — re-verified live after that change, not assumed safe.
- **`job_applied_bundles` table + RLS** — tracks each "a bundle was applied to a job" event, so line items can be grouped by originating bundle and a whole applied bundle removed in one action. Fields: job_id, bundle_id, bundle_name_snapshot, applied_at, applied_by. A bundle can be applied to the same job more than once (each a separate row). `job_line_items.applied_bundle_id` references this table `on delete cascade` — deleting an applied-bundle row removes exactly the line items that belong to it; one-off lines (`applied_bundle_id` null) and other bundles' lines are unaffected. Admin/office only, same pattern as bundles/bundle_items. RLS + cascade behavior verified live (admin full CRUD, office insert+update, technician fully blocked, cascade deletes only the targeted bundle's lines).
- **Apply Bundle to Job** (`BillingSection` on the job detail page, `apply_bundle_to_job()` function) — fully built, manually verified, pushed to GitHub. `apply_bundle_to_job(target_job_id, target_bundle_id)` is the **first write-capable function in this project**: inserts one `job_applied_bundles` header row and one `job_line_items` row per `bundle_items` row as a single atomic call (`SECURITY INVOKER` — buys atomicity via existing RLS, not elevated privilege; a technician calling it directly gets a silent `null`, not an error, since RLS blocks its own internal `bundles` select before either insert runs). Applying an empty bundle is allowed (header row, zero lines). The same bundle can be applied to the same job more than once, each producing its own group. New `get_my_job_applied_bundles()` RPC mirrors `get_my_job_line_items()` so technicians get the same bundle-grouped read-only view (qty + item name only, group names, no cost/markup/price). Grouping/collapsing uses native `<details>/<summary>` — no new dependency. Line items are editable form-style (edit-then-Save per row, not inline), one-off items can be added with a live client-side price preview, and both remove-whole-bundle (deletes the `job_applied_bundles` row, cascade handles its lines) and remove-individual-line actions are confirm-gated, staff only. Spec: `docs/superpowers/specs/2026-08-12-apply-bundle-to-job-design.md`; plan: `docs/superpowers/plans/2026-08-12-apply-bundle-to-job.md`. This completes the Job Billing Integration feature end to end.
- **Client contact info & site address on Job Detail** — `jobs.site_address` (text, nullable) added. `JobDetail` has a new `ClientSiteInfoSection` showing the linked client's name (read-only, links through to `/clients/:id`), phone, and email (from `clients`), plus the job's `site_address`. Both are inline-editable for admin/office as one combined form with a single Save button; under the hood Save fires independent updates to `clients` and `jobs` (no transaction, consistent with the rest of this app's accepted non-atomic multi-table writes), and each reports its own error, so a partial failure (one table succeeds, one fails) is surfaced rather than silently swallowed; the form only closes on full success. A "Copy from Client Address" button fills `site_address` from the client's own `address` on request only, no automatic prefill, starts blank on a new job. Technicians see the same client name/phone/email/site_address, read-only, via the updated `get_my_jobs()` RPC. Required no RLS change (`clients_technician_select` was already row-level, not column-level — technicians could already reach a client's phone/email by navigating to `/clients/:id`, this just surfaces it on the job page too), only extending the RPC's return columns and the frontend queries.
- **`job_type` and `quoted_price` removed from `jobs`** — both columns dropped, along with the `public.job_type` enum type itself, plus every UI/query reference (`JobForm`, `JobRow`, `JobList`, `ClientDetail`'s job-history table, `JobDetail`, `useJob.js`, `useJobs.js`, `jobConstants.js`). `job_type` is fully replaced by `site_address` everywhere it used to appear (Jobs list, job history table); `quoted_price` has no replacement — real pricing now comes entirely from `job_line_items`/bundles, per the original Job Billing Integration design, so the column was redundant. `get_my_jobs()` was drop/recreated (a return-column change, not just `create or replace`) to match, verified live via `pg_get_function_result` against `pg_proc` and a separate technician-impersonation read test, not assumed safe from the DDL alone.
- **Bundle list hides archived bundles by default** — `/bundles` has a "Hide archived bundles" checkbox, checked by default; unchecking restores the original show-all behavior. Pure client-side filter on the existing `active` flag, no schema or RLS change.

## Current Phase: Job Billing Integration (Day 5-7) — COMPLETE

All four tables, bundle management UI, and the job-facing Apply Bundle to Job feature (billing section, apply/edit/remove) are built and verified live. Only dropping `job_costs` remains as a deliberate follow-up step — see "Explicit Decision" below.

**Real-world workflow this supports:** customer calls in → inspector visits, writes inspection notes → quoting team selects a pre-built **bundle** (job-type template, e.g. "Concrete Roof Restoration") → bundle's line items get applied to the job → office can freely adjust qty/markup or add one-off items → totals calculate automatically.

**Architecture (four tables — the fourth, `job_applied_bundles`, was added after the original three-table plan to support grouping/bulk-remove):**

1. **`bundles`** — reusable job-type templates (e.g. "Concrete Roof Restoration," "Gutter Installation"). Admin/office only, shared/global library — not per-staff. *(schema + RLS built and verified live)*
2. **`bundle_items`** — line items belonging to a bundle, each referencing a `materials_catalog` row, with a *default* qty (can be 0 — items still show so staff can adjust) and default markup %. Admin/office only. *(schema + RLS built and verified live)*
3. **`job_line_items`** — the actual per-job cost lines. Created by copying a bundle's items onto a specific job, then freely editable (qty, markup, or add new lines not from any bundle). Admin/office full read/write. Technicians: qty + item name only, no cost/markup/price. *(schema + RLS + technician RPC built and verified live)*
4. **`job_applied_bundles`** — one row per "bundle applied to a job" event; `job_line_items.applied_bundle_id` links back to it and cascades on delete, so removing this row is the "remove whole bundle" action. Admin/office only. *(schema + RLS built and verified live)*

**Calculated fields (per line):**
`price_inc_gst = cost_inc_gst × (1 + markup_pct / 100)`
`total_inc_gst = price_inc_gst × qty`

Bundle/job totals are the sum of their line items.

## Explicit Decision — Do Not Reuse job_costs

The original `job_costs` table (from Day 1-2) was designed around a receipt-OCR auto-extraction feature that was scoped out (workers send receipts via WhatsApp instead). It was never reshaped or reused — `bundles`, `bundle_items`, and `job_line_items` were built as fresh tables instead.

**Status: DROPPED.** Confirmed empty (row_count = 0) and unreferenced by any other table's foreign keys, then dropped live on 2026-08-19 (`DROP TABLE public.job_costs`, which also removed its RLS policies). Recorded in `supabase/migrations/2026-08-19_drop_job_costs.sql`. `supabase/schema/004_job_costs.sql` and `supabase/policies/005_job_costs_policies.sql` have been deleted from the fresh-install sequence to match. The `receipts` storage bucket policy (`supabase/storage/001_buckets_and_policies.sql`) was tied to the same scoped-out OCR feature and is now also unused — not touched as part of this drop, flagged here as a possible future cleanup.

## Not Started Yet

Job Billing Integration (schema, RLS, bundle management UI, and Apply Bundle to Job) is fully complete — see above. `job_costs` table drop is also complete — see "Explicit Decision" above.

- Job number auto-generation — jobs have no user-facing job number today; format not yet decided (distinct from the optional, non-unique `item_number` already used on catalog items/bundles).
- Hard-delete vs. archive decision for `clients` and `bundles` — current convention is soft-archive only (`active` flag) for catalog-style tables, and office can never delete `clients`/`jobs`/etc. per the RLS pattern. Whether that should ever change (e.g. a true hard-delete path for admin) hasn't been decided.
- Outlook/Microsoft 365 email integration (admin consent status unconfirmed — needs checking)
- SMS integration
- Security hardening pass
- Pilot testing
- Invoicing
- Installable mobile app (later phase, web app comes first)

## Working Style

- Verify what actually exists (files, commits, completed migrations) before assuming or building on top of it
- Confirm schema/RLS design with the human before implementing, especially for anything touching role-based access
- Report back what was created and the results of live verification tests before moving to the next table/feature
