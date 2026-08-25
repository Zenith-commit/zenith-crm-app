# Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real invoice generation built on the already-real `job_line_items` data — office/admin can create one or more invoices per job from a hand-picked subset of a job's line items, edit how much has been paid, and download an actual PDF — as specified in `docs/superpowers/specs/2026-08-25-invoicing-design.md`.

**Architecture:** Two new tables (`invoices`, `invoice_line_items`) following this project's established snapshot pattern (line items are copied at invoice-creation time, not live-referenced, mirroring `bundle_items` → `job_line_items`). One new atomic `security invoker` Postgres function, `create_invoice()`, the project's second write-capable function after `apply_bundle_to_job()`. Frontend follows the same hook/component conventions as every prior phase (role-branching where needed, direct Supabase calls for mutations, `<details>`-free flat tables since there's no grouping requirement here). PDF generation is entirely client-side via `jspdf` + `jspdf-autotable` — the one new frontend dependency this plan introduces.

**Tech Stack:** React 19 + Vite, `react-router-dom`, `@supabase/supabase-js` (all existing). New: `jspdf`, `jspdf-autotable`. SQL changes run manually in the Supabase SQL Editor, same as every prior phase.

## Global Constraints

- No `for all`-for-office shortcut — `invoices`/`invoice_line_items` RLS follows the narrowed pattern (`clients`/`jobs`/`materials_catalog`/`bundles`): admin `for all`, office explicit select/insert(/update where noted), no office delete, zero technician access.
- `invoices` gets an office **update** policy (needed only for `paid_amount` edits — nothing else on an invoice is ever updated after creation). `invoice_line_items` gets **no** office update policy — line items are immutable once created.
- No delete policy for anyone on either table this phase. Invoices are permanent once generated. Voiding (as distinct from deleting) an issued invoice is a documented future item — not built now.
- `invoice_line_items` snapshots `item_name_snapshot`/`qty`/`unit_price_inc_gst_snapshot`/`total_inc_gst_snapshot` directly from the source `job_line_items` row at creation time. `job_line_item_id` is kept only as an optional traceability pointer (`on delete set null`).
- `invoices.sequence_num` is a per-job counter (1, 2, 3...) assigned via `coalesce(max(sequence_num), 0) + 1` **inside** `create_invoice()`'s own insert statement, not a separate client-side read, to avoid a race between two concurrent invoice creations on the same job. Formatted client-side as a letter suffix (`1` → `A`) by `formatInvoiceNumber()`. Accepted limitation: this covers 26 invoices per job (`A`–`Z`) — effectively unlimited for this workflow, not engineered further.
- GST figures are always derived, never stored: `job_line_items`/`invoice_line_items` amounts are GST-inclusive at a flat, implicit 10% (the existing project-wide assumption). Ex-GST = `amount_inc_gst / 1.1`; GST component = `amount_inc_gst / 11`.
- `create_invoice(target_job_id uuid, line_item_ids uuid[])` filters its line-item select to `job_line_items.job_id = target_job_id`, so an id belonging to a different job is silently excluded, not an error — a caller cannot smuggle another job's line item onto an invoice.
- Company details (`src/lib/companyInfo.js`) are **hardcoded placeholder values**, consistent with the "vision demo" standard already used for the mocked email/SMS feature. They are not real (ABN, phone, address are placeholders) and must be replaced with Zenith's real details before any real invoice leaves this app — flagged with an inline comment in the file, same convention as the mocked-email sender address.
- This project has no automated JS test framework. Every task's "verify" step is either a manual DB check (SQL Editor `do` blocks with `raise exception` reporting, auto-rolled-back) or a manual UI check (`npm run dev` + sign in as the admin/office/technician test accounts), plus `npm run build` / `npx oxlint`. Pure-function helpers are additionally verified with a one-line `node --input-type=module` check.

---

### Task 1: `invoices` and `invoice_line_items` tables + RLS

**Files:**
- Create: `supabase/schema/012_invoices.sql`
- Create: `supabase/schema/013_invoice_line_items.sql`
- Create: `supabase/policies/014_invoices_policies.sql`
- Create: `supabase/policies/015_invoice_line_items_policies.sql`

**Interfaces:**
- Consumes: `public.current_app_role()` helper (already exists, `supabase/policies/001_helper_function.sql`), `public.jobs`, `public.users`, `public.job_line_items`.
- Produces: `public.invoices(id, job_id, sequence_num, paid_amount, created_by, created_at)` and `public.invoice_line_items(id, invoice_id, job_line_item_id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot, created_at)`, both RLS-enabled, consumed by Task 2's function and every later frontend task.

- [ ] **Step 1: Write the invoices table**

Create `supabase/schema/012_invoices.sql`:

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

comment on table public.invoices is 'One invoice generated against a job. A job can have multiple invoices (e.g. deposit + final) -- sequence_num is a per-job counter (1, 2, 3...) assigned by create_invoice(), formatted client-side as a letter suffix by formatInvoiceNumber() in src/lib/jobConstants.js (e.g. "Invoice #0001-A"). No delete policy exists for any role -- invoices are immutable once created; only paid_amount is ever updated after creation. Voiding (as distinct from deleting) an issued invoice is a documented future item, not built in this phase.';
```

- [ ] **Step 2: Write the invoice_line_items table**

Create `supabase/schema/013_invoice_line_items.sql`:

```sql
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

comment on table public.invoice_line_items is 'Line items on an invoice, snapshotted from job_line_items at the moment an invoice is created (via create_invoice()) -- not a live reference. This is what lets the same job_line_items row be selected onto more than one invoice, and means a later edit or deletion of the source job_line_items row can never retroactively change an invoice that has already been generated. job_line_item_id is kept only as an optional traceability pointer back to the source row (on delete set null).';
```

- [ ] **Step 3: Write invoices RLS**

Create `supabase/policies/014_invoices_policies.sql`:

```sql
alter table public.invoices enable row level security;

create policy "invoices_admin_all" on public.invoices
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "invoices_office_select" on public.invoices
  for select
  using (public.current_app_role() = 'office');

create policy "invoices_office_insert" on public.invoices
  for insert
  with check (public.current_app_role() = 'office');

create policy "invoices_office_update" on public.invoices
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No office delete (invoices are immutable once created). No policy
-- at all for technicians -- deny by default, same as
-- materials_catalog/bundles. The office_update policy exists only so
-- paid_amount can be edited after creation; nothing else on an
-- invoice is ever updated.
```

- [ ] **Step 4: Write invoice_line_items RLS**

Create `supabase/policies/015_invoice_line_items_policies.sql`:

```sql
alter table public.invoice_line_items enable row level security;

create policy "invoice_line_items_admin_all" on public.invoice_line_items
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "invoice_line_items_office_select" on public.invoice_line_items
  for select
  using (public.current_app_role() = 'office');

create policy "invoice_line_items_office_insert" on public.invoice_line_items
  for insert
  with check (public.current_app_role() = 'office');

-- No office update or delete -- line items are immutable once
-- created (unlike invoices.paid_amount, nothing on an
-- invoice_line_items row is ever edited after the fact). No policy
-- at all for technicians -- deny by default, same as job_line_items.
```

- [ ] **Step 5: Run all four files against the live Supabase project**

In the Supabase SQL Editor, run `012_invoices.sql`, then `013_invoice_line_items.sql`, then `014_invoices_policies.sql`, then `015_invoice_line_items_policies.sql`, in that order (tables before their policies, `invoices` before `invoice_line_items` since the latter has an FK to the former).

- [ ] **Step 6: Verify RLS live**

Run this as one submission in the SQL Editor, filling in real admin, office, and technician test-account ids and a real job id:

```sql
do $$
declare
  test_job_id uuid;
  admin_invoice_id uuid;
  office_invoice_id uuid;
  office_delete_count int;
  office_line_update_count int;
  technician_invoice_count int;
  technician_line_count int;
begin
  select id into test_job_id from public.jobs limit 1;

  -- Admin: full CRUD
  perform set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
  set local role authenticated;

  insert into public.invoices (job_id, sequence_num, created_by)
  values (test_job_id, 9001, auth.uid())
  returning id into admin_invoice_id;

  insert into public.invoice_line_items (invoice_id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot)
  values (admin_invoice_id, 'RLS Test Line', 1, 100.00, 100.00);

  -- Office: select/insert/update on invoices, select/insert on invoice_line_items, no delete on either
  perform set_config('request.jwt.claims', json_build_object('sub', '<office-user-id>')::text, true);
  set local role authenticated;

  insert into public.invoices (job_id, sequence_num, created_by)
  values (test_job_id, 9002, auth.uid())
  returning id into office_invoice_id;

  update public.invoices set paid_amount = 50.00 where id = office_invoice_id;

  insert into public.invoice_line_items (invoice_id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot)
  values (office_invoice_id, 'Office Test Line', 1, 50.00, 50.00);

  delete from public.invoices where id = admin_invoice_id;
  get diagnostics office_delete_count = row_count;

  update public.invoice_line_items set qty = 99 where invoice_id = admin_invoice_id;
  get diagnostics office_line_update_count = row_count;

  -- Technician: no access to either table
  perform set_config('request.jwt.claims', json_build_object('sub', '<technician-user-id>')::text, true);
  set local role authenticated;

  select count(*) into technician_invoice_count from public.invoices where job_id = test_job_id;
  select count(*) into technician_line_count from public.invoice_line_items where invoice_id in (admin_invoice_id, office_invoice_id);

  raise exception 'office_delete_count = % (expect 0), office_line_update_count = % (expect 0), technician_invoice_count = % (expect 0), technician_line_count = % (expect 0)',
    office_delete_count, office_line_update_count, technician_invoice_count, technician_line_count;
end $$;
```

Expected: `office_delete_count = 0` (office's delete attempt on admin's invoice silently matched 0 rows — no delete policy), `office_line_update_count = 0` (office's update attempt on invoice_line_items silently matched 0 rows — no update policy), `technician_invoice_count = 0`, `technician_line_count = 0`. The exception auto-rolls back every insert/update/delete above — no cleanup needed. (Admin's own insert/update/delete steps completing without error along the way is itself part of the verification — if any admin step failed, the block would raise its own RLS error before reaching the final `raise exception`.)

- [ ] **Step 7: Commit**

```bash
git add supabase/schema/012_invoices.sql supabase/schema/013_invoice_line_items.sql supabase/policies/014_invoices_policies.sql supabase/policies/015_invoice_line_items_policies.sql
git commit -m "feat: add invoices and invoice_line_items tables with RLS"
```

---

### Task 2: `create_invoice()` function

**Files:**
- Create: `supabase/policies/016_create_invoice_function.sql`

**Interfaces:**
- Consumes: `public.invoices`, `public.invoice_line_items`, `public.job_line_items` (Task 1 + existing).
- Produces: `create_invoice(target_job_id uuid, line_item_ids uuid[]) returns uuid`, consumed by Task 5's `useInvoices` hook.

- [ ] **Step 1: Write the function**

Create `supabase/policies/016_create_invoice_function.sql`:

```sql
-- The project's second write-capable function, after apply_bundle_to_job().
-- Creates an invoice for a job: inserts one invoices header row
-- (sequence_num computed as the next per-job counter value in the same
-- statement, avoiding a race between concurrent calls on the same job)
-- and one invoice_line_items row per id in line_item_ids, snapshotting
-- item_name_snapshot/qty/price directly from job_line_items at this
-- moment. The job_id filter on the line-item select means an id
-- belonging to a different job is silently excluded, not an error -- a
-- caller cannot smuggle another job's line item onto this invoice.
--
-- SECURITY INVOKER (the default -- no keyword needed): admin/office
-- already have full INSERT rights on both tables via existing RLS, so
-- this buys atomicity and server-side-sourced snapshot values, not
-- elevated privilege. Unlike apply_bundle_to_job (whose first insert is
-- an INSERT ... SELECT that just inserts zero rows under missing SELECT
-- access, returning null silently), this function's first insert is a
-- plain INSERT ... VALUES -- a technician calling this directly hits an
-- actual RLS policy violation (SQLSTATE 42501) on that insert, since
-- they have no insert policy on invoices at all. The call errors out
-- rather than returning null.
create or replace function public.create_invoice(target_job_id uuid, line_item_ids uuid[])
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_invoice_id uuid;
begin
  insert into public.invoices (job_id, sequence_num, created_by)
  values (
    target_job_id,
    coalesce((select max(sequence_num) from public.invoices where job_id = target_job_id), 0) + 1,
    auth.uid()
  )
  returning id into new_invoice_id;

  insert into public.invoice_line_items (
    invoice_id, job_line_item_id, item_name_snapshot, qty,
    unit_price_inc_gst_snapshot, total_inc_gst_snapshot
  )
  select
    new_invoice_id,
    job_line_items.id,
    job_line_items.item_name_snapshot,
    job_line_items.qty,
    job_line_items.price_inc_gst,
    job_line_items.total_inc_gst
  from public.job_line_items
  where job_line_items.id = any(line_item_ids)
    and job_line_items.job_id = target_job_id;

  return new_invoice_id;
end;
$$;

comment on function public.create_invoice(uuid, uuid[]) is 'Creates an invoice for a job: one invoices header row (sequence_num = next per-job counter, computed atomically in the same insert) plus one invoice_line_items row per id in line_item_ids, snapshotting item_name_snapshot/qty/price_inc_gst/total_inc_gst from job_line_items at this moment. The job_id filter on the line-item select silently excludes any id belonging to a different job. SECURITY INVOKER -- admin/office already have full INSERT rights on both tables via RLS, so this buys atomicity and server-side snapshot sourcing, not elevated privilege. A technician calling this directly gets a real RLS policy violation on the header insert (unlike apply_bundle_to_job''s silent-null pattern), since technicians have no insert policy on invoices.';
```

- [ ] **Step 2: Run the file against the live Supabase project**

Run `016_create_invoice_function.sql` in the SQL Editor.

- [ ] **Step 3: Verify live**

Run this as one submission in the SQL Editor, filling in real admin, office, and technician test-account ids:

```sql
do $$
declare
  test_job_id uuid;
  other_job_id uuid;
  line_1_id uuid;
  line_2_id uuid;
  other_job_line_id uuid;
  invoice_1_id uuid;
  invoice_2_id uuid;
  invoice_3_id uuid;
  invoice_1_seq int;
  invoice_1_line_count int;
  invoice_1_snapshot_matches boolean;
  invoice_2_seq int;
  invoice_2_line_count int;
  invoice_3_seq int;
  technician_error_caught boolean := false;
begin
  select id into test_job_id from public.jobs limit 1;
  select id into other_job_id from public.jobs where id <> test_job_id limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
  set local role authenticated;

  insert into public.job_line_items (job_id, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct)
  values (test_job_id, 'Invoice Test Line A', 2, 55.00, 0)
  returning id into line_1_id;

  insert into public.job_line_items (job_id, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct)
  values (test_job_id, 'Invoice Test Line B', 1, 30.00, 0)
  returning id into line_2_id;

  insert into public.job_line_items (job_id, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct)
  values (other_job_id, 'Other Job Line', 1, 10.00, 0)
  returning id into other_job_line_id;

  -- Invoice 1: both lines, plus a cross-job id that should be silently excluded
  select public.create_invoice(test_job_id, array[line_1_id, line_2_id, other_job_line_id]) into invoice_1_id;

  select sequence_num into invoice_1_seq from public.invoices where id = invoice_1_id;
  select count(*) into invoice_1_line_count from public.invoice_line_items where invoice_id = invoice_1_id;
  select bool_and(item_name_snapshot in ('Invoice Test Line A', 'Invoice Test Line B') and total_inc_gst_snapshot in (110.00, 30.00))
    into invoice_1_snapshot_matches
    from public.invoice_line_items where invoice_id = invoice_1_id;

  -- Invoice 2: reuse line_1_id (same job_line_items row on two invoices)
  select public.create_invoice(test_job_id, array[line_1_id]) into invoice_2_id;
  select sequence_num into invoice_2_seq from public.invoices where id = invoice_2_id;
  select count(*) into invoice_2_line_count from public.invoice_line_items where invoice_id = invoice_2_id;

  -- Office: creates a third invoice on the same job
  perform set_config('request.jwt.claims', json_build_object('sub', '<office-user-id>')::text, true);
  set local role authenticated;

  select public.create_invoice(test_job_id, array[line_2_id]) into invoice_3_id;
  select sequence_num into invoice_3_seq from public.invoices where id = invoice_3_id;

  -- Technician: real RLS violation, not a silent null
  perform set_config('request.jwt.claims', json_build_object('sub', '<technician-user-id>')::text, true);
  set local role authenticated;

  begin
    perform public.create_invoice(test_job_id, array[line_1_id]);
  exception when insufficient_privilege then
    technician_error_caught := true;
  end;

  raise exception 'invoice_1_seq = % (expect 1), invoice_1_line_count = % (expect 2, cross-job id excluded), invoice_1_snapshot_matches = % (expect true), invoice_2_seq = % (expect 2), invoice_2_line_count = % (expect 1, reused line_1_id), invoice_3_seq = % (expect 3, office continues the same counter), technician_error_caught = % (expect true)',
    invoice_1_seq, invoice_1_line_count, invoice_1_snapshot_matches, invoice_2_seq, invoice_2_line_count, invoice_3_seq, technician_error_caught;
end $$;
```

Expected: `invoice_1_seq = 1`, `invoice_1_line_count = 2` (the `other_job_line_id` was silently excluded, not inserted, not an error), `invoice_1_snapshot_matches = true`, `invoice_2_seq = 2`, `invoice_2_line_count = 1` (confirms `line_1_id` was accepted onto a second invoice with no conflict), `invoice_3_seq = 3` (confirms office and admin share the same per-job counter correctly), `technician_error_caught = true`. The exception auto-rolls back everything — no cleanup needed.

- [ ] **Step 4: Commit**

```bash
git add supabase/policies/016_create_invoice_function.sql
git commit -m "feat: add create_invoice function"
```

---

### Task 3: Frontend calc/format helpers and hardcoded company info

**Files:**
- Modify: `src/lib/jobConstants.js`
- Create: `src/lib/invoiceCalc.js`
- Create: `src/lib/companyInfo.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatInvoiceNumber(jobNumber, sequenceNum)` (added to `jobConstants.js`, alongside the existing `formatJobNumber`), `calcExGst(amountIncGst)` / `calcGstComponent(amountIncGst)` (`invoiceCalc.js`), `COMPANY_INFO` (`companyInfo.js`) — all three consumed by Task 4's `invoicePdf.js` and Task 5/6's `InvoiceSection.jsx`.

- [ ] **Step 1: Add formatInvoiceNumber to jobConstants.js**

In `src/lib/jobConstants.js`, add below the existing `formatJobNumber`:

```js
export function formatInvoiceNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Invoice #${String(jobNumber).padStart(4, '0')}-${letter}`
}
```

- [ ] **Step 2: Verify formatInvoiceNumber**

Run: `node --input-type=module -e "import { formatInvoiceNumber } from './src/lib/jobConstants.js'; console.log(formatInvoiceNumber(1, 1)); console.log(formatInvoiceNumber(23, 2))"`
Expected output:
```
Invoice #0001-A
Invoice #0023-B
```

- [ ] **Step 3: Create invoiceCalc.js**

Create `src/lib/invoiceCalc.js`:

```js
export function calcExGst(amountIncGst) {
  return amountIncGst / 1.1
}

