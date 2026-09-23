# Shadow Schedule Phase 3 (Drag-and-Drop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop to the existing `/schedule` Dispatch Board: dragging an unscheduled job card onto a grid cell opens the pre-filled Book form (drag-to-create), and dragging an existing block/chip onto a new cell applies an immediate reschedule (drag-to-reschedule). This is the final phase of the Shadow Schedule feature.

**Architecture:** `@atlaskit/pragmatic-drag-and-drop`'s core `element/adapter` wires draggable sources (`ScheduleBlock`, unscheduled cards) and drop targets (`DayGrid`/`WeekGrid` cells) via `useRef`/`useEffect`. A single dispatcher in `Schedule.jsx` (`handleDrop`) reads the dragged item's `type` and the target cell's data, then either opens the existing `BookingModal` pre-filled (create) or calls the existing `updateEntry()` action directly (reschedule) — both paths reuse Phase 2 code, nothing new is added to `scheduleActions.js` or the database.

**Tech Stack:** React 19 + Vite 8, `@atlaskit/pragmatic-drag-and-drop` (new dependency, `element/adapter` entry point only), Supabase (unchanged from Phase 2), plain CSS in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-09-23-shadow-schedule-phase3-design.md` (parents: `2026-09-16-shadow-schedule-design.md`, `2026-09-21-shadow-schedule-phase2-design.md`)

## Global Constraints

- No database, RLS, or function changes in this phase. `create_schedule_entry()`, `confirm_schedule_entry()`, `remove_schedule_entry()`, and `scheduleActions.js` are reused exactly as Phase 2 left them.
- New dependency: `@atlaskit/pragmatic-drag-and-drop`, importing only from its `element/adapter` entry point (`draggable`, `dropTargetForElements`). No other Pragmatic sub-package (autoscroll, hitbox, drop-indicator, flourish) is added.
- Drag-to-create always opens the existing `BookingModal` pre-filled (job locked, technician/date/hour from the drop) — it never calls `create_schedule_entry()` directly from a drop handler.
- Drag-to-reschedule applies immediately via a direct `updateEntry()` call — no modal, and it never changes `entry_type` or tentative/confirmed status, exactly like the existing Edit action.
- Day-view reschedule preserves the dragged entry's original duration at the new start hour. Week-view reschedule changes only `technician_id`/`scheduled_date`; `start_time`/`end_time` pass through unchanged.
- Every async drop-handling path (the reschedule `updateEntry()` call) must catch and report its own error rather than leaving a stuck UI state — standing rule for this feature, already true of every other action in Phase 2.
- No conflict detection anywhere — dropping onto an occupied cell is allowed, same as the rest of the board.
- All existing click-driven interactions (Book, Edit, Confirm, Remove, tab/view navigation) must keep working completely unchanged — drag is additive only.
- No JS test framework exists in this repo; drag-and-drop has no `curl`-equivalent check, so verification is real-browser manual testing throughout, as specified per task.
- `npm run lint` (oxlint) and `npm run build` must stay clean.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (pass as a second `-m`).

---

### Task 1: Install the drag-and-drop dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [x] **Step 1: Install**

Run: `npm install @atlaskit/pragmatic-drag-and-drop`

- [x] **Step 2: Verify it resolves**

Run: `node -e "require.resolve('@atlaskit/pragmatic-drag-and-drop/element/adapter')"`
Expected: no output, exit code 0 (the module resolves).

- [x] **Step 3: Confirm the app still builds**

Run: `npm run lint && npm run build`
Expected: both clean (adding a dependency with no code using it yet should not change either output).

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @atlaskit/pragmatic-drag-and-drop dependency" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Make `ScheduleBlock` draggable (reschedule source)

**Files:**
- Modify: `src/components/ScheduleBlock.jsx`

**Interfaces:**
- Consumes: `draggable` from `@atlaskit/pragmatic-drag-and-drop/element/adapter`.
- Produces: every rendered `ScheduleBlock` is now a native drag source whose drag data is `{ type: 'schedule-entry', entryId: string }` — consumed by Task 4's dispatcher.

- [x] **Step 1: Read the current file**

Read `src/components/ScheduleBlock.jsx` (already shown in full in the spec's investigation; unchanged since).

- [x] **Step 2: Add the draggable wiring**

Replace the full file with:

```jsx
import { useEffect, useRef } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { formatJobNumber } from '../lib/jobConstants'
import { entryTags, formatTimeRange } from '../lib/scheduleUtils'

