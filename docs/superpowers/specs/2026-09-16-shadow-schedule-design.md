# Shadow Schedule — Design Spec

**Date:** 2026-09-16
**Status:** Approved

## Background

Item 6 on the client's post-pilot feedback list (`CLAUDE.md` "Client Feedback List," Phase B). A real dispatch calendar — ServiceM8's Dispatch Board is the explicit UI reference: staff-as-rows, hourly time columns, a Day/Week/2-weeks/Month toggle, drag-and-drop from an unscheduled-jobs list onto a specific staff/time slot.

Requirements confirmed point-by-point with the client's office contact (Riley), then refined further during this design session:

- Scheduling assigns a specific date, time, and technician per entry — not just a date field on `jobs`.
- **Quote-stage (inspection) scheduling is a simple direct booking** — pick one date/time/technician and it's immediately confirmed. No tentative/draft state at all for inspections.
- **Work-Order-stage (restoration work) scheduling supports multiple tentative "maybe" holds at once**, before one is confirmed. Confirming one drops the others.
- Once confirmed, a job can span multiple real days of work — multiple confirmed rows, not one date field.
- Technicians never see unconfirmed/tentative entries, regardless of assignment — confirmed only, and only for jobs genuinely theirs (see the access-model change below).
- Visible to any office staff (role-based — admin/office, not named individuals).
- Real drag-and-drop, via a new dependency — the first exception to this project's "no new dependency for UI primitives" convention (every prior UI piece — `MaterialPicker`, `Modal`, the Queue picker — used zero new dependencies). Justified given the complexity of a real dispatch grid.

This is the largest single feature scoped in this project to date — bigger than Job Billing Integration. It is being delivered as multiple separate implementation plans (see "Phasing" below), the same way Job Billing split into "tables + bundle UI" and a separate "Apply Bundle to Job" plan.

## Scope

In scope:
- `schedule_entries` table + RLS
- Three new SQL functions: `create_schedule_entry()`, `confirm_schedule_entry()`, `remove_schedule_entry()`
- Extending `technician_owns_job()`, `get_my_jobs()`, and `technician_has_job_for_client()` to recognize confirmed schedule entries as a second path to job/client access, alongside the existing `jobs.assigned_to`
- Full regression verification of every existing feature gated by `technician_owns_job()` (see "Testing / verification plan")
- `jobs.status` auto-transitions tied to Work-Order-stage confirmation/removal (not inspection)
- New `/schedule` staff-only Dispatch Board page: Day/Week/2-weeks/Month view toggle, technician rows, unscheduled-jobs side list, drag-and-drop booking and rescheduling
- Dashboard/JobList showing each job's actual next confirmed date/time, not just a status label
- New dependency: Atlassian `@atlaskit/pragmatic-drag-and-drop`

Out of scope (explicitly deferred, not scheduled):
- A dedicated technician-facing calendar view — technicians keep using their existing Dashboard/JobList, now correctly populated (confirmed decision, see below)
- Recurring/repeating bookings
- Conflict detection (double-booking a technician is not blocked — office is trusted to notice, same "no guardrails beyond what's asked" standard as the rest of this app)
- Any change to `jobs.assigned_to` itself as a field, or the manual technician dropdown on `JobForm` — it stays as-is; schedule entries are a second, additive access path, not a replacement
- Editing/repositioning inspection bookings via the drag grid on first pass is in scope for parity with work bookings, but a simpler "reschedule" form is an acceptable fallback if drag onto an inspection block proves awkward in Phase 2/3 — implementer's call, not a hard requirement

## Design decisions from this session

**Amendment 2026-09-21 (Phase 2 design):** `create_schedule_entry()` now has an explicit `Completed` branch. A booking on a Completed job (a warranty / return visit) is a directly-confirmed `work` entry and leaves `jobs.status` as `Completed`. The rule above ("anything else -> work, tentative unless the job already has a confirmed work entry") therefore applies to `Work Order` and `Scheduled` only. See `docs/superpowers/specs/2026-09-21-shadow-schedule-phase2-design.md`.

