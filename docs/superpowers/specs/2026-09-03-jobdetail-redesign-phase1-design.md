# JobDetail Redesign — Phase 1: Tabs, Job Contact, Email/SMS Modals — Design Spec

**Date:** 2026-09-03
**Status:** Approved

## Background

`JobDetail` today is one long stacked page: header (status/description/Edit Job), `ClientSiteInfoSection`, `BillingSection`, `InvoiceSection` (staff-only), `DiarySection`, and two `CommunicationSection` instances (email staff-only, SMS all roles). This is the first of a two-phase redesign toward a ServiceM8-style layout: a left sidebar of tabs for the page's distinct concerns, and a persistent right-side panel for job activity.

This phase builds the layout shell, adds a new job-specific Contact override (separate from the client's real contact info), and converts Email/SMS from inline stacked sections into header-triggered modals. It deliberately stops short of the unified activity feed (diary + email + sms + booking history merged into one sorted list) — that is Phase 2, its own spec, once this phase's layout exists to extend. Phase 2 will also need a new `job_events` table, a DB trigger on `jobs` to populate it, and a new technician RLS policy — none of that is built here.

Once Phase 2 ships, Roof Reports (a deferred item from the client's post-pilot feedback list, still blocked on content/design input from Abigail) will be added as its own tab in this structure — no action needed on that now.

## Relationship to existing screens

`JobDetail.jsx` is restructured, not replaced. Existing components are relocated into the new layout with minimal internal changes:

- **Details tab** — today's header (status, description, Edit Job / `JobForm`) plus `ClientSiteInfoSection` exactly as it is today, unchanged. `ClientSiteInfoSection` continues to edit the real `clients.phone`/`clients.email` and `jobs.site_address` directly — this phase does not touch that behavior.
- **Job Contact tab** (new) — a new, standalone contact form, unrelated to `ClientSiteInfoSection`. Confirmed in design review: these are two genuinely separate things shown in two separate places, not a replacement/fallback pair. A job can have a real client contact (Details tab) and a separate job-specific contact (e.g. an on-site tenant or site foreman) at the same time.
- **Billing tab** — `BillingSection`, unchanged.
- **Invoicing tab** — `InvoiceSection`, unchanged, still hidden from technicians (staff-only tab, matching today's `isStaff` gating).
- **Right panel (persistent across all tabs)** — `DiarySection`'s existing list + compose form (text + photo upload), relocated as-is. No behavior change, no schema change — this is purely a layout move so Phase 2 can extend the same panel with email/sms/events instead of introducing a second layout change later.
- **Email / SMS** — `CommunicationSection`'s internal logic (`useCommunications`, send, simulate incoming reply) is unchanged. It's now opened from two header buttons ("Email", "SMS") into a modal instead of always being rendered inline. Email button staff-only (matching today's `isStaff` gate); SMS button visible to all roles.

Job status remains exactly `Quote → Work Order → Scheduled → Completed`, unchanged. `job_category`/PO Number fields remain deferred, not built this phase.

## Scope

In scope:
- Tab navigation shell on `JobDetail` (left sidebar: Details, Job Contact, Billing, Invoicing) — component-local state (`activeTab`), not new routes, since no other page in this app has sub-navigation to mirror and a job's tabs aren't independently linkable/bookmarkable requirements today.
- Persistent right-side panel containing the relocated `DiarySection`.
- New shared `Modal` component (first in this app) — backdrop, closes on `X` click or Escape key.
- Email and SMS conversion from inline sections to modals, triggered by header buttons.
- `job_contacts` table + RLS + `JobContactSection` component + `useJobContact` hook.

Out of scope (explicitly deferred to Phase 2 or later):
- `job_events` table, the DB trigger, and any booking/status-change history.
- Merging diary/email/sms/events into one unified sorted feed — the right panel this phase shows diary only.
- Job Category and PO Number fields.
- Roof Reports tab.

## Data model

```sql
create table public.job_contacts (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.job_contacts is 'A job-specific contact person (e.g. on-site tenant or foreman), separate from and independent of the linked client''s own contact info in public.clients. Editing this never updates public.clients. At most one row per job -- job_id is the primary key, so "no override set" is a missing row, not a row of nulls.';
```

`job_id` as primary key enforces at most one contact per job. All five contact fields are nullable individually (a partial contact — e.g. name and mobile only — is valid), but the row's existence is what the UI treats as "a job contact has been set."

No `active` flag: unlike `materials_catalog`/`bundles`/`clients`, this isn't a standalone record with its own history worth preserving — it's a single optional 1:1 override row. Deleting it to mean "no job contact" is the correct semantics here, not a hard-delete of a real business record.

## Access (RLS)

Confirmed in design review: technicians can **view** the job contact (they need to know who to call on-site), and office can **delete/clear** it (reasonable here specifically because it's a single optional override row, not a permanent record like a client — clearing it doesn't destroy real history the way hard-deleting a client would). This makes office's policy set on `job_contacts` one step broader than the usual admin-`for all`/office-explicit-no-delete pattern, mirroring the same reasoning already used for `bundle_items_office_delete`.

```sql
alter table public.job_contacts enable row level security;

create policy "job_contacts_admin_all" on public.job_contacts
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_contacts_office_select" on public.job_contacts
  for select
  using (public.current_app_role() = 'office');

create policy "job_contacts_office_insert" on public.job_contacts
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_update" on public.job_contacts
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_delete" on public.job_contacts
  for delete
  using (public.current_app_role() = 'office');

-- Technicians can view the job contact for jobs assigned to them --
-- same technician_owns_job() pattern as job_diary_technician_select --
-- but cannot create, edit, or clear it.
create policy "job_contacts_technician_select" on public.job_contacts
  for select
  using (
    public.current_app_role() = 'technician'
    and public.technician_owns_job(job_contacts.job_id)
  );
```

No changes to any existing table's RLS. `communications`, `job_diary`, `job_line_items`, `invoices` etc. all keep exactly the visibility they have today — this phase only adds new policies on the new table.

Technician read access needs one more piece: `get_my_jobs()` doesn't currently return contact info, and technicians have no direct `select` on `jobs` at all (by design). Rather than extend `get_my_jobs()` (which returns job fields, not a related table's row), `JobContactSection` queries `job_contacts` directly — the new `job_contacts_technician_select` policy above is what makes that safe, the same way `job_diary_technician_select` lets `DiarySection` query `job_diary` directly rather than going through an RPC.

## Frontend

**`JobDetail.jsx`** restructured around a tab shell: left sidebar with four buttons (Details / Job Contact / Billing / Invoicing — Invoicing omitted entirely for technicians, matching today's `isStaff` gate on `InvoiceSection`), `activeTab` local state defaulting to `Details`, main content area rendering whichever section matches. Two new header buttons ("Email", "SMS") sit above the tab content, each opening a `Modal` containing the existing `CommunicationSection` for that type. The right-side panel (containing `DiarySection`) renders unconditionally alongside the tab content, not inside any tab.

**`Modal`** (new, `src/components/Modal.jsx`): minimal — backdrop overlay, a panel with an `X` close button, closes on backdrop click and on `Escape` keydown. No animation library, no focus-trap dependency added — matches this app's convention of no new dependencies for UI primitives (e.g. `MaterialPicker` was built with no new dependency).

**`JobContactSection`** (new, `src/components/JobContactSection.jsx`, mounted under the Job Contact tab): read view shows first/last name, email, phone, mobile, or "No job contact set" if no row exists — visible to all roles. Staff-only edit form (matching `ClientSiteInfoSection`'s edit-gating convention) with Save and a "Clear" action (delete the row) gated to staff. Save either inserts (no row yet) or updates (row exists) via a single upsert on `job_id`.

**`useJobContact(jobId)`** (new hook, `src/hooks/useJobContact.js`): mirrors `useJobDiary`'s shape — `reload` on mount, plus a `save({ first_name, last_name, email, phone, mobile })` function doing `supabase.from('job_contacts').upsert({ job_id: jobId, ...values, updated_by: user.id })` and a `clear()` function doing `supabase.from('job_contacts').delete().eq('job_id', jobId)`.

**`CommunicationSection`** — no internal changes. Only its mounting context changes (inside a `Modal` instead of directly in the page).

## Testing / verification plan

Live RLS verification against test accounts for all three roles, following this project's established pattern (`DO` block + `RAISE EXCEPTION`, never combined with real DDL):
- admin: full CRUD on `job_contacts` for any job
- office: insert/update/select/delete succeed; confirm delete actually removes the row (not just clears fields)
- technician: select succeeds only for a job assigned to them (returns the row or confirms none exists), returns nothing for a job not assigned to them, insert/update/delete all rejected

Frontend, manually verified for all three roles:
- Tab navigation switches content without a full page reload; Invoicing tab absent for technicians
- Right-side panel with Diary list + compose renders identically to today's `DiarySection` behavior (add entry with photo, list order unchanged)
- Email button/modal: staff-only, opens/closes correctly (X, Escape, backdrop click), send + simulate-incoming-reply still work exactly as before
- SMS button/modal: same, visible and usable by all three roles including technician
- Job Contact tab: staff can set/edit/clear a contact; technician sees the same contact read-only with no edit/clear controls, and sees "No job contact set" correctly when none exists
- Confirm editing the Job Contact never modifies the linked client's `phone`/`email` (spot-check `clients` row before/after)