export default function ScheduleBlock({ entry, job, variant, style, onClick }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return draggable({
      element,
      getInitialData: () => ({ type: 'schedule-entry', entryId: entry.id }),
      onDragStart: () => element.classList.add('schedule-block--dragging'),
      onDrop: () => element.classList.remove('schedule-block--dragging'),
    })
  }, [entry.id])

  const className = [
    'schedule-block',
    `schedule-block--${variant}`,
    `schedule-block--${entry.entry_type}`,
    entry.status === 'tentative' ? 'schedule-block--tentative' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const title = job ? `${formatJobNumber(job.job_number)} ${job.clientName}` : 'Unknown job'
  const meta = `${formatTimeRange(entry.start_time, entry.end_time)} · ${entryTags(entry).join(' · ')}`

  return (
    <button
      ref={ref}
      draggable
      type="button"
      className={className}
      style={style}
      data-entry-id={entry.id}
      title={`${title} — ${meta}${job?.site_address ? ` — ${job.site_address}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick(entry)
      }}
    >
      <span className="schedule-block-title">{title}</span>
      <span className="schedule-block-meta">{meta}</span>
      {job?.site_address && <span className="schedule-block-address">{job.site_address}</span>}
    </button>
  )
}
```

- [x] **Step 3: Manual browser check**

Run `npm run dev`, log in as office, open `/schedule` on a date with at least one booked block (Day view). Start dragging the block: confirm the browser shows a native drag ghost and the block dims (the `schedule-block--dragging` class is applied — visible in DevTools even before Task 6 adds its CSS opacity rule, since the class itself is already toggling). Drop it anywhere (no drop target exists yet, so nothing happens) — confirm no console error and the block returns to its normal appearance. Confirm the existing click-to-open-details behavior on the block still works.

- [x] **Step 4: Commit**

```bash
git add src/components/ScheduleBlock.jsx
git commit -m "feat: make ScheduleBlock a drag source for rescheduling" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Make unscheduled job cards draggable (create source)

**Files:**
- Modify: `src/components/UnscheduledList.jsx`

**Interfaces:**
- Consumes: `draggable` from `@atlaskit/pragmatic-drag-and-drop/element/adapter`.
- Produces: every rendered unscheduled card is now a drag source whose drag data is `{ type: 'unscheduled-job', jobId: string }` — consumed by Task 4's dispatcher. Extracts `UnscheduledCard`, an internal (non-exported) component local to this file, following the same in-file internal-component pattern already used by `src/pages/Schedule.jsx` (`ScheduleBoard`).

- [x] **Step 1: Replace the full file**

