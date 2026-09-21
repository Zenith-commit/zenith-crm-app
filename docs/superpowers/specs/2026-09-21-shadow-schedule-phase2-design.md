# Shadow Schedule Phase 2 (Dispatch Board) - Design Spec

**Date:** 2026-09-21
**Status:** Approved
**Parent design:** `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md` (Phase 1 shipped; this is Phase 2 of 3)

## Background

Phase 1 shipped the `schedule_entries` table, its RLS, `create_schedule_entry()` / `confirm_schedule_entry()` / `remove_schedule_entry()`, the technician access-model extension, and a "Scheduled" column on the Jobs list. Phase 2 adds the staff-facing Dispatch Board: a click-driven calendar for booking, confirming, editing and removing schedule entries. No drag-and-drop (Phase 3).

**Design-intent note for the eventual developer:** the client's ideal long-term look is the full ServiceM8-style hourly grid at every zoom level (Day, Week, 2-weeks, Month). This phase deliberately ships a simpler version - Day = hourly grid, Week = one column per day with stacked time-labelled chips, and only Day + Week views. That is a "build now, refine later" choice made with the developer handoff in mind, not a final decision on how the board should ultimately look. The unscheduled-jobs panel follows the client's ServiceM8 screenshot (`docs/staff schedule reference.png`), see "Unscheduled panel" below.

## Scope

In scope:
- New staff-only `/schedule` page (`DispatchBoard`) with Day and Week views
- Unscheduled-jobs side panel with a text filter and a Book button per job
- Shared Book form in a Modal, opened from three places: an empty grid cell, an unscheduled-panel card, and a new staff-only JobDetail "Schedule" tab
- Block details Modal with Confirm / Edit / Remove
- One live database change: `create_schedule_entry()` gains an explicit Completed branch
- View and date held in the URL (`/schedule?view=week&date=2026-09-21`)

Out of scope (deferred, not scheduled):
- 2-weeks and Month views
- Drag-and-drop (Phase 3, `@atlaskit/pragmatic-drag-and-drop`)
- The full ServiceM8 hourly look at every zoom level (long-term ideal, see note above)
- Conflict detection / double-booking prevention (overlaps are allowed by design)
- Warranty job category (parked backlog item; a Completed-job return visit is supported via the Schedule tab, but there is no dedicated category)
- A technician-facing calendar (technicians keep Dashboard/JobList)
- Recurring bookings; live sync between staff; notifying a technician when booked; print/export
- Changing a booking's job or entry type through Edit
- Putting open modals in the URL

## Decisions

**Views.** Day + Week only. Weeks start Monday. The page opens on the current week.

**Day view.** One row per technician, 12 hourly columns (6:00 am - 6:00 pm). Blocks are positioned by start/end time. Overlapping blocks are allowed and split the row into stacked sub-lanes (the row grows taller); nothing is hidden or blocked. A booking that falls outside 6 am - 6 pm is still shown, pinned to the grid edge and labelled with its real times.

**Week view.** Monday-Sunday columns, one row per technician. Each cell lists that day's bookings as chips sorted by start time, e.g. `8:00am-4:00pm - #0012 Smith`. Overlapping chips simply stack. Chips are not positioned by hour.

**Look.** Confirmed work = solid navy. Confirmed inspection = solid orange. Tentative hold = the same colour, lighter, dashed border. Every block also carries a text tag ("Inspection", "Tentative") so nothing depends on colour alone. Each block also shows the job's site address on a third line (truncated), matching the ServiceM8 reference, which shows the suburb. Zenith stores only a free-text `site_address` (no separate suburb field), and parsing a suburb out of free text would be unreliable, so the whole address is shown; the full text is in the block's tooltip.

**Technician rows.** Every `users` row with `role = 'technician'` (same query `JobForm` already uses; `users` has no active flag; office can already read all users).

**URL state.** `/schedule?view=day|week&date=YYYY-MM-DD`. Prev / Next / Today / the toggle create history entries so browser back/forward work. Week view always shows the Monday-Sunday week containing `date`. A missing or invalid `view`/`date` falls back to week / the current local date. Modals are not in the URL.