**Inspection vs. work entries are distinguished by an explicit `entry_type` column, set once at creation and never changed.** `entry_type` is derived from `jobs.status` *at the moment the entry is created* — `'Quote'` → `'inspection'`, anything else → `'work'` — not re-derived later if the job's status subsequently changes. This is a deliberate simplification: a job normally gets one inspection entry while at `Quote`, then (after office manually moves it to `Work Order`, unchanged existing behavior) gets work entries later. A rare re-inspection booked after the job has left `Quote` would be classified `'work'` even though it's conceptually an inspection — accepted as an edge case, not worth a more complex classifier.

**Only `entry_type = 'work'` entries ever use the tentative flow.** Inspection entries are always inserted directly as `'confirmed'`. This is enforced inside `create_schedule_entry()` (see below), not left to the frontend to get right.

**Once a job has any confirmed `'work'` entry, further work entries for that job are also inserted directly as `'confirmed'`** — the tentative phase only applies to the initial "which of these candidate slots is real" decision for a job's restoration work. Adding a second/third day to an already-locked-in job is not a new round of maybes.

**`jobs.status` auto-transitions, tied only to work entries:**
- Confirming a job's first `'work'` entry (via `confirm_schedule_entry()`, or directly via `create_schedule_entry()` if the job already had a confirmed work entry) sets `jobs.status = 'Scheduled'` — but only if the job's current status is `'Work Order'`. This never fires for inspection entries, so booking an inspection never skips a job past `Work Order`.
- Removing a job's *last remaining* confirmed `'work'` entry (via `remove_schedule_entry()`) reverts `jobs.status` back to `'Work Order'` — but only if the job's current status is still exactly `'Scheduled'`. This is a fixed revert target, not "whatever the status was before" — this app has no prior-status history column anywhere, and adding one just for this would be new architecture beyond what's needed. If a job has since been manually moved to `'Completed'`, removing an old entry does not touch it.

**Access model: confirmed schedule entries become a second path to job/client access, alongside `assigned_to`.** Locking a technician out of a job they're genuinely scheduled to work (e.g. day 2 of a multi-day, multi-technician job, where they're not the `assigned_to` technician) would defeat the point of this feature. Three existing functions change their ownership check from `assigned_to = auth.uid()` to `assigned_to = auth.uid() OR exists(confirmed schedule_entries for this technician+job)`:

1. **`get_my_jobs()`** — otherwise a technician scheduled only via `schedule_entries` wouldn't see the job in their list at all, regardless of the other two changes.
2. **`technician_owns_job()`** — the helper gating `job_diary`, the SMS half of `communications`, `job_contacts`, `get_my_job_line_items()`, `get_my_job_applied_bundles()`, and the `diary-photos` storage bucket policies (both upload and select). All six get the extended access automatically with no policy of their own touched.
3. **`technician_has_job_for_client()`** — gates `clients_technician_select`. Extended for consistency: a technician confirmed on a job should be able to see who to call, the same as an `assigned_to` technician already can.

This is the single highest-blast-radius change in this feature. See "Testing / verification plan" for the required regression coverage.

**Dashboard/JobList show real date/time, not just a status label.** `get_my_jobs()` gains `next_scheduled_date`, `next_scheduled_start_time`, and `additional_scheduled_days` (count of other confirmed entries beyond the soonest one) — enough for a list row to say "Scheduled — 22 Sep, 8:00am (+2 more days)" without trying to cram a full multi-day calendar into a table cell. Full multi-day detail lives on the Dispatch Board itself. This computation is entry-type-agnostic (counts any confirmed entry, inspection or work) — in practice a job almost never has more than one confirmed inspection, so no special-casing is needed for the list-row summary.

**Drag-and-drop library: Atlassian `@atlaskit/pragmatic-drag-and-drop`.** Considered against `@dnd-kit/react` (the actively-maintained successor to the legacy, no-longer-React-19-supported `@dnd-kit/core`): dnd-kit/react officially supports React 18/19 and is more batteries-included, but is pre-1.0 (v0.5.x) with room for breaking API changes. Pragmatic's core has zero React-version coupling at all (framework-agnostic, vanilla JS, with thin optional React glue packages) and is proven at Jira/Trello scale on exactly this kind of dispatch-board interaction. Given this project is heading toward a professional-developer handoff, the more headless/manual API is worth it for the stability guarantee. `FullCalendar` was ruled out entirely — its resource-timeline view (staff-as-rows, the exact ServiceM8 layout) is a paid Scheduler/Premium plugin, not open source, and the client only sanctioned a drag-and-drop *library* exception, not a full calendar framework. The grid itself is built as a new custom component; there is no existing calendar-style component anywhere in this app to extend.