export function calcGstComponent(amountIncGst) {
  return amountIncGst / 11
}
```

- [ ] **Step 4: Verify invoiceCalc.js**

Run: `node --input-type=module -e "import { calcExGst, calcGstComponent } from './src/lib/invoiceCalc.js'; console.log(calcExGst(110).toFixed(2)); console.log(calcGstComponent(110).toFixed(2))"`
Expected output:
```
100.00
10.00
```

- [ ] **Step 5: Create companyInfo.js**

Create `src/lib/companyInfo.js`:

```js
// Placeholder company details for the invoice PDF header -- consistent
// with the mocked email/SMS feature's "vision demo" standard (see
// src/components/CommunicationSection.jsx). ABN, address, and phone
// here are NOT real and must be replaced with Zenith's actual details
// before any real invoice is generated and sent to a client.
export const COMPANY_INFO = {
  name: 'Zenith Roof Restorations and Replacements Pty Ltd',
  address: '123 Example Street, Brisbane QLD 4000',
  abn: '00 000 000 000',
  phone: '(07) 0000 0000',
  email: 'office@zenith-demo.local',
  website: 'www.zenith-demo.local',
}
```

- [ ] **Step 6: Run build/lint**

Run `npm run build` and `npx oxlint` — both clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jobConstants.js src/lib/invoiceCalc.js src/lib/companyInfo.js
git commit -m "feat: add invoice number formatting, GST calc helpers, and placeholder company info"
```

