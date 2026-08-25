# Invoicing — Design Spec

**Date:** 2026-08-25
**Status:** Approved

## Background

Job Billing Integration (bundles, bundle items, job line items, applied bundles) shipped and is fully live-verified. `jobs.invoiced` has existed as a placeholder boolean since Day 1-2 (comment: "Invoicing is a separate future feature"), but nothing populates or reads it yet. This phase builds real invoice generation on top of the now-real `job_line_items` data — not mocked, unlike email/SMS, since there's no external system to fake: an invoice is just a PDF built from data already in this app.

"Send to client" (routing a generated invoice through the existing mocked email feature) is explicitly deferred to a later phase. This phase is invoice creation and PDF generation only.

## Relationship to existing screens

`JobDetail.jsx` already mounts `BillingSection` between the job info block and `DiarySection`, sourced from `useJobBilling(jobId, role)`. The new `InvoiceSection` follows immediately after `BillingSection` (Billing produces line items; Invoicing consumes them) and before `DiarySection`. It reuses `useJobBilling`'s already-loaded line items for the "pick which lines go on this invoice" step rather than re-querying.

It also follows the numbering precedent set by `job_number`/`formatJobNumber()` in `jobConstants.js`: a display-friendly number derived client-side from a stored integer, not stored pre-formatted.

## Scope

In scope:
- `invoices` and `invoice_line_items` tables + RLS
- `create_invoice(target_job_id uuid, line_item_ids uuid[])` — new atomic, `security invoker` function, second write-capable function in this project after `apply_bundle_to_job()`
- `InvoiceSection` on `JobDetail`, staff only, placed after `BillingSection`
- Invoice creation UI: checklist picker over the job's current line items (any status, any subset, a line item may be picked for more than one invoice)
- Editable `paid_amount` per invoice (office/admin, direct update)
- Client-side PDF generation and download via `jspdf` + `jspdf-autotable`
- New hardcoded `src/lib/companyInfo.js` (name, ABN, phone, email, website, address) for the PDF header, reusing the existing `src/assets/zenith-logo.png`
- `formatInvoiceNumber(jobNumber, sequenceNum)` in `jobConstants.js`, producing `Invoice #0001-A`

Out of scope (explicitly deferred):
- "Send to client" (routing a generated PDF through the mocked email feature)
- Void or delete of an issued invoice — noted below as a future item for the professional developer, not built now
- Real payment tracking (payment history, partial-payment records, due dates) — `paid_amount` is a single manually-edited figure, not a ledger
- Any change to `jobs.invoiced` (left as-is; not wired up this phase)
- Gating invoice creation by job status — invoices can be created at any status

## Data model

```sql
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  sequence_num integer not null,
  paid_amount numeric(10, 2) not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, sequence_num)
);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_line_item_id uuid references public.job_line_items(id) on delete set null,
  item_name_snapshot text not null,
  qty numeric(10, 2) not null,
  unit_price_inc_gst_snapshot numeric(10, 2) not null,
  total_inc_gst_snapshot numeric(10, 2) not null,
  created_at timestamptz not null default now()
);
```

`invoice_line_items` snapshots `item_name_snapshot`/`qty`/price fields at creation time, copied from `job_line_items`, the same snapshot pattern already used for `bundle_items` → `job_line_items`. This is what lets one `job_line_items` row be picked for multiple invoices without a uniqueness conflict, and it means a later edit or deletion of the source `job_line_items` row can never retroactively change a PDF that's already been generated and handed to a client. `job_line_item_id` is kept only as an optional traceability pointer back to the source row (`on delete set null` — losing the pointer doesn't lose the invoice).

`sequence_num` is a per-job counter (1, 2, 3...), formatted client-side by `formatInvoiceNumber()` as a letter suffix (`1` → `A`, `2` → `B`, ...) appended to the job's zero-padded `job_number`, mirroring how `formatJobNumber()` already formats `job_number` alone. The `unique (job_id, sequence_num)` constraint plus assigning the number via `coalesce(max(sequence_num), 0) + 1` inside `create_invoice()`'s own insert statement (not a separate client-side read) prevents two concurrent invoice creations on the same job from colliding on the same letter.

**Accepted limitation:** the letter suffix scheme covers 26 invoices per job (`A`–`Z`). Given the real-world workflow (deposit + progress + final, rarely more than a handful of invoices per job), this is treated as effectively unlimited and not engineered around — a 27th invoice on one job is not a case this phase handles.

GST figures are derived, not stored: since `job_line_items`/`invoice_line_items` amounts are GST-inclusive at a flat, implicit 10% (confirmed project-wide assumption — see `cost_inc_gst` comments in the Job Billing Integration work), ex-GST unit/total prices for the PDF table are computed as `amount_inc_gst / 1.1`, and the GST component as `amount_inc_gst / 11`, at render time. No new tax-rate columns.

