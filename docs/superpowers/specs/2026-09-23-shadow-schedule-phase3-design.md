# Shadow Schedule Phase 3 (Drag-and-Drop) - Design Spec

**Date:** 2026-09-23
**Status:** Approved
**Parent designs:** `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md` (Phase 1, data model/access), `docs/superpowers/specs/2026-09-21-shadow-schedule-phase2-design.md` (Phase 2, click-driven Dispatch Board). This is Phase 3 of 3 — the last phase in the Shadow Schedule arc.

## Background

Phase 1 shipped the data model and access model. Phase 2 shipped the staff-only `/schedule` Dispatch Board: Day/Week grids, an unscheduled-jobs panel, and a fully click-driven Book / Confirm / Edit / Remove flow, deliberately built drag-ready (every cell and card already carries the data attributes a drag library needs — `data-technician-id`/`data-date`/`data-hour` on grid cells, `data-job-id` on unscheduled cards) without adding the drag dependency itself. Phase 3 adds `@atlaskit/pragmatic-drag-and-drop` on top of that board. No schema or RLS changes in this phase — it is a frontend-only integration on top of Phase 2's existing `create_schedule_entry()` / `confirm_schedule_entry()` / `remove_schedule_entry()` functions and `scheduleActions.js` helpers.

Two distinct drag interactions, investigated and confirmed with the project owner 2026-09-23:
1. **Drag-to-create**: an unscheduled-panel job card dropped onto a grid cell.
2. **Drag-to-reschedule**: an existing block/chip dragged to a different cell.

## Scope

In scope:
- `@atlaskit/pragmatic-drag-and-drop` added as a new dependency (already sanctioned in the Phase 1 investigation; this is the first use of the library in the project)
- Drag-to-create from `UnscheduledList` onto a `DayGrid` hour-cell or a `WeekGrid` day-cell
- Drag-to-reschedule an existing `ScheduleBlock` (Day view) or chip (Week view) onto a different technician/date(/hour) cell, including a different technician's row
- Minimal drag visual feedback (dragged-element and valid-drop-target CSS classes) via Pragmatic's own callbacks
- Dropping onto a cell that already holds another block/chip (same technician) is allowed — matches the existing no-conflict-detection design everywhere else on the board

Out of scope (not part of this phase):
- Any new database object, RLS change, or change to `create_schedule_entry()`/`confirm_schedule_entry()`/`remove_schedule_entry()` — all reused exactly as Phase 2 left them
- Pragmatic's optional packages (autoscroll, hitbox, drop-indicator components, flourish) — the grid is small enough not to need them; only the core `element/adapter` is used
- Touch-specific drag affordances beyond whatever Pragmatic's core adapter provides by default — this is a desktop-first office tool, same as the rest of the board (per Phase 2)
- An "Undo" affordance for a mis-dropped reschedule — a mis-drop is corrected by dragging again or using the existing Edit form; not destructive, so no extra safety net is added
- 2-weeks/Month views, conflict detection, recurring bookings, technician-facing drag — all still out of scope per Phase 1/2, unchanged here

## Decisions

**Drag-to-create always opens the Book form, pre-filled — never an immediate create.** The deciding factor is duration: a drop gives exact technician + date (+ hour, in Day view) but never duration, which the Book form defaults by job status (1hr for Quote/Completed, 8hr for Work Order/Scheduled) the same way a click-to-book already does. That default is sometimes wrong, and the click flow's existing review-before-save step is what catches it; skipping it on drop would trade a cheap pre-save adjustment for a Remove-and-redo. Concretely, dropping an unscheduled job card onto a cell calls:

```js
setBooking({
  mode: 'book',
  job: draggedJob,
  initial: { technicianId, date, startTime }, // startTime omitted (undefined) for a Week-view drop
})
```