```jsx
import { useEffect, useRef, useState } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { formatJobLabel } from '../lib/jobConstants'
import { classifyUnscheduled } from '../lib/scheduleUtils'

const TYPE_FILTERS = ['All jobs', 'Needs inspection', 'Needs work scheduling']
const BADGE_LETTERS = { Quote: 'Q', 'Work Order': 'W', Scheduled: 'S' }

function UnscheduledCard({ job, info, onBook }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return draggable({
      element,
      getInitialData: () => ({ type: 'unscheduled-job', jobId: job.id }),
      onDragStart: () => element.classList.add('unscheduled-card--dragging'),
      onDrop: () => element.classList.remove('unscheduled-card--dragging'),
    })
  }, [job.id])

  return (
    <li
      ref={ref}
      draggable
      className={job.status === 'Quote' ? 'unscheduled-card unscheduled-card--quote' : 'unscheduled-card'}
      data-job-id={job.id}
    >
      <span className="unscheduled-badge-circle" aria-hidden="true">
        {BADGE_LETTERS[job.status] ?? '?'}
      </span>
      <div className="unscheduled-card-body">
        <div className="unscheduled-card-head">
          <span className="unscheduled-client">{job.clientName}</span>
          <span className="unscheduled-number">
            #{String(job.job_number).padStart(4, '0')}
          </span>
        </div>
        <div className="unscheduled-address">{job.site_address || 'No site address'}</div>
        {job.description && (
          <div className="unscheduled-description">{job.description}</div>
        )}
        <div className="unscheduled-card-foot">
          <span className="unscheduled-label">{info.label}</span>
          {info.tentativeCount > 0 && (
            <span className="unscheduled-hold-badge">
              {info.tentativeCount} tentative hold{info.tentativeCount === 1 ? '' : 's'}
            </span>
          )}
          <button type="button" className="btn-primary unscheduled-book" onClick={() => onBook(job)}>
            Book
          </button>
        </div>
      </div>
    </li>
  )
}

export default function UnscheduledList({ jobs, onBook }) {
  const [typeFilter, setTypeFilter] = useState('All jobs')
  const [filter, setFilter] = useState('')

  const q = filter.trim().toLowerCase()
  const cards = jobs
    .map((job) => ({ job, info: classifyUnscheduled(job) }))
    .filter(
      ({ job, info }) =>
        info &&
        (typeFilter === 'All jobs' || info.label === typeFilter) &&
        (!q || formatJobLabel(job).toLowerCase().includes(q))
    )
    .sort((a, b) => a.job.job_number - b.job.job_number)

  return (
    <div className="unscheduled-panel">
      <h2>Unscheduled jobs</h2>
      <div className="unscheduled-controls">
        <select
          value={typeFilter}
          aria-label="Filter by what the job needs"
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {TYPE_FILTERS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <input
          type="text"
          value={filter}
          placeholder="Job search..."
          aria-label="Search unscheduled jobs"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {cards.length === 0 ? (
        <p>Nothing to schedule.</p>
      ) : (
        <ul className="unscheduled-list">
          {cards.map(({ job, info }) => (
            <UnscheduledCard key={job.id} job={job} info={info} onBook={onBook} />
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [x] **Step 2: Manual browser check**

In the same running dev server, confirm the unscheduled panel still renders identically (filters, search, Book button all still work). Start dragging an unscheduled card: confirm a native drag ghost appears and the card dims (class toggling, pre-CSS). Drop it anywhere — no target exists yet, confirm no console error and it returns to normal.

- [x] **Step 3: Commit**

```bash
git add src/components/UnscheduledList.jsx
git commit -m "feat: make unscheduled job cards a drag source for booking" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Day-view drop targets and the drop dispatcher

