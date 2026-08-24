# Security Hardening Pass — Design Spec

**Date:** 2026-08-24
**Status:** Approved

## Background

Job Billing Integration, job numbers, hard-delete/unarchive, and the mocked email/SMS feature are all complete and live-verified (see CLAUDE.md). Per the project backlog, this is the next phase, ahead of invoicing. No specific known vulnerability prompted this — it's a general audit: a full-stack pass over RLS policies, RPCs, storage policies, and the frontend to find and close gaps before invoicing (real money-adjacent data) is built on top.

## Audit method

Read every RLS policy file (`supabase/policies/*.sql`), every migration (`supabase/migrations/*.sql`), every schema file (`supabase/schema/*.sql`), the storage bucket policies, `src/lib/supabaseClient.js`, `src/hooks/useSession.js`, `App.jsx`/`AppShell.jsx` routing, and grepped the frontend for `dangerouslySetInnerHTML`/`eval`/`innerHTML`, raw SQL string-building, and every `storage.from(...).upload(...)` call site. Ran `npm audit`. Checked git history for accidental `.env` commits.

## Findings

### Confirmed, no action needed

- All RLS-protected tables (`users`, `clients`, `jobs`, `job_diary`, `communications`, `materials_catalog`, `bundles`, `bundle_items`, `job_line_items`, `job_applied_bundles`) have RLS enabled with a consistent deny-by-default pattern; no table found with RLS disabled or a policy gap beyond what's already documented in CLAUDE.md.
- Every `security definer` function (`current_app_role`, `technician_owns_job`, `technician_has_job_for_client`, `get_my_jobs`, `get_my_job_line_items`, `get_my_job_applied_bundles`, `get_sender_name`) is scoped tightly to the caller's own rows and fails closed (returns null/empty, not an error, for an unauthorized caller). `apply_bundle_to_job` is correctly `security invoker`, relying on RLS for its access control rather than elevated privilege.
- No `dangerouslySetInnerHTML`, `eval`, or raw `innerHTML` assignment anywhere in `src` — React's default escaping is intact everywhere.
- No raw/string-built SQL anywhere in the frontend — every data access goes through the supabase-js query builder or a vetted RPC.
- `.env` is gitignored and confirmed never committed to git history (checked via `git log --all --full-history -- .env`); only the anon key is used client-side, which is correct — RLS is the actual authorization boundary, not key secrecy.
- `npm audit` reports 0 vulnerabilities across dependencies.
- Route access is gated behind session state in `AppShell` (unauthenticated users see `Login`, nothing else renders); role-based nav-link hiding is UI-only as designed, backed by RLS as the real enforcement — consistent with this app's established pattern.
- Diary-photo storage RLS (`diary_photos_technician_select`/`_insert`) correctly anchors ownership to the literal first path segment of the object key, which is always the app-supplied `jobId` — not attacker-influenced regardless of what's in the uploaded file's name.

### Finding 1 — Fresh-install schema/policy files have drifted from live

`supabase/schema/003_jobs.sql` still creates the `job_type` enum and the `job_type`/`quoted_price` columns on `jobs`. Both were dropped from the live table (recorded in CLAUDE.md under "`job_type` and `quoted_price` removed from `jobs`"), but this file was never updated to match.

`supabase/policies/004_jobs_policies.sql` still defines the pre-job-number `get_my_jobs()` (returns `job_type`, no `job_number`/`site_address`). The live function was drop/recreated twice since — once to add client/site-info columns, once to add `job_number` (see `supabase/migrations/2026-08-19_job_number_auto_generation.sql`) — but this file was never updated to match either time.

By contrast, the equivalent drift on `materials_catalog`/`bundles`/`bundle_items` *was* correctly folded back into their policy files during the 2026-08-19 hard-delete work — this is an isolated miss, not a systemic pattern.

**Risk:** not exploitable against the live database today. The risk is to reproducibility — rebuilding from `supabase/schema/` + `supabase/policies/` (a new environment, staging, disaster recovery) would produce a `jobs` table with a column the app no longer uses, missing `job_number`/`site_address` entirely, and a `get_my_jobs()` that doesn't match what `JobList`/`JobDetail` expect from it for technicians.

**Fix:** rewrite both files to match live exactly. Docs-only change — live database is already correct, so no migration or live SQL execution is needed for this finding, only editing the two files.