**Unscheduled panel.** Jobs shown, computed in the browser from the jobs list plus each job's entries:
- `Quote` with no confirmed inspection: labelled "Needs inspection"
- `Work Order` with no confirmed work entry: labelled "Needs work scheduling"; if it has tentative holds it stays in the list with a badge (e.g. "2 tentative holds")
- `Scheduled` with no confirmed work entry: also labelled "Needs work scheduling". Jobs moved to Scheduled by hand before Phase 1 existed have no schedule entries, and without this they would appear nowhere on the board.
- Not shown: `Scheduled` with at least one confirmed work day (add days from the grid or the Schedule tab) and `Completed` (nothing left to book, but bookable via its Schedule tab)
- A `Quote` job with a confirmed inspection drops off, and reappears as "Needs work scheduling" once moved to `Work Order`
- Layout follows the client's ServiceM8 reference screenshot (`docs/staff schedule reference.png`, the "Jobs" side panel): a dropdown (All jobs / Needs inspection / Needs work scheduling) and a search box on top; each card has a round letter badge (Q for Quote in orange, W for Work Order in navy, S for a hand-Scheduled job in navy), a coloured line down its left edge, the client name in bold with the job number right-aligned and muted, the site address, a muted one-line job description, the label, any tentative-hold badge, and a Book button. Zenith's navy/orange palette replaces ServiceM8's blue.
- The reference also shows a "Lead source" line per card. Zenith has no lead-source field anywhere, so the job description fills that line (owner's decision, 2026-09-21). A lead-source field is a separate backlog item, not part of this phase.

**Book form** (existing `Modal`; closes on x, Escape or backdrop click):
- Job: read-only when opened from an unscheduled card or the Schedule tab. From a grid-cell click it is a searchable picker (job number, client, address) over ALL jobs, unscheduled first, Completed labelled, so a second day on a Scheduled job or a return visit on a Completed job can be booked.
- Technician: dropdown, pre-filled from the clicked row. Date: date field, pre-filled.
- Start time: dropdown, 15-minute steps, 5:00 am - 9:00 pm (wider than the grid). Pre-filled from the clicked hour in Day view, otherwise 8:00 am.
- Duration: dropdown - 15 min, 30 min, 45 min, 1 hr, 1.5 hr, 2 hr, then hourly to 10 hr, then All day. All day sets the start to 6:00 am and locks the start field (spans the full 6 am - 6 pm grid, not a literal 12 hours from any start). Any duration that would run past midnight is disabled. A line shows the computed end ("Ends 4:00 pm"). The database still stores `start_time` and `end_time`; no schema change.
- Default duration: 1 hr for a Quote or Completed job; 8 hr for a Work Order or Scheduled job.
- No "will be tentative/confirmed" preview. The database function owns that rule; after saving, the board shows the real result from the returned row ("Booked as a confirmed inspection", "Booked as a tentative hold", "Booked and confirmed. The job is now Scheduled.").
- Edit mode: same form, job read-only; technician, date, start and duration are editable; saved as a plain update (entry type and status never change). A stored booking that matches no preset shows "Custom (2h 20m)" and is kept until another value is picked.
- Save button disabled while saving; database errors shown inline with the form left open; on success the Modal closes and the board reloads.

**Block details Modal.** Shows Job # / client / site address (with an "Open job" link), technician, date, time and status.
- Tentative work block: Confirm, Edit, Remove. Confirm first warns "Confirming this drops the other N tentative holds for this job."
- Confirmed block: Edit, Remove.
- Remove ALWAYS shows a basic "Are you sure?" confirmation. The extra warning ("This job goes back from Scheduled to Work Order") layers on top only when the entry is the job's last confirmed work day.

**JobDetail "Schedule" tab.** Staff-only (not rendered for technicians, same `isStaff` gate as Invoicing / Roof Report). Lists only this job's entries sorted by date/start: date, time range, technician, Inspection/Work tag, Confirmed/Tentative tag, plus the same Confirm / Edit / Remove actions. A Book button at the top opens the shared Book form with the job read-only and the date defaulting to today. Empty state: "No bookings yet". Works on Completed jobs (a booking there is a directly-confirmed return visit and the status stays Completed). After any change the tab notifies `JobDetail` to reload the job so the status shown on the Details tab is never stale.

**Shared behaviour.** Confirm / Edit / Remove logic and the confirmation dialog live in one shared hook/component used by both the board's block Modal and the Schedule tab, so they cannot drift apart.

**Technician access.** No Schedule nav link, no tab. A technician who opens `/schedule` directly sees a "Staff only" message instead of the board (a small step beyond the app's usual "no route guard" convention, because the alternative is a board with a Book button that RLS would reject).

## Database change (the only one)

`create_schedule_entry()` is replaced (`create or replace`, same signature) so Completed is handled explicitly. Rule after the change:
- `Quote` -> `inspection`, `confirmed`
- `Completed` -> `work`, `confirmed`; `jobs.status` is left as `Completed`
- `Work Order` / `Scheduled` -> `work`; `tentative` unless the job already has a confirmed work entry, in which case `confirmed`. A directly-confirmed entry on a `Work Order` job advances it to `Scheduled` (unchanged behaviour).

```sql
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
  elsif job_status = 'Completed' then
    new_entry_type := 'work';
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
```

Nothing else in the database changes: edit is a plain update (admin and office already have update on `schedule_entries`); Confirm and Remove use the existing functions; technicians still cannot see tentative entries. Recorded in a new migration file. The Phase 1 design spec and the function's comment are updated to describe the Completed rule.

## Frontend structure

- `src/pages/Schedule.jsx` - the board page; reads/writes `view` and `date` in the URL; staff-only guard.
- `src/lib/scheduleUtils.js` - local-date arithmetic (never `toISOString()`, which converts to UTC and shows the wrong day in Australia in the morning), Monday-start week ranges, duration presets and end-time math, overlap lane assignment, time/date formatters, unscheduled-job classification.
- `src/hooks/useSchedule.js` - entries for the visible range (job number, site address, client name and technician name embedded) plus the technician list; `useJobSchedule(jobId)` for the tab; a shared actions hook for confirm / edit / remove / book.
- Components: `DayGrid`, `WeekGrid`, a block/chip component, `UnscheduledList`, `BookingModal` (form), `BlockDetailsModal`, a job picker, and the `JobDetail` Schedule tab component. Nav link in `AppShell` next to Queues; route in `App.jsx`.
- Every cell and card carries plain data attributes so Phase 3's drag can attach to the same elements without restructuring.
- No new dependency in this phase.

## Errors and edge cases

- Every save / confirm / remove / load path catches its own errors and reports them (returns `{ error }`), so a failure shows a message instead of a stuck "Saving..." state. This is a standing rule for this feature, because that exact pattern has already caused three real bugs in this project.
- Form errors show inline; a failed board load shows a banner with a Retry button.
- Confirm on an entry someone else already changed gets the function's own error ("not a tentative work entry") and the board reloads. Removing something already gone is a harmless no-op followed by a reload.
- No live sync between staff (same as the rest of the app). The board reloads after your own actions and when the view or date changes.
- Loading, error and empty states (no technicians, nothing scheduled) on the board and the tab.
- Desktop-first office tool; on a narrow window the grid scrolls horizontally.

## Testing / verification

No JS test framework exists in this repo. Verification follows the project's established pattern:
- Database: live `DO` block + `RAISE EXCEPTION` verification of the `create_schedule_entry()` change, always as its own SQL Editor submission separate from the DDL: Quote unchanged (confirmed inspection, no status change), Completed (confirmed work, status stays Completed), Work Order unchanged (tentative first, directly confirmed once a confirmed work day exists, advances to Scheduled), technician rejected.
- Real browser, as admin, office and technician (curl-style checks cannot catch browser-only bugs, as the Roof Report work showed):
  - A job set to Scheduled by hand with NO schedule entries (a state only this app's history can produce, since the new UI never creates it; set it up via the SQL Editor or by changing a job's status) appears in the unscheduled panel as "Needs work scheduling", and booking it confirms directly or tentatively per the function's rule
  - Inspection booking is confirmed with no tentative UI
  - Work booking is tentative; several tentative holds can coexist
  - Confirming one drops the rest and the job becomes Scheduled
  - A second work day is confirmed directly
  - A Completed return visit is confirmed and the job stays Completed
  - Removing the last confirmed work day returns the job to Work Order
  - Remove always asks for confirmation
  - Edit persists after reload
  - Overlapping blocks split into lanes; an out-of-range block is pinned and labelled
  - URL bookmark and back/forward work; a bad URL falls back to the current week
  - All day locks the start to 6 am; durations that would pass midnight are disabled
  - The Jobs list's Scheduled column and a technician's job list update after changes
  - Technicians have no nav link, no tab and no board
- `npm run lint` and `npm run build` stay clean.

## Phasing note

This is Phase 2 of 3. Phase 3 adds `@atlaskit/pragmatic-drag-and-drop` on top of this board: drag from the unscheduled panel to create, drag a block to reschedule, both pre-filling the same Book form fields / performing the same plain update as this phase's click flows.