## Data model

```sql
create type public.schedule_entry_type as enum ('inspection', 'work');
create type public.schedule_entry_status as enum ('tentative', 'confirmed');

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  technician_id uuid not null references public.users(id),
  entry_type public.schedule_entry_type not null,
  status public.schedule_entry_status not null,
  scheduled_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.schedule_entries is 'A dispatch-calendar booking: one job, one technician, one date/time range. Multiple confirmed rows per job represent a multi-day work booking. entry_type is fixed at creation from jobs.status at that moment (Quote -> inspection, else -> work) and never changes afterward. Only entry_type=work rows ever pass through tentative status -- inspection rows are always created directly as confirmed.';
```

No `active` flag — a schedule entry is either live or removed; there is no "archived but visible" state anyone asked for. `job_id`/`technician_id`/`scheduled_date`/`start_time`/`end_time` are all freely updatable by staff after creation (repositioning a block on the grid is a plain `update`, not a special function) — only the *type/status* transitions below go through dedicated functions, because those carry side effects on `jobs` and on sibling rows.

**Three new functions**, all `security invoker` (same pattern as `create_invoice()` — a technician calling one directly hits real RLS on the underlying tables, not a silent null):

```sql
-- Inserts one schedule_entries row, deciding entry_type and initial status
-- from the job's current state. This is the single place that owns the
-- "inspection is always direct-confirm; work is tentative unless the job
-- already has a confirmed work entry" rule, so the frontend never has to
-- duplicate it.
create or replace function public.create_schedule_entry(
  target_job_id uuid,
  target_technician_id uuid,
  target_date date,
  target_start time,
  target_end time
)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  job_status public.job_status;
  has_confirmed_work boolean;
  new_entry_type public.schedule_entry_type;
  new_status public.schedule_entry_status;
  result public.schedule_entries;
begin
  select status into job_status from public.jobs where id = target_job_id;

  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    new_status := 'confirmed';
  else
    new_entry_type := 'work';
    select exists (
      select 1 from public.schedule_entries
      where job_id = target_job_id and entry_type = 'work' and status = 'confirmed'
    ) into has_confirmed_work;
    new_status := case when has_confirmed_work then 'confirmed' else 'tentative' end;
  end if;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (target_job_id, target_technician_id, new_entry_type, new_status, target_date, target_start, target_end, auth.uid())
  returning * into result;

  if new_entry_type = 'work' and new_status = 'confirmed' and job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = target_job_id;
  end if;

  return result;
end;
$$;

-- Promotes one tentative work entry to confirmed and drops every other
-- tentative entry for the same job (the "pick one, drop the rest" rule).
-- No-op guard: only applies to entry_type=work, status=tentative rows.
create or replace function public.confirm_schedule_entry(target_entry_id uuid)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_job_id uuid;
  job_status public.job_status;
  result public.schedule_entries;
begin
  update public.schedule_entries
  set status = 'confirmed'
  where id = target_entry_id and entry_type = 'work' and status = 'tentative'
  returning * into result;

  if result.id is null then
    raise exception 'schedule entry % is not a tentative work entry', target_entry_id;
  end if;

  delete from public.schedule_entries
  where job_id = result.job_id and status = 'tentative' and id != target_entry_id;

  select status into job_status from public.jobs where id = result.job_id;
  if job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = result.job_id;
  end if;

  return result;
end;
$$;

-- Deletes one entry and, if it was a job's last remaining confirmed work
-- entry, reverts jobs.status Scheduled -> Work Order.
create or replace function public.remove_schedule_entry(target_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed public.schedule_entries;
  remaining_confirmed_work boolean;
  job_status public.job_status;
begin
  delete from public.schedule_entries where id = target_entry_id returning * into removed;

  if removed.entry_type = 'work' and removed.status = 'confirmed' then
    select exists (
      select 1 from public.schedule_entries
      where job_id = removed.job_id and entry_type = 'work' and status = 'confirmed'
    ) into remaining_confirmed_work;

    if not remaining_confirmed_work then
      select status into job_status from public.jobs where id = removed.job_id;
      if job_status = 'Scheduled' then
        update public.jobs set status = 'Work Order' where id = removed.job_id;
      end if;
    end if;
  end if;
end;
$$;
```