### Finding 2 — Diary photo filenames aren't sanitized before use as a storage key

`src/hooks/useJobDiary.js`, `addEntry()`:
```js
const path = `${jobId}/${Date.now()}-${file.name}`
```
`file.name` is attacker-controlled (whatever the uploading technician's OS reports) and flows unsanitized into the storage object key. Confirmed this is **not** an RLS/access-control bypass — `jobId` is always the literal first path segment, and the storage policy's ownership check (`(storage.foldername(name))[1]`) only ever reads that first segment, so nothing in `file.name` can move a file into another job's folder. The exposure is narrower: unusual characters (unicode, very long names, embedded `/`) become part of a real storage key, which can produce confusing nested groupings in the storage browser or filenames the Supabase client itself rejects.

**Fix:** sanitize `file.name` to a safe character set (alphanumeric, `.`, `-`, `_`; everything else collapsed to `_`) before building the path. Frontend-only change.

### Finding 3 — Unused `receipts` storage bucket

`supabase/storage/001_buckets_and_policies.sql` still creates a `receipts` bucket and its `receipts_admin_office_all` policy, built for the OCR-receipts feature that was scoped out (workers send receipts via WhatsApp instead) and whose `job_costs` table was already dropped live on 2026-08-19. Confirmed via grep that nothing in `src` references the `receipts` bucket. Already flagged as a possible future cleanup in CLAUDE.md when `job_costs` was dropped, never acted on until now.

**Risk:** not exploitable — the bucket's policy is still correctly admin/office-only. It's dead surface: an unused, easy-to-forget bucket that could quietly accumulate files or get overlooked in a future audit.

**Fix:** same rigor as the `job_costs` drop — confirm the bucket is genuinely empty (no objects in it) before dropping anything, then drop the policy and the bucket row live, then remove the bucket block from `supabase/storage/001_buckets_and_policies.sql` so a fresh install doesn't recreate it.

### Out of scope — handoff checklist

These can't be verified or changed from the repo; they need direct action in the Supabase dashboard and/or a hosting provider once one is chosen. Recorded here as a checklist rather than actioned:

- [ ] Supabase Auth: confirm leaked-password protection is enabled
- [ ] Supabase Auth: confirm email confirmation is required for new accounts (relevant once self-serve signup exists — currently accounts are admin-created only, per CLAUDE.md, so lower priority today)
- [ ] Supabase Auth: review JWT/session expiry length against how long a technician's phone session should realistically stay logged in
- [ ] Once a hosting provider is chosen: add security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, etc.) at the host/CDN level — no deployment config exists in this repo yet, so there's nothing to hardening-pass on the frontend-hosting side today

## Scope

In scope:
- Rewrite `supabase/schema/003_jobs.sql` and `supabase/policies/004_jobs_policies.sql` to match live (Finding 1)
- Sanitize diary-photo filenames in `useJobDiary.js` (Finding 2)
- Drop the `receipts` bucket: pre-drop emptiness check, live drop (policy + bucket), remove from `supabase/storage/001_buckets_and_policies.sql` (Finding 3)
- Add the handoff checklist above to CLAUDE.md so it isn't lost

Out of scope (explicitly deferred):
- Any Supabase dashboard/Auth settings changes (handoff checklist only)
- Deployment/hosting security headers (no host chosen yet)
- Invoicing, pilot testing (next phases, unaffected by this pass)
- Any new RLS policy or table change — this pass found no live policy gaps requiring one

## Testing

No automated JS test suite — manual verification, same pattern as every prior phase:
- Finding 1: diff the rewritten `003_jobs.sql`/`004_jobs_policies.sql` against the live schema (via Supabase SQL Editor introspection: `\d public.jobs`-equivalent and `pg_get_functiondef` on `get_my_jobs()`) to confirm the rewritten files describe live exactly, rather than re-running them live
- Finding 2: upload a diary photo through the running app with an intentionally awkward filename (spaces, unicode, embedded `/`) as both office and a technician on their assigned job; confirm upload succeeds and the photo displays correctly
- Finding 3: query `storage.objects` for `bucket_id = 'receipts'` and confirm zero rows before dropping anything; after dropping, confirm the bucket no longer appears in Storage and `npm run build` / `npx oxlint` still pass (nothing references it)
