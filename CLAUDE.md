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
- **`bundles` table + RLS** — reusable job-type template library, admin/office only. Fields: item_number (optional/non-unique), name, description, active flag. RLS verified live (admin insert, office update/archive, technician blocked). No UI yet — see Not Started Yet.
- **`bundle_items` table + RLS** — line items belonging to a bundle, each referencing a `materials_catalog` row via FK, with default_qty (numeric, can be 0) and default_markup_pct. No `active` flag (line removal is a hard delete) and no sort_order column (displays in insertion order). Admin/office only. RLS verified live (admin insert, office insert+update, technician blocked with visible_count = 0). No UI yet — see Not Started Yet.

## Current Phase: Job Billing Integration (Day 5-7)

**Real-world workflow this supports:** customer calls in → inspector visits, writes inspection notes → quoting team selects a pre-built **bundle** (job-type template, e.g. "Concrete Roof Restoration") → bundle's line items get applied to the job → office can freely adjust qty/markup or add one-off items → totals calculate automatically.

**Architecture (three new tables):**

1. **`bundles`** — reusable job-type templates (e.g. "Concrete Roof Restoration," "Gutter Installation"). Admin/office only, shared/global library — not per-staff. *(schema + RLS built and verified live)*
2. **`bundle_items`** — line items belonging to a bundle, each referencing a `materials_catalog` row, with a *default* qty (can be 0 — items still show so staff can adjust) and default markup %. Admin/office only. *(schema + RLS built and verified live)*
3. **`job_line_items`** — the actual per-job cost lines. Created by copying a bundle's items onto a specific job, then freely editable (qty, markup, or add new lines not from any bundle). Admin/office full read/write. Technicians: qty + item name only, no cost/markup/price. *(not yet built)*

**Calculated fields (per line):**
`price_inc_gst = cost_inc_gst × (1 + markup_pct / 100)`
`total_inc_gst = price_inc_gst × qty`

Bundle/job totals are the sum of their line items.

## Explicit Decision — Do Not Reuse job_costs

The original `job_costs` table (from Day 1-2) is being **dropped**, not reshaped or reused. It was designed around a receipt-OCR auto-extraction feature that was scoped out (workers send receipts via WhatsApp instead). Do not attempt to migrate data into it or build on top of it — build `bundles`, `bundle_items`, and `job_line_items` as fresh tables instead.

**Status: DROP not yet executed.** As of this file's last update, `job_costs` still physically exists in the live database, unused. The `DROP TABLE job_costs` command has not been run yet — this is a separate, deliberate step to be done once `bundles`, `bundle_items`, and `job_line_items` are built and verified, not before. Do not drop it as a side effect of an unrelated task.

## Not Started Yet

- Bundle list/create/edit UI
- "Apply bundle to job" action
- Job line items UI on the job detail page (editable table, live recalculation, add one-off line item)
- Drop `job_costs` table (`DROP TABLE`) — only after `bundles`, `bundle_items`, `job_line_items` are built and verified live; see "Explicit Decision" above
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
