# Roof Report Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff-only "Roof Report" tab on `JobDetail` that generates a branded `.docx` roof inspection report, rendered server-side by a new Supabase Edge Function that ports the client's already-working `generate_report.js` almost unchanged, rewritten only at its I/O boundary.

**Architecture:** A new `roof_reports` table (multiple rows per job, sequence-numbered like `invoices`) plus a `create_roof_report(...)` Postgres function (atomic sequence numbering, `security invoker`, same pattern as `create_invoice()`) hold the persisted report data. Two new Storage buckets — `roof-report-photos` (staff-uploaded input photos, resized client-side before upload) and `roof-report-docs` (server-generated output documents, written only by the Edge Function's service-role client) — hold the files. The Edge Function `generate-roof-report` does its own independent admin/office role check (RLS cannot reach its service-role operations), fetches photo bytes from Storage, assembles the document with the ported rendering logic, uploads the result, calls `create_roof_report(...)` via a caller-scoped client (so RLS still gates that specific write), and returns the `.docx` directly as the HTTP response so the browser downloads it immediately.

**Tech Stack:** React + Vite frontend, Supabase Postgres + RLS + Storage, a new Supabase Edge Function (Deno, `npm:docx`/`npm:image-size` via Deno's npm compatibility layer). No automated JS test framework exists in this repo — verification follows this project's established pattern of live RLS checks run manually in the Supabase SQL Editor, plus manual browser verification for the frontend, plus `curl`-based verification for the Edge Function's own role check (the one access-control path RLS cannot cover).

**Spec:** `docs/superpowers/specs/2026-09-04-roof-report-generator-design.md`

## Global Constraints

- Roof Report is staff-only (admin/office) end to end — not rendered as a tab for technicians (matches `InvoiceSection`'s existing `isStaff` gate exactly, same as every other staff-only surface in this app), zero RLS access to `roof_reports` or either bucket for technicians.
- Multiple reports per job, sequence-numbered like `invoices` — never overwrite an existing report; every generation is a new permanent row + document.
- `roof_reports` rows are immutable once created (no update policy for anyone) and permanent (no delete policy for anyone) — same precedent as `invoice_line_items`/`invoices`.
- No AI/Claude-API text-extraction step anywhere in this feature — the form is fully structured and maps directly onto `report_schema.md`'s shape.
- No photo caption UI or caption storage this phase — captions are synthesized as empty strings only inside the Edge Function's rendering step, never persisted.
- Client-side photo resize (~1600px longest edge, JPEG quality ~0.8, via the browser's native Canvas API) happens before every upload to `roof-report-photos` — this is the approved fix for the Edge Function's 256MB memory ceiling, not optional.
- The Edge Function must verify the caller's role is `admin` or `office` itself, as its first step, before touching anything privileged — RLS does not automatically protect the Edge Function's service-role operations (photo fetch, `.docx` storage upload) the way it protects every other write path in this project.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside every Edge Function via `Deno.env.get(...)` — verified directly against Supabase's docs during planning; no manual secret needs to be created for these three.
- This project has no Supabase CLI configured in this environment — every SQL file must be run by the human via the Supabase Dashboard SQL Editor, and the Edge Function must be deployed via the Supabase Dashboard's Edge Functions editor, not executed/deployed directly by the agent.
- Refinement over the spec, decided during planning: the frontend sends `date_of_inspection` as a plain ISO date (native to `<input type="date">` and to the `roof_reports.date_of_inspection` column) — the Edge Function itself converts it to `DD/MM/YYYY` only for the document's printed text. This avoids sending the same date in two different string shapes and keeps the ISO→DD/MM/YYYY conversion in one place.
- No new npm dependencies for the frontend photo-resize step (native Canvas API only), matching this project's established no-new-dependency convention for UI primitives.

---

### Task 1: `roof_reports` table + RLS

**Files:**
- Create: `supabase/schema/016_roof_reports.sql`
- Create: `supabase/policies/019_roof_reports_policies.sql`

**Interfaces:**
- Produces: table `public.roof_reports(id, job_id, sequence_num, client_name, property_address, date_of_inspection, inspector, work_order, roof_type, roof_age, roof_pitch, urgent_observations text[], urgent_recommendations text[], preventive_observations text[], preventive_recommendations text[], photo_paths text[], docx_path, created_by, created_at)` and enum `public.roof_type_option`, consumed by Task 2 (`create_roof_report`) and Task 5 (`useRoofReports`).

- [x] **Step 1: Write the schema file**

```sql
create type public.roof_type_option as enum ('Tiled Roof', 'Metal Roof', 'Asbestos Roof', 'Others');

create table public.roof_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sequence_num integer not null,
  client_name text,
  property_address text,
  date_of_inspection date,
  inspector text,
  work_order text,
  roof_type public.roof_type_option,
  roof_age text,
  roof_pitch text,
  urgent_observations text[] not null default '{}',
  urgent_recommendations text[] not null default '{}',
  preventive_observations text[] not null default '{}',
  preventive_recommendations text[] not null default '{}',
  photo_paths text[] not null default '{}',
  docx_path text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, sequence_num)
);

comment on table public.roof_reports is 'A generated roof inspection report (.docx), snapshotted at generation time. Multiple reports per job are allowed (e.g. re-inspection after repairs) -- sequence_num is a per-job counter, same shape as invoices.sequence_num. Immutable and permanent once created: no update or delete policy for anyone.';
```

- [x] **Step 2: Write the RLS policy file**

```sql
alter table public.roof_reports enable row level security;

create policy "roof_reports_admin_all" on public.roof_reports
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "roof_reports_office_select" on public.roof_reports
  for select
  using (public.current_app_role() = 'office');

create policy "roof_reports_office_insert" on public.roof_reports
  for insert
  with check (public.current_app_role() = 'office');

-- No office update, no delete for anyone (immutable and permanent once
-- created -- editing metadata after generation wouldn't regenerate the
-- stored .docx, so the row and the document could silently disagree).
-- No technician policy at all -- zero access, not even read. Roof Report
-- is staff-only end to end (confirmed 2026-09-04).
```

- [x] **Step 3: Run both files against the live Supabase project**

Ask the user to open the Supabase Dashboard SQL Editor and run the contents of `supabase/schema/016_roof_reports.sql` followed by `supabase/policies/019_roof_reports_policies.sql`, then confirm both ran with no errors.

- [x] **Step 4: Run the live RLS verification block**

Substitute the real admin/office/technician UUIDs (already known from prior sessions' test accounts) in place of `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>` below, then ask the user to run the whole block (it runs inside an explicit transaction with fixed test UUIDs and rolls back at the end, so no test rows are left behind):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
begin
  insert into public.clients (id, name) values
    ('99999999-9999-9999-9999-999999999801', 'Roof Report RLS Test Client');
  insert into public.jobs (id, client_id) values
    ('99999999-9999-9999-9999-999999999811', '99999999-9999-9999-9999-999999999801');

  insert into public.roof_reports (job_id, sequence_num, docx_path) values
    ('99999999-9999-9999-9999-999999999811', 1, 'test/admin.docx');
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811') = 0 then
    raise exception 'admin should see the roof_reports row it just inserted';
  end if;

  update public.roof_reports set roof_age = 'Admin Updated'
    where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1;

  delete from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1;
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811') <> 0 then
    raise exception 'admin delete should have removed the row';
  end if;

  -- leave one row in place for office/technician to read
  insert into public.roof_reports (job_id, sequence_num, docx_path) values
    ('99999999-9999-9999-9999-999999999811', 1, 'test/shared.docx');
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
begin
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811') = 0 then
    raise exception 'office should be able to select the roof_reports row';
  end if;

  insert into public.roof_reports (job_id, sequence_num, docx_path) values
    ('99999999-9999-9999-9999-999999999811', 2, 'test/office.docx');
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811') <> 2 then
    raise exception 'office insert should have succeeded';
  end if;

  -- No update policy for office -- RLS filters this to zero rows
  -- affected (not an error), so verify by checking the value didn't change.
  update public.roof_reports set roof_age = 'Office Tampered'
    where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1;
  if (select roof_age from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1) = 'Office Tampered' then
    raise exception 'office should not be able to update a roof_reports row';
  end if;

  -- No delete policy for office either -- same zero-rows-affected check.
  delete from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1;
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811' and sequence_num = 1) = 0 then
    raise exception 'office should not be able to delete a roof_reports row';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
begin
  if (select count(*) from public.roof_reports where job_id = '99999999-9999-9999-9999-999999999811') <> 0 then
    raise exception 'technician should have zero visibility into roof_reports';
  end if;

  begin
    insert into public.roof_reports (job_id, sequence_num, docx_path) values
      ('99999999-9999-9999-9999-999999999811', 3, 'test/tech.docx');
    raise exception 'technician should not be able to insert a roof_reports row';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'All roof_reports RLS checks passed.';
end $$;

rollback;
```

Expected: the block completes with a `NOTICE: All roof_reports RLS checks passed.` and no unexpected `ERROR`. If any `raise exception` fires, stop and fix the corresponding policy before continuing.

- [x] **Step 5: Commit**

```bash
git add supabase/schema/016_roof_reports.sql supabase/policies/019_roof_reports_policies.sql
git commit -m "feat: add roof_reports table and RLS policies"
```

---

### Task 2: `create_roof_report(...)` Postgres function

**Files:**
- Create: `supabase/policies/020_create_roof_report_function.sql`

**Interfaces:**
- Consumes: table `public.roof_reports` (Task 1).
- Produces: `create_roof_report(target_job_id uuid, p_client_name text, p_property_address text, p_date_of_inspection date, p_inspector text, p_work_order text, p_roof_type public.roof_type_option, p_roof_age text, p_roof_pitch text, p_urgent_observations text[], p_urgent_recommendations text[], p_preventive_observations text[], p_preventive_recommendations text[], p_photo_paths text[], p_docx_path text) returns public.roof_reports` — a `security invoker` function, consumed by Task 4 (the Edge Function calls it via RPC using a caller-scoped client).

- [x] **Step 1: Write the function file**

```sql
-- The project's third write-capable function, after apply_bundle_to_job()
-- and create_invoice(). Creates one roof_reports row: sequence_num is
-- computed as the next per-job counter value in the same statement
-- (same race-safe pattern as create_invoice's invoices.sequence_num),
-- avoiding a race between concurrent calls on the same job -- the
-- unique(job_id, sequence_num) constraint on roof_reports is the real
-- safety net for a genuine simultaneous collision, converting it into a
-- retryable unique_violation rather than corrupting data, same as
-- create_invoice's accepted limitation.
--
-- SECURITY INVOKER (the default -- no keyword needed): admin/office
-- already have full INSERT rights on roof_reports via existing RLS, so
-- this buys atomic sequence numbering, not elevated privilege. A
-- technician calling this directly hits a real RLS policy violation
-- (SQLSTATE 42501) on the insert, since they have no insert policy on
-- roof_reports at all -- same behavior as create_invoice, not
-- apply_bundle_to_job's silent-null pattern.
--
-- Called by the generate-roof-report Edge Function using a Supabase
-- client scoped to the CALLING USER's own JWT, not the service-role
-- client -- this is deliberate: it keeps this specific write gated by
-- RLS as a second, independent layer, on top of (not instead of) the
-- Edge Function's own admin/office role check.
create or replace function public.create_roof_report(
  target_job_id uuid,
  p_client_name text,
  p_property_address text,
  p_date_of_inspection date,
  p_inspector text,
  p_work_order text,
  p_roof_type public.roof_type_option,
  p_roof_age text,
  p_roof_pitch text,
  p_urgent_observations text[],
  p_urgent_recommendations text[],
  p_preventive_observations text[],
  p_preventive_recommendations text[],
  p_photo_paths text[],
  p_docx_path text
)
returns public.roof_reports
language plpgsql
set search_path = public
as $$
declare
  new_row public.roof_reports;
begin
  insert into public.roof_reports (
    job_id, sequence_num, client_name, property_address, date_of_inspection,
    inspector, work_order, roof_type, roof_age, roof_pitch,
    urgent_observations, urgent_recommendations,
    preventive_observations, preventive_recommendations,
    photo_paths, docx_path, created_by
  )
  select
    target_job_id,
    coalesce((select max(sequence_num) from public.roof_reports where job_id = target_job_id), 0) + 1,
    p_client_name, p_property_address, p_date_of_inspection,
    p_inspector, p_work_order, p_roof_type, p_roof_age, p_roof_pitch,
    p_urgent_observations, p_urgent_recommendations,
    p_preventive_observations, p_preventive_recommendations,
    p_photo_paths, p_docx_path, auth.uid()
  returning * into new_row;

  return new_row;
end;
$$;

comment on function public.create_roof_report(uuid, text, text, date, text, text, public.roof_type_option, text, text, text[], text[], text[], text[], text[], text) is 'Creates one roof_reports row for a job: sequence_num = next per-job counter, computed atomically in the same insert (same pattern as create_invoice). SECURITY INVOKER -- admin/office already have full INSERT rights via RLS, so this buys atomic sequence numbering, not elevated privilege. A technician calling this directly gets a real RLS policy violation, not a null.';
```

- [x] **Step 2: Run the file against the live Supabase project**

Ask the user to run `supabase/policies/020_create_roof_report_function.sql` in the Supabase Dashboard SQL Editor and confirm it ran with no errors.

- [x] **Step 3: Run the live verification block**

Substitute the real UUIDs, then ask the user to run this (transactional, rolls back at the end):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999802';
  v_job_id uuid := '99999999-9999-9999-9999-999999999812';
  v_report public.roof_reports;
begin
  insert into public.clients (id, name) values (v_client_id, 'Create Roof Report Test Client');
  insert into public.jobs (id, client_id) values (v_job_id, v_client_id);

  select * into v_report from public.create_roof_report(
    v_job_id, 'Admin Client', '1 Test St', '2026-07-23'::date, 'Admin Inspector',
    'WO-1', 'Tiled Roof', '5 years', '20 degrees',
    array['obs1'], array['rec1'], array['pobs1'], array['prec1'],
    array['job/photo1.jpg'], 'job/report1.docx'
  );

  if v_report.sequence_num <> 1 then
    raise exception 'first report on this job should be sequence_num 1, got %', v_report.sequence_num;
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_job_id uuid := '99999999-9999-9999-9999-999999999812';
  v_report public.roof_reports;
begin
  select * into v_report from public.create_roof_report(
    v_job_id, 'Office Client', '1 Test St', '2026-08-01'::date, 'Office Inspector',
    'WO-2', 'Metal Roof', 'Not specified', 'Not specified',
    array[]::text[], array[]::text[], array[]::text[], array[]::text[],
    array[]::text[], 'job/report2.docx'
  );

  if v_report.sequence_num <> 2 then
    raise exception 'second report on this job should be sequence_num 2 (office, after admin), got %', v_report.sequence_num;
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_job_id uuid := '99999999-9999-9999-9999-999999999812';
begin
  begin
    perform public.create_roof_report(
      v_job_id, 'Tech Client', '1 Test St', '2026-08-02'::date, 'Tech Inspector',
      'WO-3', 'Others', null, null,
      array[]::text[], array[]::text[], array[]::text[], array[]::text[],
      array[]::text[], 'job/report3.docx'
    );
    raise exception 'technician should not be able to call create_roof_report';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'All create_roof_report checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: All create_roof_report checks passed.`, no unexpected `ERROR`.

- [x] **Step 4: Commit**

```bash
git add supabase/policies/020_create_roof_report_function.sql
git commit -m "feat: add create_roof_report function"
```

---

### Task 3: Storage buckets + RLS

**Files:**
- Create: `supabase/storage/003_roof_report_buckets_and_policies.sql`

**Interfaces:**
- Produces: buckets `roof-report-photos` and `roof-report-docs`, consumed by Task 4 (Edge Function) and Task 5 (`useRoofReports`).

- [x] **Step 1: Write the storage file**

```sql
insert into storage.buckets (id, name, public)
values ('roof-report-photos', 'roof-report-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('roof-report-docs', 'roof-report-docs', false)
on conflict (id) do nothing;

-- Input photos: staff (admin+office) full access, including delete --
-- before Generate is clicked, an uploaded photo is compose-time working
-- data (staff should be able to remove a mis-uploaded photo), not a
-- permanent record, same reasoning as bundle_items_office_delete. No
-- technician access at all -- Roof Report is staff-only end to end
-- (confirmed 2026-09-04).
create policy "roof_report_photos_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'roof-report-photos'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'roof-report-photos'
    and public.current_app_role() in ('admin', 'office')
  );

-- Output documents: staff can read (download), nobody can write via the
-- anon key at all -- only the Edge Function's service-role client writes
-- here, which bypasses RLS entirely. The deliberate absence of an
-- insert/update/delete policy is defense-in-depth (fail-closed if
-- anything ever tried to write here directly), matching this project's
-- established security-hardening rigor.
create policy "roof_report_docs_admin_office_select" on storage.objects
  for select
  using (
    bucket_id = 'roof-report-docs'
    and public.current_app_role() in ('admin', 'office')
  );
```

- [x] **Step 2: Run the file against the live Supabase project**

Ask the user to run `supabase/storage/003_roof_report_buckets_and_policies.sql` in the Supabase Dashboard SQL Editor and confirm it ran with no errors.

- [x] **Step 3: Confirm the office delete permission via `pg_policies` metadata, not a raw SQL DELETE**

Supabase blocks raw SQL `DELETE` against `storage.objects` with a built-in `protect_delete()` safety trigger regardless of RLS (the same wall hit during the security-hardening pass when dropping the `receipts` bucket row, now confirmed to apply to object rows too, not just bucket rows) — so delete behavior cannot be verified with a `DO` block the way every other RLS check in this project is. Ask the user to run this instead, to confirm the policy *definition* is correct (the actual delete *behavior* is deferred to Task 6's browser verification, once the real frontend exercises the real Storage API, which is not subject to this trigger):

```sql
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'roof_report_photos%';
```

Expected: one row, `roof_report_photos_admin_office_all`, `cmd = 'ALL'`, `qual` containing `bucket_id = 'roof-report-photos'` and `current_app_role() = ANY (ARRAY['admin', 'office'])`. Delete is covered by this single `for all` policy, not a separately-named delete policy.

- [x] **Step 4: Run the live verification block for insert/select and full isolation**

Substitute the real UUIDs, then ask the user to run this (transactional, rolls back at the end, no `DELETE` statements against `storage.objects`):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
begin
  insert into storage.objects (bucket_id, name) values
    ('roof-report-photos', '99999999-9999-9999-9999-999999999811/admin-test.jpg');
  if (select count(*) from storage.objects where bucket_id = 'roof-report-photos' and name = '99999999-9999-9999-9999-999999999811/admin-test.jpg') = 0 then
    raise exception 'admin should be able to insert into roof-report-photos';
  end if;

  -- admin has no explicit write policy on roof-report-docs (only the
  -- service-role client, which bypasses RLS, should ever write here).
  -- An INSERT with no matching WITH CHECK policy raises a hard RLS
  -- violation (42501/insufficient_privilege) rather than silently
  -- affecting zero rows -- that zero-rows behavior is specific to
  -- UPDATE/DELETE's USING-clause filtering, not INSERT's WITH CHECK.
  -- Catch the expected error, same pattern as the technician
  -- insert-blocking checks below, rather than assuming a silent no-op.
  begin
    insert into storage.objects (bucket_id, name) values
      ('roof-report-docs', '99999999-9999-9999-9999-999999999811/admin-test.docx');
    raise exception 'admin should NOT be able to insert into roof-report-docs via the anon-key path';
  exception when insufficient_privilege then
    null; -- expected
  end;
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'roof-report-photos' and name = '99999999-9999-9999-9999-999999999811/admin-test.jpg') = 0 then
    raise exception 'office should be able to select photos in roof-report-photos';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
begin
  if (select count(*) from storage.objects where bucket_id in ('roof-report-photos', 'roof-report-docs')) <> 0 then
    raise exception 'technician should have zero visibility into either roof-report bucket';
  end if;

  raise notice 'All roof-report storage RLS checks passed (insert/select/isolation only -- delete behavior deferred to Task 6 browser verification via the real Storage API).';
end $$;

rollback;
```

Expected: `NOTICE: All roof-report storage RLS checks passed (...)`, no unexpected `ERROR`. **Task 6's manual browser verification checklist gains one more item as a result of this deferral: as office, upload a photo to a Roof Report form and confirm it can be removed/re-selected before Generate is clicked** — this is the actual delete-permission check, now pushed to real frontend usage instead of a `DO` block.

- [x] **Step 5: Commit**

```bash
git add supabase/storage/003_roof_report_buckets_and_policies.sql
git commit -m "feat: add roof-report-photos and roof-report-docs storage buckets and policies"
```

---

### Task 4: `generate-roof-report` Edge Function

**Files:**
- Create: `supabase/functions/generate-roof-report/index.ts`

**Interfaces:**
- Consumes: `roof-report-photos` bucket (Task 3), `create_roof_report(...)` RPC (Task 2).
- Produces: an HTTP endpoint invoked as `supabase.functions.invoke('generate-roof-report', { body: {...} })` by Task 5's `useRoofReports`. Request body shape: `{ job_id, client_name, property_address, date_of_inspection (ISO), inspector, work_order, roof_type, roof_age, roof_pitch, urgent_observations: string[], urgent_recommendations: string[], preventive_observations: string[], preventive_recommendations: string[], photo_paths: string[] }`. On success, returns the `.docx` file directly as the response body with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

- [x] **Step 1: Get the real logo as a base64 string**

Ask the user to run one of these against their local `logo.png` (whichever matches their shell) and paste back the single-line output:

PowerShell:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("logo.png")) | Set-Content -NoNewline logo.b64
Get-Content logo.b64
```

bash/macOS:
```bash
base64 -w0 logo.png > logo.b64   # macOS: base64 -b0 logo.png > logo.b64
cat logo.b64
```

- [x] **Step 2: Write the Edge Function**

```typescript
// supabase/functions/generate-roof-report/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { imageSize } from "npm:image-size@2";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, BorderStyle, ImageRun,
  Header, Footer, VerticalAlign, PageNumber,
} from "npm:docx@9";

// ---------- Brand palette (ported unchanged from generate_report.js) ----------
const NAVY = "06143B";
const ORANGE = "FAA21B";
const LIGHT_GREY = "F4F5F7";
const MID_GREY = "8A8F9A";
const WHITE = "FFFFFF";
const BORDER_GREY = "E2E4E9";

const PAGE_WIDTH_TWIPS = 11906; // A4
const PAGE_HEIGHT_TWIPS = 16838;
const MARGIN = 720; // 0.5"
const CONTENT_WIDTH = PAGE_WIDTH_TWIPS - MARGIN * 2;

const FONT = "Calibri";

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellNoBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const shadeFill = (color: string) => ({ fill: color, type: ShadingType.CLEAR, color: "auto" });

// Source: src/assets/zenith-logo.png (1563x1563px, square) -- the same
// logo asset already used by the frontend, confirmed byte-identical
// during implementation rather than assumed. If the logo ever changes,
// regenerate this string from that file and verify the result decodes
// back to a byte-identical copy before replacing the value below.
const LOGO_BASE64 = "REPLACE_WITH_REAL_BASE64_LOGO_STRING";
const logoBuffer = Uint8Array.from(atob(LOGO_BASE64), (c) => c.charCodeAt(0));

function req(v: unknown, fallback: string): string {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

function formatAuDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

// ================= SMALL BUILDERS (ported unchanged from generate_report.js) =================
function label(text: string) {
  return new Paragraph({
    spacing: { after: 50 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 15, color: MID_GREY, font: FONT, characterSpacing: 14 })],
  });
}
function valueLine(text: string) {
  return new Paragraph({ children: [new TextRun({ text, size: 22, bold: true, color: NAVY, font: FONT })] });
}
function detailCell(labelText: string, value: string, shade: string) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    shading: shadeFill(shade),
    margins: { top: 180, bottom: 180, left: 240, right: 240 },
    children: [label(labelText), valueLine(value)],
  });
}
const ROW_SHADE_A = "FFFFFF";
const ROW_SHADE_B = "F7F8FA";
const gridBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
};

function sectionHeader(title: string, badgeText?: string | null) {
  const rightW = Math.round(CONTENT_WIDTH * 0.22);
  const midW = CONTENT_WIDTH - 140 - rightW;
  const badgeCell = badgeText
    ? new TableCell({
        width: { size: rightW, type: WidthType.DXA },
        shading: shadeFill(NAVY),
        verticalAlign: VerticalAlign.CENTER,
        borders: cellNoBorders,
        margins: { top: 80, bottom: 80, left: 0, right: 200 },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `  ${badgeText}  `, bold: true, size: 15, color: NAVY, shading: shadeFill(ORANGE), font: FONT, characterSpacing: 10 })],
          }),
        ],
      })
    : new TableCell({
        width: { size: rightW, type: WidthType.DXA },
        shading: shadeFill(NAVY),
        borders: cellNoBorders,
        children: [new Paragraph({ children: [] })],
      });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [140, midW, rightW],
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 140, type: WidthType.DXA }, shading: shadeFill(ORANGE), borders: cellNoBorders, children: [new Paragraph({ children: [] })] }),
          new TableCell({
            width: { size: midW, type: WidthType.DXA },
            shading: shadeFill(NAVY),
            verticalAlign: VerticalAlign.CENTER,
            borders: cellNoBorders,
            margins: { top: 100, bottom: 100, left: 200, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ font: FONT, text: title.toUpperCase(), bold: true, size: 22, color: WHITE, characterSpacing: 16 })] })],
          }),
          badgeCell,
        ],
      }),
    ],
  });
}

function fusedSection(title: string, badgeText: string | null, bodyCellChildren: unknown[]) {
  const rightW = Math.round(CONTENT_WIDTH * 0.22);
  const midW = CONTENT_WIDTH - 140 - rightW;
  const badgeRun = badgeText
    ? [new TextRun({ text: `  ${badgeText}  `, bold: true, size: 15, color: NAVY, shading: shadeFill(ORANGE), font: FONT, characterSpacing: 10 })]
    : [];

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      new TableCell({ width: { size: 140, type: WidthType.DXA }, shading: shadeFill(ORANGE), borders: cellNoBorders, children: [new Paragraph({ children: [] })] }),
      new TableCell({
        width: { size: midW, type: WidthType.DXA },
        shading: shadeFill(NAVY),
        verticalAlign: VerticalAlign.CENTER,
        borders: cellNoBorders,
        margins: { top: 100, bottom: 100, left: 200, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ font: FONT, text: title.toUpperCase(), bold: true, size: 22, color: WHITE, characterSpacing: 16 })] })],
      }),
      new TableCell({
        width: { size: rightW, type: WidthType.DXA },
        shading: shadeFill(NAVY),
        verticalAlign: VerticalAlign.CENTER,
        borders: cellNoBorders,
        margins: { top: 80, bottom: 80, left: 0, right: 200 },
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: badgeRun })],
      }),
    ],
  });

  const bodyRow = new TableRow({
    cantSplit: true,
    children: [
      new TableCell({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnSpan: 3, borders: cellNoBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: bodyCellChildren as never }),
    ],
  });

  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [140, midW, rightW], rows: [headerRow, bodyRow] });
}

function bulletParagraphs(items: string[] | null | undefined) {
  if (!items || items.length === 0) {
    return [new Paragraph({ children: [new TextRun({ font: FONT, text: "None noted at time of inspection.", italics: true, size: 21, color: MID_GREY })] })];
  }
  return items.map(
    (t) =>
      new Paragraph({
        spacing: { after: 110 },
        indent: { left: 210, hanging: 210 },
        children: [
          new TextRun({ font: FONT, text: "▪  ", bold: true, color: ORANGE, size: 19 }),
          new TextRun({ font: FONT, text: String(t), size: 21, color: "2A2A2A" }),
        ],
      })
  );
}

function columnTitle(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY, space: 6 } },
    children: [new TextRun({ font: FONT, text: text.toUpperCase(), bold: true, size: 16, color: NAVY, characterSpacing: 10 })],
  });
}

function twoColBody(leftTitle: string, leftItems: string[], rightTitle: string, rightItems: string[]) {
  const colW = Math.round(CONTENT_WIDTH / 2);
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [colW, CONTENT_WIDTH - colW],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      insideHorizontal: noBorder,
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: colW, type: WidthType.DXA },
            margins: { top: 200, bottom: 220, left: 260, right: 240 },
            children: [columnTitle(leftTitle), ...bulletParagraphs(leftItems)],
          }),
          new TableCell({
            width: { size: CONTENT_WIDTH - colW, type: WidthType.DXA },
            margins: { top: 200, bottom: 220, left: 260, right: 240 },
            children: [columnTitle(rightTitle), ...bulletParagraphs(rightItems)],
          }),
        ],
      }),
    ],
  });
}

// ---------- Photos: fetched from Storage instead of the local filesystem ----------
const MAX_PHOTO_W = 300; // px (~96dpi)
const MAX_PHOTO_H = 220;

async function loadPhoto(storagePath: string, serviceClient: ReturnType<typeof createClient>) {
  const { data, error } = await serviceClient.storage.from("roof-report-photos").download(storagePath);
  if (error || !data) throw error ?? new Error("empty photo download");
  const buf = new Uint8Array(await data.arrayBuffer());
  const dims = imageSize(buf);
  const scale = Math.min(MAX_PHOTO_W / dims.width!, MAX_PHOTO_H / dims.height!, 1);
  return { buf, width: Math.round(dims.width! * scale), height: Math.round(dims.height! * scale), type: dims.type === "png" ? "png" : "jpg" };
}

async function photoCell(photoPath: string | null, serviceClient: ReturnType<typeof createClient>) {
  const children: unknown[] = [];
  if (photoPath) {
    try {
      const img = await loadPhoto(photoPath, serviceClient);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 100 },
          children: [new ImageRun({ data: img.buf, type: img.type as "png" | "jpg", transformation: { width: img.width, height: img.height } })],
        })
      );
    } catch {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 900 }, children: [new TextRun({ text: `[ Photo not found: ${photoPath} ]`, color: "C0392B", bold: true, size: 17, font: FONT })] }));
    }
  } else {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 900 }, children: [new TextRun({ font: FONT, text: "[ NO PHOTO PROVIDED ]", color: MID_GREY, bold: true, size: 18 })] }));
  }
  // No caption UI this phase -- always empty, matches the confirmed decision.
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 200 },
      border: { top: { style: BorderStyle.SINGLE, size: 3, color: BORDER_GREY, space: 8 } },
      children: [new TextRun({ font: FONT, text: "", italics: true, size: 17, color: MID_GREY })],
    })
  );
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
    },
    shading: shadeFill(LIGHT_GREY),
    children: children as never,
  });
}

async function photoGrid(photoPaths: string[], serviceClient: ReturnType<typeof createClient>) {
  const items = photoPaths && photoPaths.length ? photoPaths : [null];
  const rows: TableRow[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = await photoCell(items[i], serviceClient);
    const right = await photoCell(items[i + 1] ?? null, serviceClient);
    rows.push(new TableRow({ cantSplit: true, children: [left, right] }));
  }
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [Math.round(CONTENT_WIDTH / 2), Math.round(CONTENT_WIDTH / 2)], rows });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ---- Step 1: caller-scoped client, used ONLY to check identity/role
  // and to make the create_roof_report RPC call later -- this is what
  // keeps that specific write gated by RLS independently of the check
  // below, per the spec's defense-in-depth requirement.
  const authHeader = request.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // ---- Step 2: the Edge Function's OWN role check. RLS does not
  // automatically protect this function's later service-role operations
  // (photo fetch, .docx storage upload) -- this check is the only gate
  // for those, so it must happen before anything privileged runs.
  const { data: profile, error: profileError } = await callerClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !["admin", "office"].includes(profile.role as string)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const job_id = body.job_id as string;
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const client_name = (body.client_name as string) ?? null;
  const property_address = (body.property_address as string) ?? null;
  const date_of_inspection_iso = (body.date_of_inspection as string) ?? null;
  const inspector = (body.inspector as string) ?? null;
  const work_order = (body.work_order as string) ?? null;
  const roof_type = (body.roof_type as string) ?? null;
  const roof_age = (body.roof_age as string) ?? null;
  const roof_pitch = (body.roof_pitch as string) ?? null;
  const urgent_observations = (body.urgent_observations as string[]) ?? [];
  const urgent_recommendations = (body.urgent_recommendations as string[]) ?? [];
  const preventive_observations = (body.preventive_observations as string[]) ?? [];
  const preventive_recommendations = (body.preventive_recommendations as string[]) ?? [];
  const photo_paths = (body.photo_paths as string[]) ?? [];

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ================= HEADER / FOOTER (ported unchanged) =================
  const headerTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [1500, CONTENT_WIDTH - 1500],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1500, type: WidthType.DXA },
            shading: shadeFill(NAVY),
            verticalAlign: VerticalAlign.CENTER,
            borders: cellNoBorders,
            margins: { top: 160, bottom: 160, left: 160, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: logoBuffer, type: "png", transformation: { width: 51, height: 51 } })] })],
          }),
          new TableCell({
            width: { size: CONTENT_WIDTH - 1500, type: WidthType.DXA },
            shading: shadeFill(NAVY),
            verticalAlign: VerticalAlign.CENTER,
            borders: cellNoBorders,
            margins: { top: 160, bottom: 160, left: 100, right: 200 },
            children: [
              new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ font: FONT, text: "ZENITH ROOF RESTORATIONS & REPLACEMENTS", bold: true, size: 26, color: WHITE, characterSpacing: 6 })] }),
              new Paragraph({ spacing: { after: 15 }, children: [new TextRun({ font: FONT, text: "ABN: 26 671 651 915   |   Licence No: 471793C", size: 16, color: WHITE })] }),
              new Paragraph({ spacing: { after: 15 }, children: [new TextRun({ font: FONT, text: "8/11 Lancaster Street, Ingleburn NSW 2565", size: 16, color: WHITE })] }),
              new Paragraph({ children: [new TextRun({ font: FONT, text: "(02) 7256 4796   |   info@zenithroofingsydney.com.au   |   www.zenithroofingsydney.com.au", size: 16, color: WHITE })] }),
            ],
          }),
        ],
      }),
    ],
  });

  const titleBar = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: shadeFill(WHITE),
            borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 18, color: ORANGE } },
            margins: { top: 160, bottom: 160, left: 0, right: 0 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, text: "ROOF INSPECTION REPORT", bold: true, size: 30, color: NAVY, characterSpacing: 18 })] })],
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [Math.round(CONTENT_WIDTH * 0.6), CONTENT_WIDTH - Math.round(CONTENT_WIDTH * 0.6)],
        borders: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY }, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: Math.round(CONTENT_WIDTH * 0.6), type: WidthType.DXA },
                borders: cellNoBorders,
                margins: { top: 120, bottom: 0, left: 0, right: 0 },
                children: [
                  new Paragraph({ spacing: { after: 15 }, children: [new TextRun({ font: FONT, text: "Zenith Roof Restorations & Replacements", bold: true, size: 16, color: NAVY })] }),
                  new Paragraph({ children: [new TextRun({ font: FONT, text: "(02) 7256 4796   •   info@zenithroofingsydney.com.au", size: 15, color: MID_GREY })] }),
                ],
              }),
              new TableCell({
                width: { size: CONTENT_WIDTH - Math.round(CONTENT_WIDTH * 0.6), type: WidthType.DXA },
                borders: cellNoBorders,
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 120, bottom: 0, left: 0, right: 0 },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ font: FONT, text: "Page ", size: 16, color: MID_GREY }),
                      new TextRun({ font: FONT, children: [PageNumber.CURRENT], size: 16, color: MID_GREY }),
                      new TextRun({ font: FONT, text: " of ", size: 16, color: MID_GREY }),
                      new TextRun({ font: FONT, children: [PageNumber.TOTAL_PAGES], size: 16, color: MID_GREY }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // ================= ASSEMBLE =================
  const photos = await photoGrid(photo_paths, serviceClient);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } },
      },
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_WIDTH_TWIPS, height: PAGE_HEIGHT_TWIPS }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        headers: { default: new Header({ children: [headerTable] }) },
        footers: { default: footer },
        children: [
          titleBar,
          new Paragraph({ spacing: { after: 200 }, children: [] }),

          fusedSection("Property & Inspection Details", null, [
            new Table({
              width: { size: CONTENT_WIDTH, type: WidthType.DXA },
              columnWidths: [Math.round(CONTENT_WIDTH / 2), CONTENT_WIDTH - Math.round(CONTENT_WIDTH / 2)],
              borders: gridBorders,
              rows: [
                new TableRow({ children: [detailCell("Client", req(client_name, "—"), ROW_SHADE_A), detailCell("Work Order / Plan #", req(work_order, "—"), ROW_SHADE_A)] }),
                new TableRow({ children: [detailCell("Property Address", req(property_address, "—"), ROW_SHADE_B), detailCell("Roof Type", req(roof_type, "Not specified"), ROW_SHADE_B)] }),
                new TableRow({ children: [detailCell("Date of Inspection", req(formatAuDate(date_of_inspection_iso), "—"), ROW_SHADE_A), detailCell("Roof Age", req(roof_age, "Not specified"), ROW_SHADE_A)] }),
                new TableRow({ children: [detailCell("Inspector Assigned", req(inspector, "—"), ROW_SHADE_B), detailCell("Roof Pitch", req(roof_pitch, "Not specified"), ROW_SHADE_B)] }),
              ],
            }),
          ]),
          new Paragraph({ spacing: { after: 260 }, children: [] }),

          fusedSection("Urgent Repairs", "PRIORITY", [twoColBody("Observation", urgent_observations, "Recommendations", urgent_recommendations)]),
          new Paragraph({ spacing: { after: 260 }, children: [] }),

          fusedSection("Preventive Repairs", null, [twoColBody("Observation", preventive_observations, "Recommendations", preventive_recommendations)]),

          new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }),
          sectionHeader("Inspection Photos"),
          new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }),
          photos,

          new Paragraph({
            spacing: { before: 300 },
            children: [new TextRun({ font: FONT, text: "Report prepared by Zenith Roof Restorations & Replacements Pty Ltd. Findings reflect the condition of the roof at the time of inspection only.", italics: true, size: 15, color: MID_GREY })],
          }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);

  const docxPath = `${job_id}/${crypto.randomUUID()}.docx`;
  const { error: uploadError } = await serviceClient.storage
    .from("roof-report-docs")
    .upload(docxPath, buf, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const { data: newReport, error: rpcError } = await callerClient.rpc("create_roof_report", {
    target_job_id: job_id,
    p_client_name: client_name,
    p_property_address: property_address,
    p_date_of_inspection: date_of_inspection_iso,
    p_inspector: inspector,
    p_work_order: work_order,
    p_roof_type: roof_type,
    p_roof_age: roof_age,
    p_roof_pitch: roof_pitch,
    p_urgent_observations: urgent_observations,
    p_urgent_recommendations: urgent_recommendations,
    p_preventive_observations: preventive_observations,
    p_preventive_recommendations: preventive_recommendations,
    p_photo_paths: photo_paths,
    p_docx_path: docxPath,
  });

  if (rpcError) {
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const sequenceNum = (newReport as { sequence_num: number }).sequence_num;

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="roof-report-${sequenceNum}.docx"`,
    },
  });
});
```

- [x] **Step 3: Deploy via the Supabase Dashboard**

No Supabase CLI is configured in this environment. Ask the user to open the Supabase Dashboard's Edge Functions page, create a new function named `generate-roof-report`, paste in the file content from Step 2 (with the real base64 logo from Step 1 substituted in place of the placeholder), and deploy it.

- [x] **Step 4: Verify the role check with `curl`**

This is the one access-control path RLS cannot cover on its own, so it needs its own explicit test rather than relying on the RLS checks from Tasks 1-3. Ask the user to run these against the deployed function URL (`https://<project-ref>.supabase.co/functions/v1/generate-roof-report`), using a technician test account's access token (obtainable by signing in as the technician test account in the browser and reading the session token from dev tools, or via a quick `supabase.auth.signInWithPassword` call in the browser console) and then with no `Authorization` header at all:

```bash
# Technician JWT -- must be rejected with 403
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/generate-roof-report" \
  -H "Authorization: Bearer <TECHNICIAN_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000000"}'

# No Authorization header at all -- must be rejected with 401
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/generate-roof-report" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000000"}'
```

Expected: the first call returns `403 Forbidden`, the second returns `401`. If either instead succeeds or returns a different error, stop — this means the role check in Step 2 isn't working and must be fixed before continuing (this is the single most important check in this whole plan, per the spec).

- [x] **Step 5: Commit**

```bash
git add supabase/functions/generate-roof-report/index.ts
git commit -m "feat: add generate-roof-report Edge Function"
```

---

### Task 5: Frontend data layer — photo resize + `useRoofReports` hook

**Files:**
- Create: `src/lib/imageResize.js`
- Create: `src/hooks/useRoofReports.js`
- Modify: `src/lib/jobConstants.js`

**Interfaces:**
- Produces: `resizeImageFile(file, options?) -> Promise<File>` (JPEG, ~1600px longest edge, quality ~0.8); `useRoofReports(jobId)` returning `{ reports, loading, error, uploadPhoto(file), removePhoto(path), createReport(formValues, photoPaths), downloadReport(report) }`. `uploadPhoto` returns `{ path, error }` (`path` is `null` on failure), `removePhoto`/`createReport`/`downloadReport` return `{ error }` (`null` on success). Consumed by Task 6.
- **Design note, corrected during planning:** photos upload to `roof-report-photos` immediately on selection (via `uploadPhoto`), not deferred to Generate time — this is what gives the office delete policy from Task 3 an actual UI path to exercise (a per-thumbnail Remove button calling `removePhoto`), since Task 3's live RLS verification couldn't test `DELETE` directly (Supabase blocks raw SQL `DELETE` on `storage.objects`) and deferred that check to here. `createReport` therefore takes an already-uploaded `photoPaths` array, not raw `File`s.

- [x] **Step 1: Write `imageResize.js`**

```javascript
export function resizeImageFile(file, { maxDimension = 1600, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1)
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to resize image'))
            return
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for resizing'))
    }

    img.src = url
  })
}
```

- [x] **Step 2: Add `formatRoofReportNumber` to `jobConstants.js`**

```javascript
export function formatRoofReportNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Roof Report #${String(jobNumber).padStart(4, '0')}-${letter}`
}
```

- [x] **Step 3: Write `useRoofReports.js`**

```javascript
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { resizeImageFile } from '../lib/imageResize'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export function useRoofReports(jobId) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('roof_reports')
      .select('id, sequence_num, docx_path, created_at')
      .eq('job_id', jobId)
      .order('sequence_num')

    if (error) setError(error)
    else setReports(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  // Uploads immediately on selection (not deferred to Generate time) --
  // this is what gives a compose-time Remove button something real to
  // delete, exercising the office delete policy on roof-report-photos
  // that Task 3's live RLS check couldn't test directly.
  async function uploadPhoto(file) {
    const resized = await resizeImageFile(file)
    const path = `${jobId}/${Date.now()}-${sanitizeFileName(resized.name)}`
    const { error } = await supabase.storage.from('roof-report-photos').upload(path, resized)
    if (error) return { path: null, error }
    return { path, error: null }
  }

  async function removePhoto(path) {
    const { error } = await supabase.storage.from('roof-report-photos').remove([path])
    return { error }
  }

  async function createReport(formValues, photoPaths) {
    const { data, error: invokeError } = await supabase.functions.invoke('generate-roof-report', {
      body: { ...formValues, job_id: jobId, photo_paths: photoPaths },
    })

    if (invokeError) return { error: invokeError }

    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'roof-report.docx'
    link.click()
    URL.revokeObjectURL(url)

    await reload()
    return { error: null }
  }

  async function downloadReport(report) {
    const { data, error } = await supabase.storage
      .from('roof-report-docs')
      .createSignedUrl(report.docx_path, 3600)
    if (error) return { error }
    window.open(data.signedUrl, '_blank')
    return { error: null }
  }

  return { reports, loading, error, uploadPhoto, removePhoto, createReport, downloadReport }
}
```

- [x] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors. Neither new file has a consumer yet, so there's nothing to interactively test until Task 6 wires them up.

- [x] **Step 5: Commit**

```bash
git add src/lib/imageResize.js src/lib/jobConstants.js src/hooks/useRoofReports.js
git commit -m "feat: add photo resize helper and useRoofReports hook"
```

---

### Task 6: `RoofReportForm`/`RoofReportSection` + `JobDetail` wiring

**Files:**
- Create: `src/components/RoofReportForm.jsx`
- Create: `src/components/RoofReportSection.jsx`
- Modify: `src/pages/JobDetail.jsx`

**Interfaces:**
- Consumes: `useRoofReports` (Task 5, corrected during planning to `{ reports, loading, error, uploadPhoto(file), removePhoto(path), createReport(formValues, photoPaths), downloadReport(report) }`); `formatRoofReportNumber` (Task 5).

- [x] **Step 1: Write `RoofReportForm.jsx`**

Photos upload to Storage immediately on selection, not deferred to Generate time — each gets a Remove button that calls `removePhoto`, giving Task 3's office delete policy on `roof-report-photos` a real UI path to exercise (Task 3's live RLS check couldn't test `DELETE` directly, since Supabase blocks raw SQL `DELETE` on `storage.objects`, and deferred that check to here).

```jsx
import { useState } from 'react'

