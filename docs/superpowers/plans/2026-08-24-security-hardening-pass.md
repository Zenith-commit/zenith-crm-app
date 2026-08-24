# Security Hardening Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three concrete gaps found during the full-stack security audit — stale fresh-install schema/policy files, unsanitized diary-photo filenames, and a dead `receipts` storage bucket — and record the dashboard/deployment handoff checklist in CLAUDE.md, as specified in `docs/superpowers/specs/2026-08-24-security-hardening-pass-design.md`.

**Architecture:** Three independent, small fixes plus a docs update. No new tables, no new RLS policies, no new dependencies — this pass found no live access-control gap requiring one. Two fixes are docs-only (schema/policy files brought back in sync with live, which is already correct); one is a frontend change (filename sanitization); one is a live migration (drop the unused bucket) mirroring the already-proven `job_costs` drop pattern (pre-check emptiness, then drop, then remove from the fresh-install sequence).

**Tech Stack:** React 19 + Vite, `@supabase/supabase-js` (existing, no new dependencies). SQL changes run manually in the Supabase SQL Editor, same as every prior phase.

## Global Constraints

- No table/schema changes to live data — Finding 1 is a docs-only correction (live `jobs` table is already correct); only Finding 3 touches live state (dropping the empty `receipts` bucket).
- This project has no automated JS test framework. Every task's verification step is a manual check (`npm run dev` + sign in as the relevant test account) plus `npm run build` / `npx oxlint`, per this project's established pattern.
- Per this project's established RLS-impersonation-testing conventions: DDL that must persist runs as a plain statement/submission, never inside a `do $$ ... raise exception ... $$` block (the exception rolls back everything in that block, including the DDL). Any check of a function/policy gated on `current_app_role()` needs the full `set_config('request.jwt.claims', ...)` + `set local role authenticated` impersonation wrapper — a bare `select` has no impersonated identity and produces a false negative, not a real test.
- Every mutating/live-data step in this plan must be run manually by the human in the Supabase SQL Editor (per this project's existing workflow — SQL changes are never auto-applied) and confirmed before moving to the next step.

---

### Task 1: Fix schema/policy drift for `jobs`

**Files:**
- Modify: `supabase/schema/003_jobs.sql`
- Modify: `supabase/policies/004_jobs_policies.sql`

**Interfaces:**
- Consumes: nothing new — this task only corrects two docs-sequence files to describe the `jobs` table and `get_my_jobs()` function exactly as they already exist live (per `supabase/migrations/2026-08-19_job_number_auto_generation.sql` and CLAUDE.md's "`job_type` and `quoted_price` removed from `jobs`" entry).
- Produces: nothing consumed by later tasks in this plan — this task is self-contained.

- [ ] **Step 1: Rewrite `supabase/schema/003_jobs.sql`**

Replace the entire file with:

```sql
create type public.job_status as enum ('Quote', 'Work Order', 'Scheduled', 'Completed');

create sequence public.jobs_job_number_seq;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number integer not null default nextval('public.jobs_job_number_seq') unique,
  client_id uuid not null references public.clients(id),
  status public.job_status not null default 'Quote',
  assigned_to uuid references public.users(id),
  description text,
  site_address text,
  invoiced boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence public.jobs_job_number_seq owned by public.jobs.job_number;

comment on table public.jobs is 'A roofing job for a client, tracked from quote through completion. Invoicing is a separate future feature -- see the invoiced flag. job_number is a display-friendly sequential number (formatted client-side as "Job #0001" by formatJobNumber() in src/lib/jobConstants.js), backed by its own sequence rather than an identity column so a fresh install and the live backfilled sequence behave the same way.';
```

This removes the `job_type` enum and the `job_type`/`quoted_price` columns (both dropped from live), and adds `job_number` (with its backing sequence) and `site_address` (both live columns this file never had). `invoiced`, `created_by`, `created_at`, `updated_at` are unchanged from the current file.

- [ ] **Step 2: Rewrite `supabase/policies/004_jobs_policies.sql`**

Replace the entire file with:

```sql
alter table public.jobs enable row level security;

create policy "jobs_admin_all" on public.jobs
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "jobs_office_select" on public.jobs
  for select
  using (public.current_app_role() = 'office');

create policy "jobs_office_insert" on public.jobs
  for insert
  with check (public.current_app_role() = 'office');

create policy "jobs_office_update" on public.jobs
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Deliberately no SELECT policy for technicians on this table. RLS can
-- hide rows but not individual columns -- originally this protected
-- quoted_price specifically; that column was later dropped entirely
-- (superseded by job_line_items-based billing), but the same
-- column-hiding pattern is kept since it's still how technicians read
-- every other job field safely, and there's no reason to open direct
-- table access now that the original reason is gone. Instead,
-- technicians read their jobs through get_my_jobs() below, which is
-- SECURITY DEFINER (so it can bypass the missing SELECT policy).
create or replace function public.get_my_jobs()
returns table (
  id uuid,
  job_number integer,
  client_id uuid,
  status public.job_status,
  description text,
  site_address text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, job_number, client_id, status, description, site_address, created_at, updated_at
  from public.jobs
  where assigned_to = auth.uid();
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs, including job_number and site_address, without quoted_price/job_type (both dropped from the table) or invoiced status.';
```

This matches the live function exactly as defined by `supabase/migrations/2026-08-19_job_number_auto_generation.sql`.

- [ ] **Step 3: Verify the rewritten files match live exactly**

These are docs-only changes — live is already correct — so verification means confirming the files now describe live accurately, not re-running anything. In the Supabase SQL Editor, run this plain (non-transactional, no impersonation needed — it's schema introspection, not an RLS-gated read):

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'jobs'
order by ordinal_position;
```

Confirm the result has exactly these columns and no others: `id`, `job_number`, `client_id`, `status`, `assigned_to`, `description`, `site_address`, `invoiced`, `created_by`, `created_at`, `updated_at` — no `job_type`, no `quoted_price`. Then run:

```sql
select pg_get_functiondef(oid)
from pg_proc
where proname = 'get_my_jobs';
```

Confirm the returned definition's column list and body match Step 2's rewritten function exactly (same column names/order, same `where assigned_to = auth.uid()` body).

- [ ] **Step 4: Commit**

```bash
git add supabase/schema/003_jobs.sql supabase/policies/004_jobs_policies.sql
git commit -m "docs: sync jobs schema/policy files with live (drop job_type/quoted_price, add job_number/site_address)"
```

---

### Task 2: Sanitize diary photo filenames before building the storage path

**Files:**
- Modify: `src/hooks/useJobDiary.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — self-contained frontend change.

- [ ] **Step 1: Add a filename-sanitizing helper and use it in `addEntry`**

In `src/hooks/useJobDiary.js`, add this function above `useJobDiary`:

```js
function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}
```

Then change the `path` line inside `addEntry`'s `for` loop from:

```js
const path = `${jobId}/${Date.now()}-${file.name}`
```

to:

```js
const path = `${jobId}/${Date.now()}-${sanitizeFileName(file.name)}`
```

The full file after this change:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export function useJobDiary(jobId) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_diary')
      .select('id, entry_text, photo_paths, created_at, created_by')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (error) setError(error)
    else setEntries(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function addEntry({ entryText, photoFiles }) {
    const { data: { user } } = await supabase.auth.getUser()
    const photoPaths = []

    for (const file of photoFiles) {
      const path = `${jobId}/${Date.now()}-${sanitizeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('diary-photos')
        .upload(path, file)
      if (uploadError) return { error: uploadError }
      photoPaths.push(path)
    }

    const { error: insertError } = await supabase.from('job_diary').insert({
      job_id: jobId,
      entry_text: entryText,
      photo_paths: photoPaths,
      created_by: user.id,
    })

    if (insertError) return { error: insertError }
    await reload()
    return { error: null }
  }

  return { entries, loading, error, addEntry }
}
```

- [ ] **Step 2: Run the linter and build**

Run: `npx oxlint` and `npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 3: Manually verify with an awkward filename**

Run `npm run dev`, sign in as an office (or admin) test account, open a job, and add a diary entry with a photo whose filename contains spaces, unicode characters, and if your OS file picker allows it, rename a test file to include a literal `/`-like sequence (or use a very long filename) before selecting it. Confirm:
- The upload succeeds and the photo displays in the diary entry after reload.
- In the Supabase Storage browser, the object under `diary-photos/<jobId>/...` has a clean key (only letters, digits, `.`, `-`, `_` after the timestamp prefix).

Repeat signed in as the technician test account, using a job assigned to them, to confirm the technician upload path (`diary_photos_technician_insert` policy) still works unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useJobDiary.js
git commit -m "fix: sanitize diary photo filenames before building storage path"
```

---

### Task 3: Drop the unused `receipts` storage bucket

**Files:**
- Create: `supabase/migrations/2026-08-24_drop_receipts_bucket.sql`
- Modify: `supabase/storage/001_buckets_and_policies.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/2026-08-24_drop_receipts_bucket.sql`:

```sql
-- One-off migration to be run manually in the Supabase SQL Editor,
-- dropping the unused `receipts` storage bucket.
--
-- The `receipts` bucket was created for the OCR-receipts feature tied
-- to job_costs, which was scoped out (workers send receipts via
-- WhatsApp instead) and whose job_costs table was already dropped live
-- on 2026-08-19 (supabase/migrations/2026-08-19_drop_job_costs.sql).
-- Confirmed via grep that nothing in src/ references the `receipts`
-- bucket. Flagged as a possible future cleanup at the time of that
-- drop, actioned now as part of the security hardening pass.
--
-- Run the emptiness check below FIRST and confirm it returns 0 before
-- running the drop statements -- same rigor as the job_costs drop,
-- which confirmed row_count = 0 before dropping. storage.objects also
-- has a foreign key to storage.buckets, so a non-empty bucket would
-- fail to delete anyway, but the check should be done deliberately
-- rather than relied on as the only safety net.

-- Step A: run this first and confirm it returns 0.
-- select count(*) from storage.objects where bucket_id = 'receipts';

-- Step B: run these once Step A is confirmed empty.
drop policy "receipts_admin_office_all" on storage.objects;
delete from storage.buckets where id = 'receipts';
```

- [ ] **Step 2: Run the pre-drop emptiness check live**

In the Supabase SQL Editor, run:

```sql
select count(*) from storage.objects where bucket_id = 'receipts';
```

Confirm the result is `0`. Do not proceed to Step 3 if it isn't — stop and investigate what's in the bucket first.

- [ ] **Step 3: Run the drop live**

In the Supabase SQL Editor, run the two statements from Step B of the migration file:

```sql
drop policy "receipts_admin_office_all" on storage.objects;
delete from storage.buckets where id = 'receipts';
```

- [ ] **Step 4: Verify the bucket is gone**

In the Supabase SQL Editor, run:

```sql
select id from storage.buckets where id = 'receipts';
```

Confirm zero rows. Also check the Storage section of the Supabase dashboard UI and confirm `receipts` no longer appears in the bucket list.

- [ ] **Step 5: Update the fresh-install storage file**

Replace `supabase/storage/001_buckets_and_policies.sql` with:

```sql
insert into storage.buckets (id, name, public)
values ('diary-photos', 'diary-photos', false)
on conflict (id) do nothing;

-- Diary photos: admin/office full access.
create policy "diary_photos_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  );

-- Diary photos: technicians can upload/view files for their own
-- assigned jobs. Files must be uploaded under a path starting with
-- "<job_id>/..." -- storage.foldername(name) splits the path and
-- [1] is the first folder segment, i.e. the job id. Uses
-- technician_owns_job() rather than querying public.jobs directly --
-- a direct subquery would be blocked by jobs' own RLS, since
-- technicians have no SELECT policy on jobs.
create policy "diary_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and public.technician_owns_job(((storage.foldername(name))[1])::uuid)
  );

create policy "diary_photos_technician_select" on storage.objects
  for select
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and public.technician_owns_job(((storage.foldername(name))[1])::uuid)
  );
```

This removes the `receipts` bucket insert and its policy; the `diary-photos` bucket and its three policies are unchanged.

- [ ] **Step 6: Run the linter and build**

Run: `npx oxlint` and `npm run build`
Expected: both succeed — nothing in `src/` references the `receipts` bucket, so this change can't break the frontend.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/2026-08-24_drop_receipts_bucket.sql supabase/storage/001_buckets_and_policies.sql
git commit -m "chore: drop unused receipts storage bucket"
```

---

### Task 4: Record the hardening pass and handoff checklist in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — final task in this plan.

- [ ] **Step 1: Add a "Security Hardening Pass" entry to the "What's Built" section**

In `CLAUDE.md`, find this line (the last bullet in `## What's Built (verified, live)`, currently line 61):

```markdown
  - RLS/DDL recorded across three migrations: `supabase/migrations/2026-08-19_mocked_email_sms.sql`, `2026-08-19_bell_read_tracking_and_technician_sms.sql`, `2026-08-19_get_sender_name.sql`.
```

Insert a new top-level bullet immediately after it (still inside the same section, before the blank line and `## Current Phase` heading that follow):

```markdown
- **Security hardening pass** — full-stack audit (RLS policies, RPCs, storage policies, frontend) found no live access-control gap; all RLS-protected tables and `security definer` functions confirmed correctly scoped and fail-closed, consistent with every prior live-verified table in this project. Closed three findings: (1) `supabase/schema/003_jobs.sql` and `supabase/policies/004_jobs_policies.sql` had drifted from the live `jobs` table/`get_my_jobs()` (still referenced the dropped `job_type`/`quoted_price`, missing `job_number`/`site_address`) — rewritten to match live exactly, verified via `information_schema.columns` and `pg_get_functiondef` introspection, not assumed correct from the diff alone; (2) diary-photo filenames were used unsanitized as part of the storage object key in `useJobDiary.js` (not an RLS bypass — `jobId` always anchors the first path segment the storage policy checks — but attacker-controlled characters shouldn't land in a storage key regardless) — now sanitized to a safe character set before upload; (3) the `receipts` storage bucket, unused since `job_costs` was dropped, removed live (pre-drop emptiness check confirmed 0 objects, same rigor as the `job_costs` drop) and from the fresh-install storage file. Spec: `docs/superpowers/specs/2026-08-24-security-hardening-pass-design.md`; plan: `docs/superpowers/plans/2026-08-24-security-hardening-pass.md`.
```

- [ ] **Step 2: Update the "Explicit Decision — Do Not Reuse job_costs" note about the receipts bucket**

That section (currently line 86) ends with:

```markdown
The `receipts` storage bucket policy (`supabase/storage/001_buckets_and_policies.sql`) was tied to the same scoped-out OCR feature and is now also unused — not touched as part of this drop, flagged here as a possible future cleanup.
```

Replace that sentence with:

```markdown
The `receipts` storage bucket policy (`supabase/storage/001_buckets_and_policies.sql`) was tied to the same scoped-out OCR feature — dropped live as part of the security hardening pass (see "What's Built" above), after confirming it held 0 objects.
```

- [ ] **Step 3: Remove "Security hardening pass" from "Not Started Yet" and add the handoff checklist**

In `CLAUDE.md`, `## Not Started Yet` currently reads (lines 88-94):

```markdown
## Not Started Yet

Job Billing Integration (schema, RLS, bundle management UI, and Apply Bundle to Job) is fully complete — see above. `job_costs` table drop, job number auto-generation, the hard-delete/unarchive decision for clients and bundles, and the mocked email/SMS feature (satisfying both the Outlook/M365 and SMS backlog items) are also complete — see above.

- Security hardening pass
- Invoicing — real invoice generation, built from the already-real `job_line_items`/billing data, same standard as the rest of the app (not mocked). "Send to client" routes through the mocked email feature above, since email itself has no real connection. Reprioritized ahead of pilot testing.
- Pilot testing
```

Replace it with:

```markdown
## Not Started Yet

Job Billing Integration (schema, RLS, bundle management UI, and Apply Bundle to Job) is fully complete — see above. `job_costs` table drop, job number auto-generation, the hard-delete/unarchive decision for clients and bundles, the mocked email/SMS feature (satisfying both the Outlook/M365 and SMS backlog items), and the security hardening pass are also complete — see above. The security hardening pass left one outstanding item that isn't actionable from the repo — see "Security Handoff Checklist" below.

- Invoicing — real invoice generation, built from the already-real `job_line_items`/billing data, same standard as the rest of the app (not mocked). "Send to client" routes through the mocked email feature above, since email itself has no real connection. Reprioritized ahead of pilot testing.
- Pilot testing

## Security Handoff Checklist (outside the codebase)

Found during the security hardening pass but not actionable from the repo — needs direct action in the Supabase dashboard and/or hosting provider:

- [ ] Supabase Auth: confirm leaked-password protection is enabled
- [ ] Supabase Auth: confirm email confirmation is required for new accounts (lower priority today — accounts are admin-created only, no self-serve signup exists yet)
- [ ] Supabase Auth: review JWT/session expiry length against how long a technician's phone session should realistically stay logged in
- [ ] Once a hosting provider is chosen for deployment: add security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, etc.) at the host/CDN level — no deployment config exists in this repo yet
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record security hardening pass completion and handoff checklist"
```
