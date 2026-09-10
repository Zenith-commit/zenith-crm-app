# Queue Tab — Design Spec

**Date:** 2026-09-11
**Status:** Approved

## Background

Item 5 on the client's post-pilot feedback list (`CLAUDE.md` "Client Feedback List," Phase B). A job organization system, independent of the `job_status` pipeline: admin/office sort jobs into named "folders" (e.g. "To Quote," a per-staff "to action" list) for their own workflow tracking. Purely internal to admin/office — technicians have zero access, matching the existing pattern on `materials_catalog`/`bundles`.

This is explicitly not a replacement for or extension of `job_status` (`Quote → Work Order → Scheduled → Completed`). A job's queue and its status are two independent fields that can vary freely against each other.

## Scope

In scope:
- `queues` table + RLS (admin/office CRUD, technician zero access)
- `jobs.queue_id` nullable FK, `on delete set null`
- New `/queues` nav page: create, rename, delete queues
- Queue column + filter on the Jobs list (staff only)
- Queue picker on `JobDetail`'s Details tab, for moving a job between queues (or to unqueued)
- Delete-queue confirmation shows the affected job count

Out of scope:
- Bulk job reassignment (multi-select move) — not needed at today's expected queue/job volumes, no existing bulk-action UI in this app to extend
- Automatic status-based queue assignment — manual only, confirmed
- Any change to `job_status`, `get_my_jobs()`, or technician-facing code — queues are invisible to technicians end to end
- Per-staff "my queue" personalization/ownership — queues are shared/global like bundles, not owned by the creator

## Data model

```sql
create table public.queues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.queues is 'Admin/office-defined job organization folders (e.g. "To Quote"), independent of job_status. A job belongs to at most one queue at a time. Deleting a queue does not delete its jobs -- jobs.queue_id is on delete set null, so affected jobs simply become unqueued.';

alter table public.jobs
  add column queue_id uuid references public.queues(id) on delete set null;

comment on column public.jobs.queue_id is 'Which queues folder this job is currently filed under, or null if unqueued. Manually assigned only -- no automatic status-based logic. Independent of jobs.status.';
```

No `active` flag on `queues`: unlike `materials_catalog`/`bundles`, deleting a queue destroys no real business record — jobs survive and simply become unqueued (`on delete set null`), so hard delete is the correct semantics here, the same reasoning already used for `job_contacts`' no-`active`-flag decision.

No `unique` constraint on `name` — queues are informal folders, not identifiers referenced elsewhere; nothing else in this app enforces catalog-name uniqueness either.

## Access (RLS)

`queues` follows the `job_contacts` broader-office-access shape (not the stricter `bundles`/`clients` shape): office gets full CRUD including delete. Reasoning: deleting a queue here is non-destructive to job data — there's no hard-delete-of-real-history risk that justified withholding delete from office elsewhere. Zero policy for technician → default-deny.

```sql
alter table public.queues enable row level security;

create policy "queues_admin_all" on public.queues
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "queues_office_select" on public.queues
  for select
  using (public.current_app_role() = 'office');

create policy "queues_office_insert" on public.queues
  for insert
  with check (public.current_app_role() = 'office');

create policy "queues_office_update" on public.queues
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "queues_office_delete" on public.queues
  for delete
  using (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default.
```

`jobs.queue_id` needs no new policy — it's just another column on `jobs`, already covered by the existing `jobs` admin/office UPDATE policies. Technicians have no UPDATE policy on `jobs` at all today, so a technician can never move a job between queues, automatically, with no new rule required.

## Frontend

**New nav item** — "Queues" link in `AppShell`, gated the same way as Catalog/Bundles (`profile?.role !== 'technician'`).

**`QueueList` page** (`/queues`, new): a simple flat list of queues (name + job count), with inline rename and a Delete action per row. No dedicated detail/edit page — queues are just names, nothing like the bundle/catalog scoping that justified separate pages elsewhere. An "Add Queue" form (name only) at the top, matching the minimal-form convention used by `BundleList`'s equivalent.

**Delete confirmation with job count**: Delete first runs a count query (`select count(*) from jobs where queue_id = :id`) and shows a confirm dialog: if count > 0, *"This queue has N jobs — they'll become unqueued. Delete anyway?"*; if count is 0, a plain *"Delete this queue?"* confirm. Only on confirm does the actual delete fire. This is a read-then-confirm UX pattern, not a DB-level warning — no schema change needed for it.

**`JobList`**: add a "Queue" column (staff only, showing the queue name or "Unqueued") and a queue filter `<select>` next to the existing status filter, populated from the same `queues` table, mirroring `JobList.jsx`'s existing `statusFilter` local-state pattern exactly. `useJobs.js`'s staff-role query gains `queue_id, queues(name)` to the select list; the technician branch is untouched (queues never appear for technicians, so `get_my_jobs()` needs no new column).

**`JobDetail`** (Details tab): a queue `<select>` next to the status field, staff-only, listing all queues plus an "Unqueued" option, defaulting to the job's current `queue_id`. Selecting a different value immediately fires `supabase.from('jobs').update({ queue_id }).eq('id', jobId)` — no separate Save step, consistent with how a single-field change should behave (this is not part of the larger `JobForm` edit flow). Deliberately a plain flat `<select>` (not a searchable `MaterialPicker`-style combobox) — confirmed assumption: queue counts are expected to stay small (folder-style buckets, per-staff lists), not open-ended growth like the materials catalog or a property-management client's address list.

## Testing / verification plan

Live RLS verification against test accounts for all three roles, following this project's established pattern (`DO` block + `RAISE EXCEPTION`, never combined with real DDL):
- admin: full CRUD on `queues`
- office: insert/update/select/delete all succeed on `queues`
- technician: zero access to `queues` (select returns nothing, insert/update/delete all rejected)
- confirm updating `jobs.queue_id` works for admin/office via the existing `jobs` policies, and is rejected for technician via the existing (unchanged) `jobs` UPDATE policy
- confirm `on delete set null` behavior directly: create a queue, assign it to a job, delete the queue, verify the job's `queue_id` is now null and the job row itself still exists

Frontend, manually verified for all three roles:
- `/queues` page: create, rename, delete (both the zero-job and has-jobs confirm-dialog paths, checking the job count in the message is correct) — staff only, absent for technician
- Jobs list: Queue column and filter work correctly, absent for technician
- Job Detail: queue picker moves a job between queues (and to Unqueued) immediately without a separate save step, staff only, absent for technician
- Confirm `get_my_jobs()` / technician-facing UI shows no trace of queues anywhere