const ROOF_TYPES = ['Tiled Roof', 'Metal Roof', 'Asbestos Roof', 'Others']

function toArray(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

let nextPhotoKey = 0

export default function RoofReportForm({ job, onUploadPhoto, onRemovePhoto, onCreate }) {
  const [clientName, setClientName] = useState(job.clientName ?? '')
  const [propertyAddress, setPropertyAddress] = useState(job.site_address ?? '')
  const [dateOfInspection, setDateOfInspection] = useState('')
  const [inspector, setInspector] = useState('')
  const [workOrder, setWorkOrder] = useState('')
  const [roofType, setRoofType] = useState(ROOF_TYPES[0])
  const [roofAge, setRoofAge] = useState('')
  const [roofPitch, setRoofPitch] = useState('')
  const [urgentObservations, setUrgentObservations] = useState('')
  const [urgentRecommendations, setUrgentRecommendations] = useState('')
  const [preventiveObservations, setPreventiveObservations] = useState('')
  const [preventiveRecommendations, setPreventiveRecommendations] = useState('')
  // Each entry: { key, previewUrl, path, uploading, error }
  const [photos, setPhotos] = useState([])
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError] = useState(null)

  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files)
    e.target.value = '' // allow re-selecting the same file later

    for (const file of files) {
      const key = nextPhotoKey++
      const previewUrl = URL.createObjectURL(file)
      setPhotos((prev) => [...prev, { key, previewUrl, path: null, uploading: true, error: null }])

      const { path, error } = await onUploadPhoto(file)
      setPhotos((prev) =>
        prev.map((p) => (p.key === key ? { ...p, path, uploading: false, error: error?.message ?? null } : p))
      )
    }
  }

  async function handleRemovePhoto(key) {
    const photo = photos.find((p) => p.key === key)
    if (!photo) return
    URL.revokeObjectURL(photo.previewUrl)
    if (photo.path) {
      await onRemovePhoto(photo.path)
    }
    setPhotos((prev) => prev.filter((p) => p.key !== key))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setGenerating(true)
    setFormError(null)

    const photoPaths = photos.filter((p) => p.path).map((p) => p.path)

    const { error } = await onCreate(
      {
        client_name: clientName,
        property_address: propertyAddress,
        date_of_inspection: dateOfInspection || null,
        inspector,
        work_order: workOrder,
        roof_type: roofType,
        roof_age: roofAge,
        roof_pitch: roofPitch,
        urgent_observations: toArray(urgentObservations),
        urgent_recommendations: toArray(urgentRecommendations),
        preventive_observations: toArray(preventiveObservations),
        preventive_recommendations: toArray(preventiveRecommendations),
      },
      photoPaths
    )

    setGenerating(false)
    if (error) {
      setFormError(error.message)
      return
    }
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setPhotos([])
  }

  const uploading = photos.some((p) => p.uploading)

  return (
    <form onSubmit={handleSubmit}>
      <h3>New Roof Report</h3>
      <label>
        Client/Strata/Real Estate Name
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </label>
      <label>
        Work Order/Plan#
        <input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} />
      </label>
      <label>
        Property Address
        <input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
      </label>
      <label>
        Roof Type
        <select value={roofType} onChange={(e) => setRoofType(e.target.value)}>
          {ROOF_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date of Inspection
        <input type="date" value={dateOfInspection} onChange={(e) => setDateOfInspection(e.target.value)} />
      </label>
      <label>
        Roof Age
        <input value={roofAge} onChange={(e) => setRoofAge(e.target.value)} />
      </label>
      <label>
        Inspector Assigned
        <input value={inspector} onChange={(e) => setInspector(e.target.value)} />
      </label>
      <label>
        Roof Pitch
        <input value={roofPitch} onChange={(e) => setRoofPitch(e.target.value)} />
      </label>

      <fieldset>
        <legend>Urgent Repairs</legend>
        <label>
          Observation (one per line)
          <textarea value={urgentObservations} onChange={(e) => setUrgentObservations(e.target.value)} />
        </label>
        <label>
          Recommendation (one per line)
          <textarea value={urgentRecommendations} onChange={(e) => setUrgentRecommendations(e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Preventive Repairs</legend>
        <label>
          Observation (one per line)
          <textarea value={preventiveObservations} onChange={(e) => setPreventiveObservations(e.target.value)} />
        </label>
        <label>
          Recommendation (one per line)
          <textarea value={preventiveRecommendations} onChange={(e) => setPreventiveRecommendations(e.target.value)} />
        </label>
      </fieldset>

      <label>
        Photos
        <input type="file" accept="image/*" multiple onChange={handleFilesSelected} />
      </label>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {photos.map((photo) => (
            <div key={photo.key} style={{ position: 'relative' }}>
              <img
                src={photo.previewUrl}
                alt="Selected photo preview"
                style={{ width: 100, height: 100, objectFit: 'cover', opacity: photo.uploading ? 0.5 : 1 }}
              />
              {photo.uploading && <p>Uploading...</p>}
              {photo.error && <p role="alert">{photo.error}</p>}
              <button type="button" onClick={() => handleRemovePhoto(photo.key)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length > 12 && (
        <p role="alert">{photos.length} photos attached — large reports may take longer to generate.</p>
      )}

      {formError && <p role="alert">{formError}</p>}
      <button className="btn-primary" type="submit" disabled={generating || uploading}>
        {generating ? 'Generating...' : uploading ? 'Uploading photos...' : 'Generate'}
      </button>
    </form>
  )
}
```

- [x] **Step 2: Write `RoofReportSection.jsx`**

```jsx
import { useRoofReports } from '../hooks/useRoofReports'
import { formatRoofReportNumber } from '../lib/jobConstants'
import RoofReportForm from './RoofReportForm'

export default function RoofReportSection({ job }) {
  const { reports, loading, error, uploadPhoto, removePhoto, createReport, downloadReport } = useRoofReports(job.id)

  if (loading) return <p>Loading roof reports...</p>
  if (error) return <p role="alert">Could not load roof reports: {error.message}</p>

  return (
    <section>
      <h2>Roof Reports</h2>
      <ul>
        {reports.map((report) => (
          <li key={report.id}>
            {formatRoofReportNumber(job.job_number, report.sequence_num)} —{' '}
            {new Date(report.created_at).toLocaleDateString()}{' '}
            <button type="button" onClick={() => downloadReport(report)}>
              Download
            </button>
          </li>
        ))}
      </ul>
      <RoofReportForm job={job} onUploadPhoto={uploadPhoto} onRemovePhoto={removePhoto} onCreate={createReport} />
    </section>
  )
}
```

- [x] **Step 3: Wire the new tab into `JobDetail.jsx`**

Add the import:

```javascript
import RoofReportSection from '../components/RoofReportSection'
```

Change the tab arrays:

```javascript
const STAFF_TABS = ['Details', 'Job Contact', 'Billing', 'Invoicing', 'Roof Report']
const TECHNICIAN_TABS = ['Details', 'Job Contact', 'Billing']
```

Add a new branch alongside the existing `'Invoicing'` branch, inside `.job-detail-tab-content`:

```jsx
            {activeTab === 'Roof Report' && isStaff && <RoofReportSection job={job} />}
```

- [x] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [x] **Step 5: Manually verify in the browser**

Start the dev server (`npm run dev`). For admin and office (technician confirmed separately to have no access at all):

- Open a job's detail page, confirm a "Roof Report" tab appears (admin/office only — confirm it's absent for technician, along with the rest of `STAFF_TABS`).
- Fill in every field, attach 2-3 photos (include at least one from an iPhone if available, to explicitly test HEIC — per the spec, this compatibility was flagged as untested, not assumed; if it fails, note the exact failure so a follow-up decision can be made about client-side HEIC conversion or rejection), click Generate.
- Confirm the browser downloads a `.docx` file immediately. Open it and confirm: every field lands in the right place, the date shows as `DD/MM/YYYY` (not ISO), photos are embedded and scaled correctly, an empty Urgent or Preventive box (leave one blank to test) shows "None noted at time of inspection.", and a report generated with zero photos shows the "[ NO PHOTO PROVIDED ]" placeholder.
- Confirm the new report appears in the list above the form with the correct `Roof Report #0001-A`-style number.
- Generate a second report on the same job and confirm the sequence number increments to `-B` and both remain independently listed.
- Click Download on a past report and confirm it opens the exact previously-generated document without waiting on a fresh generation (i.e., it's served from Storage, not regenerated).
- **This is the actual delete-permission verification, deferred here from Task 3** (Supabase blocks raw SQL `DELETE` on `storage.objects`, so it couldn't be tested with a `DO` block): as office, select a photo, confirm it uploads (thumbnail appears, "Uploading..." clears), click its Remove button, and confirm it disappears from the form with no error — then check the Supabase Storage dashboard's `roof-report-photos` bucket directly and confirm the object is actually gone, not just hidden client-side. Repeat as admin.
- Confirm the form works identically for office as it does for admin end to end (not just the delete check above).

- [x] **Step 6: Commit**

```bash
git add src/components/RoofReportForm.jsx src/components/RoofReportSection.jsx src/pages/JobDetail.jsx
git commit -m "feat: add Roof Report tab to JobDetail"
```