---

### Task 4: PDF generation

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `src/lib/invoicePdf.js`

**Interfaces:**
- Consumes: `COMPANY_INFO` (Task 3), `formatInvoiceNumber` (Task 3), `calcExGst`/`calcGstComponent` (Task 3), `src/assets/zenith-logo.png` (existing).
- Produces: `generateInvoicePdf({ job, client, invoice })` — `job` needs `{ job_number }`, `client` needs `{ name, address }`, `invoice` needs `{ sequence_num, created_at, paid_amount, invoice_line_items: [{ item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot }] }`. Triggers a browser download, no return value. Consumed by Task 6's `InvoiceSection.jsx`.

- [ ] **Step 1: Install dependencies**

Run: `npm install jspdf jspdf-autotable`

- [ ] **Step 2: Create invoicePdf.js**

Create `src/lib/invoicePdf.js`:

```js
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { COMPANY_INFO } from './companyInfo'
import { formatInvoiceNumber } from './jobConstants'
import { calcExGst, calcGstComponent } from './invoiceCalc'
import logoUrl from '../assets/zenith-logo.png'

async function loadImageAsDataUrl(url) {
  const response = await fetch(url)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function generateInvoicePdf({ job, client, invoice }) {
  const doc = new jsPDF()
  const logoDataUrl = await loadImageAsDataUrl(logoUrl)

  doc.addImage(logoDataUrl, 'PNG', 14, 10, 28, 28)

  doc.setFontSize(9)
  doc.text(
    [
      COMPANY_INFO.name,
      COMPANY_INFO.address,
      `ABN: ${COMPANY_INFO.abn}`,
      COMPANY_INFO.phone,
      COMPANY_INFO.email,
      COMPANY_INFO.website,
    ],
    196,
    15,
    { align: 'right' }
  )

  doc.setFontSize(9)
  doc.text(['Bill To:', client.name, client.address ?? ''], 14, 48)

  doc.setFontSize(22)
  doc.setFont(undefined, 'bold')
  doc.text('INVOICE', 14, 68)
  doc.setFont(undefined, 'normal')

  const invoiceNumber = formatInvoiceNumber(job.job_number, invoice.sequence_num)
  doc.setFontSize(11)
  doc.text(invoiceNumber, 14, 76)
  doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, 14, 82)

  const rows = invoice.invoice_line_items.map((item) => [
    item.item_name_snapshot,
    String(item.qty),
    `$${calcExGst(item.unit_price_inc_gst_snapshot).toFixed(2)}`,
    `$${calcExGst(item.total_inc_gst_snapshot).toFixed(2)}`,
  ])

  autoTable(doc, {
    startY: 90,
    head: [['Description', 'QTY', 'Unit Price Ex GST', 'Total Price Ex GST']],
    body: rows,
  })

  const totalIncGst = invoice.invoice_line_items.reduce((sum, item) => sum + item.total_inc_gst_snapshot, 0)
  const subtotalExGst = calcExGst(totalIncGst)
  const gst = calcGstComponent(totalIncGst)
  const paidAmount = invoice.paid_amount ?? 0
  const balanceDue = totalIncGst - paidAmount

  const finalY = doc.lastAutoTable.finalY + 10
  doc.setFontSize(10)
  doc.text(`Subtotal (ex GST): $${subtotalExGst.toFixed(2)}`, 196, finalY, { align: 'right' })
  doc.text(`GST: $${gst.toFixed(2)}`, 196, finalY + 6, { align: 'right' })
  doc.text(`Total (inc GST): $${totalIncGst.toFixed(2)}`, 196, finalY + 12, { align: 'right' })
  doc.text(`Paid: $${paidAmount.toFixed(2)}`, 196, finalY + 18, { align: 'right' })
  doc.text(`Balance Due: $${balanceDue.toFixed(2)}`, 196, finalY + 24, { align: 'right' })

  const filename = `Invoice-${String(job.job_number).padStart(4, '0')}-${String.fromCharCode(64 + invoice.sequence_num)}.pdf`
  doc.save(filename)
}
```