This is not new logic — it is `Schedule.jsx`'s existing `handleCellClick` (which supplies `technicianId`/`date`/`startTime` from a click) and `handleBookJob` (which supplies and locks `job`) combined into one call. Day and Week need no special-casing beyond this: Week already omits `startTime` for a click-opened form (defaults to 8:00 am inside `BookingModal`), so a Week-view drop behaves identically to a Week-view click, just with the job pre-selected instead of picked via `JobPicker`.

**Drag-to-reschedule applies immediately — no modal.** Unlike create, a reschedule drop leaves no field ambiguous: the target cell fully determines the new technician + date (+ hour, Day view), and duration/time-of-day carries over unchanged from the dragged entry. There is nothing to review, so it commits directly via the same `updateEntry()` call `BookingModal`'s own edit-save path already uses — matching the existing rule that reschedule "behaves exactly like Edit, a plain update that never touches `entry_type` or tentative/confirmed status." This is also consistent with Edit itself having no confirm step today (only Remove does, because Remove is the one destructive action in this feature; a mis-dropped reschedule is not destructive — drag again, or fix it via Edit).

- **Day-view drop**: new `start_time` = the dropped hour; new `end_time` = `resolveTimes(newStart, durationFromTimes(entry.start_time, entry.end_time)).end` — both helpers already exist in `scheduleUtils.js`, so this preserves the entry's original duration at its new start time.
- **Week-view drop**: only `technician_id`/`scheduled_date` change; `start_time`/`end_time` are passed through unchanged, since a Week cell carries no hour.
- Dragging a block into a **different technician's row** is in scope and behaves the same as changing the Technician field in the Edit form.
- After a successful reschedule: `reload()` the board and show the same kind of status-line notice Phase 2 already uses for Book/Edit/Confirm/Remove (e.g. "Booking moved."). On failure (RLS rejection, the entry having been changed/removed by someone else since the drag started), show that error the same way and reload — no stuck UI, matching this feature's standing no-stuck-spinners rule.

**Integration approach.** `@atlaskit/pragmatic-drag-and-drop`'s core `element/adapter` (`draggable`, `dropTargetForElements`) is vanilla JS with no React-version coupling — each wiring is a `useEffect` on a DOM ref that calls the adapter function and returns its cleanup function.

- **Draggable sources**: `ScheduleBlock` (both `variant="block"` and `variant="chip"` — existing entries, for reschedule) and each unscheduled-panel `<li data-job-id>` in `UnscheduledList` (for create). Each attaches `getInitialData()` describing itself, e.g. `{ type: 'schedule-entry', entryId }` or `{ type: 'unscheduled-job', jobId }`.
- **Drop targets**: `DayGrid`'s per-hour cell buttons and `WeekGrid`'s per-day cells — the same elements that already handle `onCellClick`, reusing their existing `data-technician-id`/`data-date`/`data-hour` attributes to build `getData()`.
- **One dispatcher** in `Schedule.jsx`, reading the dropped item's `type` from Pragmatic's `onDrop` payload and the target cell's data attributes, branching to either the `setBooking(...)` call (create) or the `updateEntry(...)` call (reschedule) described above.
- **Visual feedback**: a CSS class toggled on the dragged element via `onDragStart`/`onDrop`, and a "valid drop target" highlight class toggled on a drop target via `onDragEnter`/`onDragLeave` — both are Pragmatic core callbacks, no additional package.
- Dropping outside any registered drop target is a no-op by the library's own default behavior (nothing moves, nothing is called) — no extra handling needed.

This keeps nearly all of the new code to the Pragmatic wiring itself and the Day-view duration-preserving reschedule calculation; the create path and the reschedule update call are both direct reuses of functions Phase 2 already shipped.

## Frontend structure

