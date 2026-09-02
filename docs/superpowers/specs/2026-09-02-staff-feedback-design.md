# Staff Feedback — Design Spec

**Date:** 2026-09-02
**Status:** Approved

## Background

First item in a larger client-requested feedback list — starting with the simplest one. A page/mechanism for staff (all roles) to submit free-text suggestions about the CRM or the company, optionally with a photo attached. Nothing in the app currently supports open-ended, non-job-scoped input from users, so this introduces a new small feature area rather than extending an existing one.

## Relationship to existing screens

Nothing existing is modified. Two new UI entry points are added to `AppShell.jsx`:
- A persistent **feedback icon** next to `NotificationBell`, visible to all roles, opening a compose-only dropdown (mirrors `NotificationBell`'s icon-button + dropdown-panel interaction pattern from `src/components/NotificationBell.jsx`).
- A conditional nav link, **admin only**, to a separate inbox page for viewing submissions.

Photo upload reuses the exact pattern already proven in `useJobDiary.js`/`DiarySection.jsx`: sanitized filename, path-prefixed storage key, private bucket, signed URLs for display.

## Scope

In scope:
- `feedback` table + RLS
- `feedback-photos` storage bucket + policies
- `FeedbackIcon` component (compose dropdown, all roles) mounted in `AppShell`
- `useFeedback()` hook — submit only (insert row + upload photos)
- `FeedbackInbox` page at `/feedback`, admin-only, listing all submissions newest-first with submitter name and any attached photos
- `useFeedbackInbox()` hook — list/reload only, separate from the submit hook so non-admin roles never issue a query that RLS would just return empty anyway
- Admin-only nav link ("Feedback Inbox") to `/feedback`

Out of scope (explicitly deferred):
- Category/type field — single free-text `message` only. Revisit later if triage demand shows up.
- Any "resolved/reviewed" status, reply, or follow-up workflow on a submission — read-only inbox for this phase.
- Office access to the inbox — **deliberate exception** to this app's usual admin/office pairing (see Access below).
- Technician (or any submitter) ever seeing their own past submissions again after submitting.
- Editing or deleting a submitted feedback item (beyond the standard unrestricted admin `for all` policy).

## Data model

```sql
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.users(id),
  message text not null,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.feedback is 'Free-text suggestions/feedback submitted by any staff member about the CRM or the company.';
```

No category/type column, no status column — deliberately minimal for the first phase.

## Access (RLS)

Departs from this app's usual admin/office pairing in two ways, both explicit decisions from this design round, not oversights:

1. **Self-attribution is enforced for every role that can insert, including office** — unlike `job_diary_office_insert` (which lets office log an entry without `created_by = auth.uid()`), feedback is inherently personal, so an office insert must also satisfy `submitted_by = auth.uid()`. Admin keeps the standard unrestricted `for all` policy, consistent with every other admin policy in this codebase (an admin acting as any user is already an accepted baseline elsewhere, e.g. `job_diary_admin_all`).
2. **View access is admin-only, not admin/office** — office can submit feedback like every other role but cannot read the `feedback` table at all. This is intentional: submissions may include comments about office staff themselves, so office is treated the same as technician for viewing purposes.

```sql
alter table public.feedback enable row level security;

create policy "feedback_admin_all" on public.feedback
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "feedback_office_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'office'
    and submitted_by = auth.uid()
  );

create policy "feedback_technician_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'technician'
    and submitted_by = auth.uid()
  );
```

No select policy exists for office or technician — both can insert but neither can read any row back, including their own.

## Storage (photos)

New private bucket `feedback-photos`, path convention `<user_id>/<timestamp>-<sanitized_filename>` (mirrors `<job_id>/...` in `diary-photos`, using the existing `sanitizeFileName()` helper pattern from `useJobDiary.js`).

```sql
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

create policy "feedback_photos_admin_all" on storage.objects
  for all
  using (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  )
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  );

create policy "feedback_photos_office_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'office'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "feedback_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'technician'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Same asymmetry as the table: office and technician can upload but not read back (no select policy for either) — consistent with neither role being able to view the inbox. Multiple photos per submission are allowed, all optional, matching `job_diary`'s array-of-paths approach.

## Frontend

**`FeedbackIcon`** (new component, mounted in `AppShell.jsx` beside `NotificationBell`, visible to all roles): icon button toggles a dropdown panel containing the compose form only (message textarea + optional multi-file photo input + submit button). No history/list is ever shown here, for any role, including admin — this is compose-only. Submitting closes the dropdown and clears the form; errors surface inline in the panel. Uses `useFeedback()`, which exposes a single `submit({ message, photoFiles })` function (insert row + upload photos), with no `reload`/list-loading logic — mirrors the shape of `useJobDiary`'s `addEntry` half only.

**`FeedbackInbox`** (new page at `/feedback`, admin-only — route added to `App.jsx`, nav link added to `AppShell.jsx` conditional on `profile?.role === 'admin'`, the inverse of the existing `!== 'technician'` conditions used for Catalog/Bundles): lists all submissions newest-first, each showing submitter name (joined via `users!feedback_submitted_by_fkey(full_name)` — safe as a direct embedded join here, unlike `communications`' `get_sender_name()` workaround, because only admin ever runs this query and admin already has unrestricted `select` on `public.users` via `users_admin_all`), message text, timestamp, and any attached photos resolved to signed URLs (mirrors `DiarySection`'s `photoUrls` resolution effect). Uses a separate `useFeedbackInbox()` hook (select + reload only, mirrors `useJobDiary`'s `reload` half only) so the list-loading logic isn't tangled with `useFeedback()`'s submit-only logic used by every role via the icon.

## Testing / verification plan

Live RLS verification against test accounts for all three roles, following this project's established pattern (`DO` block + `RAISE EXCEPTION`, never combined with real DDL):
- admin: full CRUD on `feedback`, can read all submissions regardless of submitter
- office: insert succeeds only with `submitted_by = auth.uid()` (a spoofed `submitted_by` is rejected), select on `feedback` returns zero rows
- technician: same insert self-attribution check, select returns zero rows
- storage: admin can read/write any object in `feedback-photos`; office and technician can upload only under their own `auth.uid()` folder and cannot list/read anything back (including their own upload)
- frontend: manually confirm the icon renders identically for all three roles and opens a compose-only panel; confirm `/feedback` is reachable and populated for admin; confirm office/technician are not shown the nav link (matching the existing `!== 'technician'` conditional-hide convention used for Catalog/Bundles) and that navigating there directly renders an empty list, since RLS returns zero rows rather than an error — no route guard exists anywhere else in this app, so none is introduced here either