**Files:**
- Modify: `src/lib/scheduleUtils.js` (export `hourToTime`, deduped from `DayGrid.jsx`'s existing local copy)
- Modify: `src/components/DayGrid.jsx`
- Modify: `src/pages/Schedule.jsx`

**Interfaces:**
- Consumes: `dropTargetForElements` from `@atlaskit/pragmatic-drag-and-drop/element/adapter`; `durationFromTimes`, `resolveTimes`, `hourToTime` from `scheduleUtils.js`; `updateEntry` from `scheduleActions.js`; the `{ type: 'schedule-entry' | 'unscheduled-job', ... }` drag data shapes from Tasks 2-3.
- Produces: `DayGrid` gains an `onDrop(sourceData, targetData)` prop, called with `targetData = { technicianId, date, hour }`. `Schedule.jsx` gains `handleDrop(sourceData, targetData)`, the single dispatcher Task 5's `WeekGrid` wiring will also call. After this task, Day-view drag-to-create and drag-to-reschedule are fully functional end-to-end.

- [x] **Step 1: Export `hourToTime` from `scheduleUtils.js`**

Read `src/lib/scheduleUtils.js`. Add this export (place it near the other time helpers, e.g. next to `formatHourLabel`):

```js
export function hourToTime(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}
```

- [x] **Step 2: Replace `DayGrid.jsx`'s local `hourToTime` and add drop-target wiring**

Replace the full file:

```jsx
import { useEffect, useRef } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { GRID_HOURS, assignLanes, blockGeometry, formatHourLabel, hourToTime } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

const LANE_HEIGHT = 62

function DayCell({ technicianId, date, hour, techName, onCellClick, onDrop }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return dropTargetForElements({
      element,
      getData: () => ({ technicianId, date, hour }),
      onDragEnter: () => element.classList.add('schedule-day-cell--drop-active'),
      onDragLeave: () => element.classList.remove('schedule-day-cell--drop-active'),
      onDrop: ({ source, self }) => {
        element.classList.remove('schedule-day-cell--drop-active')
        onDrop(source.data, self.data)
      },
    })
  }, [technicianId, date, hour, onDrop])

  return (
    <button
      ref={ref}
      type="button"
      className="schedule-day-cell"
      data-technician-id={technicianId}
      data-date={date}
      data-hour={hour}
      aria-label={`Book ${techName} at ${formatHourLabel(hour)}`}
      onClick={() => onCellClick(technicianId, date, hourToTime(hour))}
    />
  )
}

export default function DayGrid({ date, technicians, entries, jobsById, onCellClick, onBlockClick, onDrop }) {
  return (
    <div className="schedule-day">
      <div className="schedule-day-header">
        <div className="schedule-day-name">Technician</div>
        <div className="schedule-day-hours">
          {GRID_HOURS.map((hour) => (
            <div key={hour} className="schedule-day-hour-label">{formatHourLabel(hour)}</div>
          ))}
        </div>
      </div>
      {technicians.map((tech) => {
        const techEntries = entries.filter(
          (entry) => entry.technician_id === tech.id && entry.scheduled_date === date
        )
        const { placed, laneCount } = assignLanes(techEntries)
        return (
          <div key={tech.id} className="schedule-day-row">
            <div className="schedule-day-name">{tech.full_name}</div>
            <div className="schedule-day-track" style={{ minHeight: laneCount * LANE_HEIGHT }}>
              <div className="schedule-day-cells">
                {GRID_HOURS.map((hour) => (
                  <DayCell
                    key={hour}
                    technicianId={tech.id}
                    date={date}
                    hour={hour}
                    techName={tech.full_name}
                    onCellClick={onCellClick}
                    onDrop={onDrop}
                  />
                ))}
              </div>
              {placed.map(({ entry, lane }) => {
                const { leftPct, widthPct } = blockGeometry(entry.start_time, entry.end_time)
                return (
                  <ScheduleBlock
                    key={entry.id}
                    entry={entry}
                    job={jobsById[entry.job_id]}
                    variant="block"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: lane * LANE_HEIGHT + 2,
                      height: LANE_HEIGHT - 4,
                    }}
                    onClick={onBlockClick}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [x] **Step 3: Add the dispatcher to `Schedule.jsx`**

Read `src/pages/Schedule.jsx`. Update the import block at the top from:

```js
import {
  addDays,
  formatRangeLabel,
  parseBoardParams,
  startOfWeek,
  todayString,
  weekDays,
} from '../lib/scheduleUtils'
```

to:

```js
import {
  addDays,
  durationFromTimes,
  formatRangeLabel,
  hourToTime,
  parseBoardParams,
  resolveTimes,
  startOfWeek,
  todayString,
  weekDays,
} from '../lib/scheduleUtils'
import { updateEntry } from '../lib/scheduleActions'
```

Add `handleDrop` next to the other handlers (after `handleEditFromDetails`, before `handleChanged`):

```jsx
  async function handleDrop(sourceData, targetData) {
    if (sourceData?.type === 'unscheduled-job') {
      const job = jobsById[sourceData.jobId]
      if (!job) return
      setBooking({
        mode: 'book',
        job,
        initial: {
          technicianId: targetData.technicianId,
          date: targetData.date,
          startTime: targetData.hour == null ? undefined : hourToTime(targetData.hour),
        },
      })
      return
    }

    if (sourceData?.type === 'schedule-entry') {
      const entry = entries.find((candidate) => candidate.id === sourceData.entryId)
      if (!entry) return

      let start = entry.start_time.slice(0, 5)
      let end = entry.end_time.slice(0, 5)
      if (targetData.hour != null) {
        const duration = durationFromTimes(entry.start_time, entry.end_time)
        const resolved = resolveTimes(hourToTime(targetData.hour), duration)
        start = resolved.start
        end = resolved.end
      }

      const { error } = await updateEntry(entry.id, {
        technicianId: targetData.technicianId,
        date: targetData.date,
        start,
        end,
      })
      if (error) {
        setNotice(`Could not move booking: ${error.message}`)
        return
      }
      setNotice('Booking moved.')
      await reload()
    }
  }
```

Wire it onto `DayGrid` (in the `view === 'day'` branch): add `onDrop={handleDrop}` as a new prop next to `onBlockClick={setSelectedEntry}`.

- [x] **Step 4: Manual browser check — the first fully functional drag interaction**

In Day view:
- Drag an unscheduled Quote-job card onto an empty hour cell. Confirm the Book form opens with the job locked, the technician and date matching the row/column you dropped on, the start time matching the hour, and duration defaulted to 1hr. Save it — confirm it books as a **tentative** inspection candidate (not confirmed — this job has no confirmed inspection yet).
- Drag an unscheduled Work-Order-job card onto an empty hour cell on a different technician's row. Confirm the form pre-fills that technician, saves as tentative (or confirmed, if that job already has a confirmed work day).
- Drag an existing confirmed block to a different hour on the same technician's row. Confirm it updates immediately (no modal), the block moves, the duration is unchanged, and it's still there after a page reload.
- Drag an existing block to a different **technician's** row. Confirm the technician changes and it persists after reload.
- Drag a tentative block to a new cell. Confirm it is still tentative afterward (status/type untouched).
- Confirm every existing Day-view click behavior (empty-cell click opens the form, block click opens details) still works.

- [x] **Step 5: Lint and build**

Run: `npm run lint && npm run build`. Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/lib/scheduleUtils.js src/components/DayGrid.jsx src/pages/Schedule.jsx
git commit -m "feat: wire Day-view drag-to-create and drag-to-reschedule" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Week-view drop targets

**Files:**
- Modify: `src/components/WeekGrid.jsx`
- Modify: `src/pages/Schedule.jsx`

**Interfaces:**
- Consumes: `dropTargetForElements` from `@atlaskit/pragmatic-drag-and-drop/element/adapter`; `Schedule.jsx`'s `handleDrop` from Task 4 (unchanged — Week cells call the exact same dispatcher, passing `hour: null`).
- Produces: `WeekGrid` gains an `onDrop(sourceData, targetData)` prop, called with `targetData = { technicianId, date, hour: null }`.

- [x] **Step 1: Replace `WeekGrid.jsx`**

```jsx
import { Fragment, useEffect, useRef } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { compareEntries, formatDayLabel, todayString } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

function WeekCell({ technicianId, day, isToday, cellEntries, jobsById, onCellClick, onBlockClick, onDrop }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return dropTargetForElements({
      element,
      getData: () => ({ technicianId, date: day, hour: null }),
      onDragEnter: () => element.classList.add('schedule-week-cell--drop-active'),
      onDragLeave: () => element.classList.remove('schedule-week-cell--drop-active'),
      onDrop: ({ source, self }) => {
        element.classList.remove('schedule-week-cell--drop-active')
        onDrop(source.data, self.data)
      },
    })
  }, [technicianId, day, onDrop])

  return (
    <div
      ref={ref}
      className={isToday ? 'schedule-week-cell schedule-week-today' : 'schedule-week-cell'}
      tabIndex={0}
      data-technician-id={technicianId}
      data-date={day}
      aria-label={`Book at ${formatDayLabel(day)}`}
      onClick={() => onCellClick(technicianId, day, null)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onCellClick(technicianId, day, null)
      }}
    >
      {cellEntries.map((entry) => (
        <ScheduleBlock
          key={entry.id}
          entry={entry}
          job={jobsById[entry.job_id]}
          variant="chip"
          onClick={onBlockClick}
        />
      ))}
    </div>
  )
}