- [ ] **Step 3: Verify build**

Run `npm run build` and `npx oxlint` — both clean. (Full visual verification of the generated PDF happens in Task 6, once real invoice data exists to generate from.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/invoicePdf.js
git commit -m "feat: add client-side invoice PDF generation"
```

---

### Task 5: Invoice list and creation UI

**Files:**
- Create: `src/hooks/useInvoices.js`
- Create: `src/components/CreateInvoiceForm.jsx`
- Create: `src/components/InvoiceSection.jsx`
- Modify: `src/pages/JobDetail.jsx`

**Interfaces:**
- Consumes: `create_invoice` RPC (Task 2), `useJobBilling` (existing, `src/hooks/useJobBilling.js`), `formatInvoiceNumber` (Task 3).
- Produces: `useInvoices(jobId)` returns `{ invoices, loading, error, reload, createInvoice, updatePaidAmount }`. `invoices[i]` is `{ id, sequence_num, paid_amount, created_at, invoice_line_items: [{ id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot }] }`. `createInvoice(lineItemIds)` and `updatePaidAmount(invoiceId, amount)` both return `{ error }`. `<CreateInvoiceForm lineItems onCreate />` and `<InvoiceSection job role />` — the latter is replaced in full by Task 6 to add paid-amount editing and PDF download.

- [ ] **Step 1: Create the useInvoices hook**

Create `src/hooks/useInvoices.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useInvoices(jobId) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('invoices')
      .select(
        'id, sequence_num, paid_amount, created_at, invoice_line_items(id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot)'
      )
      .eq('job_id', jobId)
      .order('sequence_num')

    if (error) {
      setError(error)
      setLoading(false)
      return
    }
    setInvoices(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function createInvoice(lineItemIds) {
    const { error } = await supabase.rpc('create_invoice', {
      target_job_id: jobId,
      line_item_ids: lineItemIds,
    })
    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function updatePaidAmount(invoiceId, paidAmount) {
    const { error } = await supabase.from('invoices').update({ paid_amount: paidAmount }).eq('id', invoiceId)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { invoices, loading, error, reload, createInvoice, updatePaidAmount }
}
```

- [ ] **Step 2: Create the CreateInvoiceForm component**

Create `src/components/CreateInvoiceForm.jsx`:

```jsx
import { useState } from 'react'

export default function CreateInvoiceForm({ lineItems, onCreate }) {
  const [selectedIds, setSelectedIds] = useState([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  function toggle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.length === 0) return
    setCreating(true)
    setError(null)
    const { error } = await onCreate(selectedIds)
    setCreating(false)
    if (error) {
      setError(error.message)
      return
    }
    setSelectedIds([])
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Create Invoice</h3>
      {lineItems.length === 0 && <p>No line items on this job yet.</p>}
      <ul>
        {lineItems.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
              {item.item_name_snapshot} — Qty {item.qty} — ${item.total_inc_gst.toFixed(2)}
            </label>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={selectedIds.length === 0 || creating}>
        {creating ? 'Creating...' : 'Create Invoice'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Create the InvoiceSection component**

Create `src/components/InvoiceSection.jsx`:

```jsx
import { useInvoices } from '../hooks/useInvoices'
import { useJobBilling } from '../hooks/useJobBilling'
import { formatInvoiceNumber } from '../lib/jobConstants'
import CreateInvoiceForm from './CreateInvoiceForm'

export default function InvoiceSection({ job, role }) {
  const { invoices, loading, error, createInvoice } = useInvoices(job.id)
  const { groups, otherItems } = useJobBilling(job.id, role)
  const lineItems = [...groups.flatMap((group) => group.items), ...otherItems]

  if (loading) return <p>Loading invoices...</p>
  if (error) return <p role="alert">Could not load invoices: {error.message}</p>

  return (
    <section>
      <h2>Invoices</h2>
      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Created</th>
            <th>Total (inc GST)</th>
            <th>Paid</th>
            <th>Balance Due</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const totalIncGst = invoice.invoice_line_items.reduce((sum, item) => sum + item.total_inc_gst_snapshot, 0)
            const balanceDue = totalIncGst - invoice.paid_amount
            return (
              <tr key={invoice.id}>
                <td>{formatInvoiceNumber(job.job_number, invoice.sequence_num)}</td>
                <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                <td>${totalIncGst.toFixed(2)}</td>
                <td>${invoice.paid_amount.toFixed(2)}</td>
                <td>${balanceDue.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <CreateInvoiceForm lineItems={lineItems} onCreate={createInvoice} />
    </section>
  )
}
```

- [ ] **Step 4: Mount InvoiceSection on JobDetail, staff only**

In `src/pages/JobDetail.jsx`, add the import:

```jsx
import InvoiceSection from '../components/InvoiceSection'
```

And mount it between `BillingSection` and `DiarySection` — replace:

```jsx
      <BillingSection jobId={job.id} role={profile?.role} />
      <DiarySection jobId={job.id} />
```

with:

```jsx
      <BillingSection jobId={job.id} role={profile?.role} />
      {isStaff && <InvoiceSection job={job} role={profile?.role} />}
      <DiarySection jobId={job.id} />
```

- [ ] **Step 5: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`.
1. Sign in as admin, open a job that has at least two billing line items (apply a bundle or add one-off items first if needed). Confirm an "Invoices" section appears below Billing, showing an empty invoice table and a "Create Invoice" checklist listing the job's current line items.
2. Tick two of the line items, click "Create Invoice" — confirm a new row appears in the invoice table as `Invoice #000N-A` with the correct total (sum of the two selected lines' `total_inc_gst`), `$0.00` paid, and balance due equal to the total.
3. Tick a different subset (including one already used) and create a second invoice — confirm it appears as `Invoice #000N-B`, with its own correct total.
4. Reload the page — confirm both invoices persist with correct data.
5. Sign in as office, repeat step 2 on a different job — confirm office has the same access.
6. Sign in as technician, open any job — confirm no "Invoices" section renders at all.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useInvoices.js src/components/CreateInvoiceForm.jsx src/components/InvoiceSection.jsx src/pages/JobDetail.jsx
git commit -m "feat: add invoice list and creation UI to job detail"
```

---

### Task 6: Paid amount editing and PDF download

**Files:**
- Modify: `src/components/InvoiceSection.jsx` (full replace)
- Modify: `src/pages/JobDetail.jsx`

**Interfaces:**
- Consumes: `updatePaidAmount` (Task 5's `useInvoices`), `generateInvoicePdf` (Task 4).
- Produces: nothing consumed elsewhere — this is the last task in the plan.

- [ ] **Step 1: Add paid-amount editing and PDF download to InvoiceSection**

Replace the full contents of `src/components/InvoiceSection.jsx` with:

```jsx
import { useState } from 'react'
import { useInvoices } from '../hooks/useInvoices'
import { useJobBilling } from '../hooks/useJobBilling'
import { formatInvoiceNumber } from '../lib/jobConstants'
import { generateInvoicePdf } from '../lib/invoicePdf'
import CreateInvoiceForm from './CreateInvoiceForm'

export default function InvoiceSection({ job, client, role }) {
  const { invoices, loading, error, createInvoice, updatePaidAmount } = useInvoices(job.id)
  const { groups, otherItems } = useJobBilling(job.id, role)
  const lineItems = [...groups.flatMap((group) => group.items), ...otherItems]

  const [editingId, setEditingId] = useState(null)
  const [paidValue, setPaidValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadError, setDownloadError] = useState(null)

  if (loading) return <p>Loading invoices...</p>
  if (error) return <p role="alert">Could not load invoices: {error.message}</p>

  function startEditPaid(invoice) {
    setEditingId(invoice.id)
    setPaidValue(invoice.paid_amount)
    setSaveError(null)
  }

  async function handleSavePaid(e, invoiceId) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const { error } = await updatePaidAmount(invoiceId, Number(paidValue))
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    setEditingId(null)
  }

  async function handleDownload(invoice) {
    setDownloadingId(invoice.id)
    setDownloadError(null)
    try {
      await generateInvoicePdf({ job, client, invoice })
    } catch (err) {
      setDownloadError(err.message)
    }
    setDownloadingId(null)
  }

  return (
    <section>
      <h2>Invoices</h2>
      {downloadError && <p role="alert">{downloadError}</p>}
      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Created</th>
            <th>Total (inc GST)</th>
            <th>Paid</th>
            <th>Balance Due</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const totalIncGst = invoice.invoice_line_items.reduce((sum, item) => sum + item.total_inc_gst_snapshot, 0)
            const balanceDue = totalIncGst - invoice.paid_amount
            return (
              <tr key={invoice.id}>
                <td>{formatInvoiceNumber(job.job_number, invoice.sequence_num)}</td>
                <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                <td>${totalIncGst.toFixed(2)}</td>
                <td>
                  {editingId === invoice.id ? (
                    <form onSubmit={(e) => handleSavePaid(e, invoice.id)}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={paidValue}
                        onChange={(e) => setPaidValue(e.target.value)}
                      />
                      {saveError && <p role="alert">{saveError}</p>}
                      <button className="btn-primary" type="submit" disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      ${invoice.paid_amount.toFixed(2)}{' '}
                      <button type="button" onClick={() => startEditPaid(invoice)}>
                        Edit
                      </button>
                    </>
                  )}
                </td>
                <td>${balanceDue.toFixed(2)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleDownload(invoice)}
                    disabled={downloadingId === invoice.id}
                  >
                    {downloadingId === invoice.id ? 'Generating...' : 'Download PDF'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <CreateInvoiceForm lineItems={lineItems} onCreate={createInvoice} />
    </section>
  )
}
```

- [ ] **Step 2: Pass client to InvoiceSection**

In `src/pages/JobDetail.jsx`, update the mount line:

```jsx
      {isStaff && <InvoiceSection job={job} role={profile?.role} />}
```

to:

```jsx
      {isStaff && (
        <InvoiceSection
          job={job}
          client={{ name: job.clientName, address: job.clientAddress }}
          role={profile?.role}
        />
      )}
```

- [ ] **Step 3: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`, sign in as admin, open the job with invoices created in Task 5.
1. Click "Edit" next to a paid amount, change the value, click "Save" — confirm the Paid and Balance Due columns update immediately. Reload the browser page — confirm the change persisted.
2. Click "Edit" then "Cancel" — confirm no change is saved.
3. Click "Download PDF" on an invoice — confirm a file named `Invoice-000N-A.pdf` (matching that invoice's number) downloads, and opening it shows: the Zenith logo, the company details block (from `companyInfo.js`) and "Bill To" client block, a bold "INVOICE" heading, the invoice number and date, a line-items table with Description/QTY/Unit Price Ex GST/Total Price Ex GST, and a footer with Subtotal/GST/Total (inc GST)/Paid/Balance Due — confirm the ex-GST figures are each roughly `total ÷ 1.1` of the corresponding inc-GST amount shown elsewhere in the app.
4. Set a non-zero paid amount, download the PDF again — confirm the Paid and Balance Due lines in the new PDF reflect it.
5. Sign in as office — confirm the same paid-edit and download actions work.
6. Sign in as technician — confirm the whole Invoices section (including any download/edit controls) is absent, as already established in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/InvoiceSection.jsx src/pages/JobDetail.jsx
git commit -m "feat: add paid amount editing and PDF download to invoices"
```

---

## Self-Review

**Spec coverage:** `invoices`/`invoice_line_items` schema with snapshotting (Task 1) covers the data-model section. `create_invoice()` — atomic, `security invoker`, cross-job-id exclusion, per-job sequence counter (Task 2) — covers the function section, including a live-verified test of the counter continuing correctly across an admin invoice and a subsequent office invoice on the same job, and of the same `job_line_items` row being reused across two invoices without conflict. The narrowed RLS pattern with an office update policy scoped in practice to `paid_amount` only (Task 1) covers the access-control section. `formatInvoiceNumber`/GST derivation helpers/hardcoded `COMPANY_INFO` (Task 3) cover the numbering-format and company-info sections, with the placeholder-values caveat documented inline as the spec requires. `jspdf` + `jspdf-autotable` PDF generation matching the specified layout order (logo, mirrored company/customer blocks, INVOICE heading, invoice number, line-items table, footer totals) (Task 4) covers the PDF section. Invoice creation via a manual checklist (no percentage split, no auto-remaining-balance, a line item selectable more than once) (Task 5) covers the creation-UI section. Paid-amount editing and PDF download (Task 6) cover the remaining UI section. Explicitly out-of-scope items (send-to-client, void/delete, real payment ledger, `jobs.invoiced` wiring, status-gating invoice creation) correctly have no task.

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code or a concrete SQL/CLI command; every verify step has concrete actions and expected values (including exact expected `node` output in Task 3).

**Type/name consistency:** `useInvoices`' `invoices[i].invoice_line_items[j]` field names (`item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot`) match exactly what `create_invoice()` inserts and what `invoicePdf.js`'s `generateInvoicePdf` and `InvoiceSection.jsx` both read — no drift between the DB column names, the RPC's insert columns, and the frontend's property access anywhere. `generateInvoicePdf({ job, client, invoice })`'s destructured shape (`job.job_number`, `client.name`/`client.address`, `invoice.sequence_num`/`created_at`/`paid_amount`/`invoice_line_items`) matches exactly what Task 6's `InvoiceSection.jsx` passes (`job` as received from `useJob`, `client` constructed from `job.clientName`/`job.clientAddress`, `invoice` as one element of `useInvoices`' `invoices` array). `InvoiceSection`'s prop signature grows from `{ job, role }` (Task 5) to `{ job, client, role }` (Task 6), and `JobDetail.jsx`'s mount line is updated in lockstep in Task 6 Step 2 — no task calls a prop that doesn't exist yet. `createInvoice`/`updatePaidAmount` return `{ error }` consistently, matching the `send`/`simulateIncomingReply` convention already established in `useCommunications.js`.