**`create_invoice(target_job_id uuid, line_item_ids uuid[])` — new.** Inserts one `invoices` header row (`job_id`, `sequence_num` computed as above, `created_by = auth.uid()`), then inserts one `invoice_line_items` row per id in `line_item_ids`, sourcing `item_name_snapshot`/`qty`/`unit_price_inc_gst_snapshot` (= `price_inc_gst`) /`total_inc_gst_snapshot` (= `total_inc_gst`) directly from the matching `job_line_items` rows (filtered to `job_id = target_job_id`, so a caller can't smuggle in another job's line item ids). Both inserts happen inside one function call, atomic the same way `apply_bundle_to_job()` is. `security invoker` (the default) — admin/office already have full INSERT rights on both new tables via RLS below, so like `apply_bundle_to_job()` this function buys atomicity and correct server-side sourcing of the snapshot values, not elevated privilege. A technician calling it directly hits the same RLS denial they'd hit calling the tables directly.

## Access control

Follows the narrowed pattern already used for `clients`/`jobs`/`materials_catalog`/`bundles` (not the older office-`for all` pattern still present on `job_line_items`/`job_applied_bundles`, which this phase doesn't touch):

- `invoices` — admin `for all`; office explicit select/insert/update (update needed for `paid_amount` edits only — nothing else on an invoice is ever updated); no delete for anyone.
- `invoice_line_items` — admin `for all`; office explicit select/insert (no update — line items are immutable once created); no delete for anyone.
- Technician — zero access to either table. No RPC is provided for technicians to read invoices; the whole feature is nav-hidden and RLS-blocked, same shape as `materials_catalog`/`bundles`.

No delete policy exists for anyone this phase. Voiding an issued invoice (as distinct from deleting one — preserving the audit trail is the point) is left as a documented future item; see "Not Started Yet" note added to `CLAUDE.md`. Any test invoices created during this phase's live verification will be cleaned up via direct SQL afterward, the same way test data has been handled for every other feature in this project.

## UI

### Placement and list

`InvoiceSection` mounts in `JobDetail.jsx` immediately after `BillingSection`, staff only (not rendered at all for technicians — matches the `CommunicationSection` email-tab precedent for staff-only sections). It lists the job's existing invoices (newest first): `Invoice #0001-A`, created date, total inc GST, paid amount, computed balance due (`total - paid`), and a "Download PDF" button per row.

### Creating an invoice

A "Create Invoice" button opens a checklist of the job's current line items — reusing the same grouped-by-bundle data `BillingSection`/`useJobBilling` already loads, rendered as checkboxes rather than the read-only display. No percentage split, no auto-computed "remaining balance" selection — office/admin manually ticks whichever lines belong on this invoice (a subset, all of them, or lines already used on a previous invoice). Confirming calls `create_invoice(jobId, selectedLineItemIds)`, then reloads the invoice list.

### Paid amount

Each invoice row has an editable `paid_amount` number input (office/admin only) with a Save button, doing a direct `update invoices set paid_amount = ... where id = ...`. Defaults to `0.00`, so an untouched invoice shows "$0.00 Paid" / full balance due without any special-casing.

### PDF generation

"Download PDF" builds the document client-side from data already in memory (the invoice row, its `invoice_line_items`, the job, and the client) using `jspdf` + `jspdf-autotable` — nothing is generated or stored server-side. Layout, top to bottom:

1. Zenith logo (top), with the company details block (`companyInfo.js`: name, address, ABN, phone, email, website) and the customer details block (client name/address from `clients`) side by side, mirrored
2. Large bold "Invoice" heading
3. `Invoice #0001-A` (via `formatInvoiceNumber`) and the invoice's created date
4. Line items table (`jspdf-autotable`): Description / QTY / Unit Price Ex GST / Total Price Ex GST, one row per `invoice_line_items` row, ex-GST figures derived as described above
5. Footer: Subtotal (ex GST), GST, Total (inc GST), Paid, Balance Due

Filename: `Invoice-0001-A.pdf` (job number + suffix, no spaces).

## Testing

No automated JS test suite — manual verification, same pattern as every prior phase:
- `npm run build` / `npx oxlint` as a compile-cleanliness check
- Manual SQL Editor re-verification of the new RLS: admin full CRUD on both tables; office select/insert on both plus update on `invoices.paid_amount` only; office has no delete on either table; technician fully blocked on both tables with no RPC path at all
- Manual call to `create_invoice()` as office/admin: confirm the header row gets the correct next `sequence_num` for that job, confirm one `invoice_line_items` row is created per selected id with correct snapshot values, confirm passing a line item id from a different job is silently excluded (no cross-job leak)
- Confirm the same `job_line_items` row can be selected onto two different invoices without error
- Manual sign-in as technician: confirm `InvoiceSection` is not rendered on the job detail page, confirm direct `select`/`insert` against `invoices`/`invoice_line_items` are blocked
- Generate an actual PDF as office/admin and visually check the layout against the design above (logo, mirrored blocks, heading, ABN, invoice number, line-items table, footer totals) and confirm the downloaded file opens correctly
- Edit `paid_amount` on an invoice, confirm it persists on reload and the balance-due figure in a freshly generated PDF reflects it