export default function WeekGrid({ days, technicians, entries, jobsById, onCellClick, onBlockClick, onDrop }) {
  const today = todayString()

  return (
    <div className="schedule-week">
      <div className="schedule-week-head">Technician</div>
      {days.map((day) => (
        <div
          key={day}
          className={day === today ? 'schedule-week-head schedule-week-today' : 'schedule-week-head'}
        >
          {formatDayLabel(day)}
        </div>
      ))}
      {technicians.map((tech) => (
        <Fragment key={tech.id}>
          <div className="schedule-week-name">{tech.full_name}</div>
          {days.map((day) => {
            const cellEntries = entries
              .filter((entry) => entry.technician_id === tech.id && entry.scheduled_date === day)
              .sort(compareEntries)
            return (
              <WeekCell
                key={day}
                technicianId={tech.id}
                day={day}
                isToday={day === today}
                cellEntries={cellEntries}
                jobsById={jobsById}
                onCellClick={onCellClick}
                onBlockClick={onBlockClick}
                onDrop={onDrop}
              />
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
```

- [x] **Step 2: Wire it in `Schedule.jsx`**

In the `view === 'week'` branch's `<WeekGrid .../>`, add `onDrop={handleDrop}` next to `onBlockClick={setSelectedEntry}` (same `handleDrop` from Task 4 — no changes to it needed).

- [x] **Step 3: Manual browser check**

Switch to Week view:
- Drag an unscheduled job card onto a day cell. Confirm the Book form opens with technician/date pre-filled, **no** start time pre-filled (defaults to 8:00 am), matching what a Week-view click already does.
- Drag an existing chip to a different day (same technician column... i.e. a different day for a different or the same technician). Confirm it updates immediately, the date changes, the **time is unchanged**, and it persists after reload.
- Drag a chip to a different technician's row on the same day. Confirm the technician changes and it persists.
- Confirm existing Week-view click behavior (empty-cell click, chip click, Enter-key-on-cell) still works.

- [x] **Step 4: Lint and build**

Run: `npm run lint && npm run build`. Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/components/WeekGrid.jsx src/pages/Schedule.jsx
git commit -m "feat: wire Week-view drag-to-create and drag-to-reschedule" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Visual feedback CSS

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: the `schedule-block--dragging`, `unscheduled-card--dragging`, `schedule-day-cell--drop-active`, `schedule-week-cell--drop-active` classes already being toggled (inertly, with no visible effect) by Tasks 2, 3, 4, and 5.

- [x] **Step 1: Add the CSS**

Read `src/index.css`. Add these rules directly after the existing `.schedule-block-address` rule (around line 579):

```css
.schedule-block--dragging {
  opacity: 0.4;
}

.schedule-day-cell--drop-active {
  background: rgba(250, 162, 27, 0.3);
}
```

Add this rule directly after the existing `.schedule-week-today` rule (around line 505):

```css
.schedule-week-cell--drop-active {
  background: rgba(250, 162, 27, 0.3);
}
```

Add this rule directly after the existing `.unscheduled-card:last-child` rule (around line 638, before `.unscheduled-card--quote`):

```css
.unscheduled-card--dragging {
  opacity: 0.4;
}
```

- [x] **Step 2: Manual browser check**

Reload `/schedule`. Start dragging an existing block: confirm it visibly dims. Drag it over a valid cell: confirm that cell highlights with an orange tint while hovered, and the highlight clears when you drag off it or drop. Repeat for dragging an unscheduled card over both a Day cell and a Week cell.

- [x] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add drag/drop visual feedback styles" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification, documentation, and push

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-shadow-schedule-phase3.md` (check off steps)
- Modify: `CLAUDE.md`

- [x] **Step 1: Full manual browser verification, as office (repeat key items as admin)**

Using the spec's testing checklist (`docs/superpowers/specs/2026-09-23-shadow-schedule-phase3-design.md`, "Testing / verification"), confirm every item not already covered task-by-task above:

- [x] Drag the same still-unscheduled Quote-job card (it stays in the unscheduled panel with a tentative-hold badge) onto a different cell/time: a second tentative inspection candidate is created and coexists with the first. Confirming one (via the block's existing Confirm action) drops the other tentative candidate; the job's status stays `Quote`.
- [x] Drag a block onto a cell that already has another block for that technician: both remain, no error, no dedup.
- [x] Cancel a drag by dropping outside the grid/panel entirely (e.g. onto the page background): nothing changes, no error shown.
- [x] Every existing click-driven interaction (Book, Edit, Confirm, Remove, Day/Week toggle, Prev/Next/Today, URL bookmarking) still works exactly as it did at the end of Phase 2.
- [x] Log in as **technician**: `/schedule` still shows "Staff only." — no drag surface reachable at all (no nav link, no tab).
- [x] `npm run lint` and `npm run build` are clean.

Report any failure and fix it before continuing.

- [x] **Step 2: Update `CLAUDE.md`**

Add a "Shadow Schedule — Phase 3 (Drag-and-Drop)" entry under "What's Built", directly after the Phase 2 entry, covering: `@atlaskit/pragmatic-drag-and-drop` as the new dependency (element/adapter only); drag-to-create always opens the pre-filled Book form (never an immediate `create_schedule_entry()` call) and why (duration is never determined by the drop); drag-to-reschedule applies immediately via a plain `updateEntry()` call, identical semantics to Edit, with Day-view preserving duration at the new hour and Week-view preserving the original time and only changing technician/date; that overlapping drops and cross-technician reschedule drags are both allowed by design; that this completes the Shadow Schedule feature (Phases 1-3 all done). Then replace the Client Feedback List line `6. Shadow schedule — Phases 1 and 2 done (data model/access, then the Dispatch Board), see "What's Built"; Phase 3 (drag-and-drop) not started.` with `6. Shadow schedule — done (all three phases: data model/access, the Dispatch Board, and drag-and-drop), see "What's Built".`

- [x] **Step 3: Check off this plan and commit**

```bash
sed -i 's/^- \[ \] /- [x] /' docs/superpowers/plans/2026-09-23-shadow-schedule-phase3.md
git add CLAUDE.md docs/superpowers/plans/2026-09-23-shadow-schedule-phase3.md
git commit -m "docs: record Shadow Schedule Phase 3 completion in CLAUDE.md" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [x] **Step 4: Push (only with the user's go-ahead) and report with the progress checklist**

Ask the user before pushing (a push to `main` auto-deploys to Vercel). When pushed, end the message with the running checklist covering all 3 phases (Phase 1 done, Phase 2 done, Phase 3 done), per the user's standing instruction — this closes out the whole Shadow Schedule feature.