- **New dependency**: `@atlaskit/pragmatic-drag-and-drop` (`element/adapter` entry point only).
- `src/components/DayGrid.jsx`, `src/components/WeekGrid.jsx` — cell elements gain `draggable`/drop-target wiring via a `useEffect` + ref; no change to existing props/click handlers, which stay as the click fallback.
- `src/components/ScheduleBlock.jsx` — gains draggable wiring; no change to its existing click behavior (opens `BlockDetailsModal`, unchanged).
- `src/components/UnscheduledList.jsx` — each card gains draggable wiring; the existing "Book" button stays as the click fallback.
- `src/pages/Schedule.jsx` — gains the drop dispatcher (create vs. reschedule) and the reschedule-specific `updateEntry()` call + notice/reload handling.
- `src/lib/scheduleUtils.js` — no new exports expected; reschedule reuses `resolveTimes`/`durationFromTimes`, both already present.
- `src/lib/scheduleActions.js` — no changes; `updateEntry()` is reused exactly as-is.
- **Click behavior for every existing interaction is fully preserved** — drag is additive, not a replacement. A office/admin user who never drags anything sees no behavior change at all.

## Errors and edge cases

- A reschedule drop's `updateEntry()` call follows the same standing rule as every other async path in this feature: it catches its own errors and reports them (returns `{ error }`), shown via the same inline/notice mechanism Phase 2 already uses — no unhandled rejection, no stuck state.
- Dropping a block onto a cell that already holds another block/chip is allowed (matches the no-conflict-detection design elsewhere on the board) — no dedup or warning.
- Dropping an entry onto the *same* cell it already occupies is a harmless no-op update (same values written back) — not specifically special-cased, since `updateEntry()` with unchanged values is not an error.
- If the dragged entry was removed or changed by someone else between drag-start and drop (no live sync between staff, same as the rest of the app), `updateEntry()`'s error is shown and the board reloads to the real current state — same pattern Phase 2 already uses for a stale Confirm/Remove.
- Technicians have no drag surface at all — the board is not rendered for them at all (unchanged staff-only gate from Phase 2), so this needs no separate technician-specific handling.

## Testing / verification

No database changes in this phase, so no `DO` block verification is needed. Drag-and-drop is inherently a real-browser-only interaction (there is no `curl`-equivalent check, the same lesson this project already learned the hard way with the Roof Report Generator's CORS/`invoke()` issues), so verification is entirely a real browser pass, as **office** (repeat key items as **admin**):

- Drag an unscheduled Quote-job card onto a Day-view cell: the Book form opens with the job locked, technician/date/hour pre-filled from the drop, duration defaulted to 1hr; saving books a confirmed inspection.
- Drag an unscheduled Work-Order-job card onto a Day-view cell: form opens the same way, duration defaulted to 8hr; saving books a tentative hold (or confirmed, if the job already has a confirmed work day).
- Drag the same card onto a Week-view cell: form opens with technician/date pre-filled, no hour pre-filled (defaults 8:00 am), matching a Week-view click.
- Drag an existing confirmed Day-view block to a different hour on the same technician's row: updates immediately, no modal, duration is preserved at the new time, persists after reload.
- Drag an existing block to a **different technician's row**: technician changes, persists after reload.
- Drag an existing Week-view chip to a different day: date changes, start/end time unchanged, persists after reload.
- Drag a block onto a cell that already has another block for that technician: both remain, no error, no dedup.
- Drag a tentative block: after reschedule it is still tentative (status/type unchanged); drag a confirmed block: still confirmed afterward.
- Cancel a drag by dropping outside the grid/panel: nothing changes, no error shown.
- Every existing click-driven interaction from Phase 2 (Book, Edit, Confirm, Remove, tab navigation) still works unchanged.
- Technician: `/schedule` still shows "Staff only." — no drag surface reachable at all.
- `npm run lint` and `npm run build` stay clean.

## Phasing note

This is Phase 3 of 3 — completes the Shadow Schedule feature (item 6 on the client's post-pilot feedback list) end to end. No further phases are planned; any future change (e.g. moving toward the full ServiceM8 hourly look at every zoom level, per the Phase 1 design-intent note in `CLAUDE.md`) would be a new, separately-scoped piece of work.