## Access (RLS)

`schedule_entries` follows the `job_contacts`/`queues` broader-office-access shape (routine dispatch editing destroys no real history): admin `for all`; office select/insert/update/delete. Delete is required by `confirm_schedule_entry()`'s sibling-drop and by ordinary "remove this booking" actions, under the caller's own RLS (same invoker-needs-its-own-policy reasoning as `create_invoice()`).

```sql
alter table public.schedule_entries enable row level security;

create policy "schedule_entries_admin_all" on public.schedule_entries
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "schedule_entries_office_select" on public.schedule_entries
  for select
  using (public.current_app_role() = 'office');

create policy "schedule_entries_office_insert" on public.schedule_entries
  for insert
  with check (public.current_app_role() = 'office');

create policy "schedule_entries_office_update" on public.schedule_entries
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "schedule_entries_office_delete" on public.schedule_entries
  for delete
  using (public.current_app_role() = 'office');

-- Technicians: confirmed entries for themselves only. Deliberately a
-- direct check, not routed through technician_owns_job() -- that helper
-- is about to read this table itself (see below), and routing through it
-- here would be circular.
create policy "schedule_entries_technician_select" on public.schedule_entries
  for select
  using (
    public.current_app_role() = 'technician'
    and status = 'confirmed'
    and technician_id = auth.uid()
  );
```

**`technician_owns_job()`, `get_my_jobs()`, and `technician_has_job_for_client()`** (all in `001_helper_function.sql` / `004_jobs_policies.sql`) each change their `where`/`exists` clause from `assigned_to = auth.uid()` to:

```sql
assigned_to = auth.uid()
or exists (
  select 1 from public.schedule_entries
  where job_id = <job id column> and technician_id = auth.uid() and status = 'confirmed'
)
```

`get_my_jobs()` is drop/recreated (return-column change, not just `create or replace`) to add `next_scheduled_date`, `next_scheduled_start_time`, `additional_scheduled_days` — same precedent as every prior `get_my_jobs()` return-column change in this project, verified live via `pg_get_function_result` against `pg_proc`, not assumed correct from the DDL alone.

## Frontend

**New nav item** — "Schedule" link in `AppShell`, gated the same as Catalog/Bundles/Queues (`profile?.role !== 'technician'`).

**`/schedule` page (`DispatchBoard`)**: local `activeView` state for Day/Week/2-weeks/Month (same local-state-tab precedent as `JobDetail`), technician rows fetched from `users` where `role = 'technician'`, hourly columns ~6am–5pm for Day/Week/2-weeks. Month view is a simplified per-day summary list rather than an hourly grid — an hourly grid doesn't read at that zoom level, and nothing in the requirements calls for one.

**Unscheduled-jobs side list**: jobs with no entries at all, or (for Work-Order-stage jobs) no confirmed work entry yet. Each card is lightly labeled "Needs inspection" (status `Quote`) or "Needs work scheduling" (status `Work Order`, no confirmed work entry) so office can tell at a glance which flow a drag will trigger.

**Drag-and-drop** (`@atlaskit/pragmatic-drag-and-drop`): dropping an unscheduled job card onto a technician/time cell calls `create_schedule_entry()` — the frontend never decides entry_type or initial status itself, it just calls the function and renders whatever comes back. Dragging an existing block to a new cell is a plain `update` on that entry's `technician_id`/`scheduled_date`/`start_time`/`end_time`. Confirmed blocks render solid brand color; tentative blocks (always `entry_type = 'work'`) render in a lighter/striped treatment with a visible "Confirm" action that calls `confirm_schedule_entry()`.

**Dashboard/JobList**: render `next_scheduled_date`/`next_scheduled_start_time`/`additional_scheduled_days` from the (already staff-role and technician-role, via `get_my_jobs()`) job data instead of the current bare status badge, e.g. "Scheduled — 22 Sep, 8:00am (+2 more days)".

## Phasing

This ships as three separate implementation plans, each independently spec'd against this design doc, mirroring Job Billing's "tables + bundle UI" then "Apply Bundle to Job" split:

1. **Schema + RLS + functions + access-model extension.** `schedule_entries`, its RLS, the three functions, the `technician_owns_job()`/`get_my_jobs()`/`technician_has_job_for_client()` changes, full regression verification (see below), and the Dashboard/JobList date/time display (low-effort once `get_my_jobs()` returns the columns — no reason to hold it for the board UI). No drag-and-drop yet.
2. **Read-only-plus-click Dispatch Board.** The grid, view toggle, unscheduled list, and a plain click-driven "Book" form (calls `create_schedule_entry()`/`confirm_schedule_entry()`/`remove_schedule_entry()` without drag) — so office isn't blocked on the drag library while it's being wired up.
3. **Drag-and-drop.** `@atlaskit/pragmatic-drag-and-drop` wired onto Phase 2's board: drag-to-create from the unscheduled list, drag-to-reschedule existing blocks.

## Testing / verification plan

Live RLS/function verification against test accounts for all three roles, following this project's established `DO` block + `RAISE EXCEPTION` pattern (never combined with real DDL):

- admin/office: full CRUD on `schedule_entries`; technician: select only confirmed rows for themselves, zero access otherwise
- `create_schedule_entry()`: Quote-stage job produces a confirmed inspection entry with no job-status change; Work-Order-stage job with no existing confirmed work entry produces a tentative work entry; Work-Order-stage job that already has a confirmed work entry produces a *directly confirmed* second entry, without going through `confirm_schedule_entry()`
- `confirm_schedule_entry()`: confirming one tentative entry drops sibling tentative entries for the same job and flips `jobs.status` `Work Order -> Scheduled`; confirming an inspection entry (already confirmed) or a non-tentative id raises, doesn't silently succeed
- `remove_schedule_entry()`: removing a job's last confirmed work entry reverts `Scheduled -> Work Order`; removing one of several confirmed work entries does not revert status; removing a confirmed inspection entry never touches `jobs.status`
- Technician calling any of the three functions directly: rejected by underlying RLS, not a silent success

**Full regression of every `technician_owns_job()` dependent** — required explicitly, not just the new schedule-based path:
- `job_diary`, `communications` (SMS half), `job_contacts`, `get_my_job_line_items()`, `get_my_job_applied_bundles()`, `diary-photos` storage (upload + select)
- For each: (a) a technician who is only `jobs.assigned_to` (no schedule entries) still has access, exactly as before; (b) a technician with a confirmed schedule entry but who is *not* `assigned_to` now has access; (c) a technician with neither still has none
- `technician_has_job_for_client()` / `clients_technician_select`: same (a)/(b)/(c) pattern
- `get_my_jobs()`: same (a)/(b)/(c) pattern, plus confirming the new `next_scheduled_date`/`next_scheduled_start_time`/`additional_scheduled_days` columns compute correctly for a multi-day job and are `null`/zero for a job with no confirmed entries

Frontend, manually verified for all three roles once each phase lands:
- Phase 1: Dashboard/JobList show real confirmed date/time; technician sees jobs they're confirmed on via schedule entries alone, even when not `assigned_to`
- Phase 2: booking an inspection via the click form immediately confirms with no tentative UI shown at all; booking work creates a tentative block; multiple tentative candidates can coexist; confirming one removes the others from the grid; a second work day on an already-scheduled job is created confirmed directly
- Phase 3: drag-to-create and drag-to-reschedule both produce the same results as the Phase 2 click form, across a real browser (not just `curl`-equivalent checks — this app's history includes real bugs, like the Roof Report Generator's CORS/`invoke()` issues, that only ever surfaced in an actual browser)
