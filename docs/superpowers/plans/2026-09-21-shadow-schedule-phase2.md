# Shadow Schedule Phase 2 (Dispatch Board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the staff-only `/schedule` Dispatch Board (Day + Week views, unscheduled-jobs panel, click-driven Book / Confirm / Edit / Remove) and a matching JobDetail "Schedule" tab, plus one live database change: `create_schedule_entry()` handles Completed jobs explicitly. No drag-and-drop (Phase 3).

**Architecture:** One shared data layer (`useScheduleBoard`, `useJobSchedule`, `useTechnicians`, and `scheduleActions.js`, which wraps the three Phase 1 SQL functions plus a plain update), one shared `BookingModal` and one shared `ScheduleEntryActions` component reused by all three entry points (grid cell, unscheduled card, JobDetail tab). All pure logic (dates, durations, lanes, classification, messages) lives in one dependency-free module, `src/lib/scheduleUtils.js`, so it can be checked with plain `node`. The frontend never decides entry type or tentative/confirmed status; it calls `create_schedule_entry()` and shows what comes back.

**Tech Stack:** React 19 + Vite 8, react-router-dom 7 (`useSearchParams`), Supabase (Postgres RLS + SQL functions), plain CSS in `src/index.css`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-21-shadow-schedule-phase2-design.md` (parent: `2026-09-16-shadow-schedule-design.md`)

## Global Constraints

- The engineer has no Supabase CLI or service-role access. Every SQL file is run by the human in the Supabase Dashboard SQL Editor, not by the agent.
- **Never put real DDL (`create or replace function`, etc.) and a `DO $$ ... raise exception $$` verification block in the same SQL Editor submission.** Always three separate submissions: DDL, then a plain `select` sanity check, then the `DO` block.
- A raw SQL Editor session has no JWT claims. Every impersonation check wraps its statements in `begin; set local role authenticated; set local request.jwt.claims to '{"sub": "<uuid>"}'; ... rollback;`.
- Views: Day and Week only (2-weeks and Month are deferred). Weeks start on Monday.
- Day grid shows 6:00 am - 6:00 pm, one column per hour. A booking outside that range is still shown, pinned to the grid edge and labelled with its real times. Overlaps are allowed; overlapping Day blocks split the row into stacked sub-lanes.
- Week view is one column per day (Mon-Sun) with stacked chips; chips are not positioned by hour. The full ServiceM8 hourly look at every zoom level is the client's long-term ideal (see `CLAUDE.md`); this simpler layout is deliberate "build now, refine later", not the intended end-state.
- Colours: confirmed work = solid navy, confirmed inspection = solid orange, tentative = the same hue, lighter, dashed border. Every block also carries a text tag ("Work" / "Inspection", plus "Tentative").
- Start-time choices: 15-minute steps, 5:00 am - 9:00 pm. Duration choices: 15 min, 30 min, 45 min, 1 hr, 1.5 hr, 2 hr, then hourly up to 10 hr, then "All day". "All day" = 06:00 - 18:00 and locks the start field to 6:00 am. A duration that would run past midnight is disabled.
- Default duration: 1 hr for a Quote or Completed job; 8 hr for a Work Order or Scheduled job. Default start: 8:00 am.
- The database still stores `start_time` and `end_time`; there is no duration column and no schema change.
- **Never use `toISOString()` (or any UTC conversion) for dates.** `scheduled_date` is a plain date; build "today", weeks and ranges with local date arithmetic (`toDateString` in `scheduleUtils.js`), or staff in Australia will see the wrong day in the morning.
- **No stuck spinners:** every async save / confirm / remove / load path catches its own errors and returns/reports them. Never let a rejection escape into an unhandled promise (this exact bug has hit this project three times).
- The frontend never decides `entry_type` or initial `status`. Booking always goes through `create_schedule_entry()`; Confirm through `confirm_schedule_entry()`; Remove through `remove_schedule_entry()`. Edit is a plain `update` of technician / date / start / end only; `entry_type` and `status` never change on edit.
- Remove ALWAYS asks "are you sure"; the extra "job returns to Work Order" line is added only when it applies. Confirm warns about dropped tentative siblings when there are any. Use `window.confirm`, matching `QueueList.jsx`'s existing convention.
- After booking / confirming / removing, the message shown comes from the real result: the returned row for a booking, and the job's status re-read from the database before vs. after, so a status change is reported only if it actually happened.
- `/schedule` is staff-only: a technician who opens it sees a "Staff only." message. The Schedule nav link and JobDetail Schedule tab are not rendered for technicians (same `isStaff` gate as Invoicing / Roof Report).
- Do not touch `jobs.assigned_to`, `confirm_schedule_entry()`, `remove_schedule_entry()`, the RLS policies, or any bundle / invoice / roof-report code. The only database object that changes is `create_schedule_entry()`.
- No new npm dependency. Lint is `npm run lint` (oxlint); build is `npm run build`. Both must stay clean.
- There is no JS test framework in this repo. Pure logic is checked with a throwaway `node` script (never committed); UI is verified manually in a real browser, as all three roles.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (pass it as a second `-m`).

---

### Task 1: `create_schedule_entry()` handles Completed jobs

**Files:**
- Modify: `supabase/policies/023_schedule_entry_functions.sql` (fresh-install source of truth)
- Create: `supabase/migrations/2026-09-21_create_schedule_entry_completed.sql` (the exact statement run against the live database)
- Modify: `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md` (amendment note)

**Interfaces:**
- Produces: `public.create_schedule_entry(uuid, uuid, date, time, time) returns public.schedule_entries` (same signature as Phase 1). New rule: `Quote` -> inspection, confirmed; `Completed` -> work, confirmed, `jobs.status` untouched; `Work Order` / `Scheduled` -> work, tentative unless the job already has a confirmed work entry (then confirmed; a directly-confirmed entry on a `Work Order` job advances it to `Scheduled`). Consumed by `scheduleActions.bookEntry` (Task 3).

- [x] **Step 1: Update the fresh-install file**

Read `supabase/policies/023_schedule_entry_functions.sql`. In `create_schedule_entry()`, replace this block:

```sql
  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    new_status := 'confirmed';
  else
    new_entry_type := 'work';
```

with:

```sql
  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    new_status := 'confirmed';
  elsif job_status = 'Completed' then
    new_entry_type := 'work';
    new_status := 'confirmed';
  else
    new_entry_type := 'work';
```

Then replace that function's `comment on function public.create_schedule_entry(...)` statement with:

```sql
comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs always get a directly-confirmed inspection entry. Completed jobs (e.g. a warranty return visit) get a directly-confirmed work entry and their status is left as Completed. Work-Order/Scheduled-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';
```

- [x] **Step 2: Write the migration file**

Create `supabase/migrations/2026-09-21_create_schedule_entry_completed.sql`:

```sql
-- 2026-09-21_create_schedule_entry_completed.sql
-- Adds an explicit Completed branch to create_schedule_entry(): a booking on a
-- Completed job (a warranty / return visit) is a directly-confirmed work entry
-- and never changes jobs.status. Same signature as before, so
-- create or replace is safe to run as-is.

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

comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs always get a directly-confirmed inspection entry. Completed jobs (e.g. a warranty return visit) get a directly-confirmed work entry and their status is left as Completed. Work-Order/Scheduled-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';
```

- [x] **Step 3: Run the migration against the live database (submission 1 of 3)**

Ask the user to paste the whole contents of `supabase/migrations/2026-09-21_create_schedule_entry_completed.sql` into the Supabase SQL Editor as its own submission and confirm "Success".

- [x] **Step 4: Confirm it is really live (submission 2 of 3)**

Ask the user to run this plain query as its own submission and paste the result:

```sql
select prosrc like '%job_status = ''Completed''%' as has_completed_branch
from pg_proc
where proname = 'create_schedule_entry';
```

Expected: one row, `has_completed_branch = true`. Do not continue if it is `false` or there is no row.

- [x] **Step 5: Run the verification block (submission 3 of 3)**

Get `<OFFICE_ID>` and `<TECH_ID>` (the ids of the office and technician test accounts; `select id, role from public.users;` if not already known), substitute them, and ask the user to run this whole block as its own submission (it rolls back, leaving nothing behind):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_client uuid := '99999999-9999-9999-9999-999999999a01';
  v_quote_job uuid := '99999999-9999-9999-9999-999999999a11';
  v_wo_job uuid := '99999999-9999-9999-9999-999999999a12';
  v_completed_job uuid := '99999999-9999-9999-9999-999999999a13';
  v_scheduled_job uuid := '99999999-9999-9999-9999-999999999a14';
  v_entry public.schedule_entries;
begin
  insert into public.clients (id, name) values (v_client, 'Completed Branch Test Client');
  insert into public.jobs (id, client_id, status) values
    (v_quote_job, v_client, 'Quote'),
    (v_wo_job, v_client, 'Work Order'),
    (v_completed_job, v_client, 'Completed'),
    (v_scheduled_job, v_client, 'Scheduled');

  -- Quote: unchanged behaviour (confirmed inspection, no status change).
  select * into v_entry from public.create_schedule_entry(v_quote_job, '<TECH_ID>', '2026-10-10', '09:00', '10:00');
  if v_entry.entry_type <> 'inspection' or v_entry.status <> 'confirmed' then
    raise exception 'Quote: expected confirmed inspection, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_quote_job) <> 'Quote' then
    raise exception 'Quote: jobs.status must not change';
  end if;

  -- Completed with no prior entries: directly confirmed work, status untouched.
  select * into v_entry from public.create_schedule_entry(v_completed_job, '<TECH_ID>', '2026-10-11', '09:00', '10:00');
  if v_entry.entry_type <> 'work' or v_entry.status <> 'confirmed' then
    raise exception 'Completed: expected confirmed work, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_completed_job) <> 'Completed' then
    raise exception 'Completed: jobs.status must stay Completed';
  end if;

  -- Work Order: unchanged behaviour (tentative first, status untouched).
  select * into v_entry from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-12', '08:00', '16:00');
  if v_entry.entry_type <> 'work' or v_entry.status <> 'tentative' then
    raise exception 'Work Order: expected tentative work, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_wo_job) <> 'Work Order' then
    raise exception 'Work Order: a tentative entry must not change jobs.status';
  end if;

  -- Work Order that already has a confirmed work day: directly confirmed, advances to Scheduled.
  update public.schedule_entries set status = 'confirmed' where id = v_entry.id;
  select * into v_entry from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-13', '08:00', '16:00');
  if v_entry.status <> 'confirmed' then
    raise exception 'Work Order second day: expected confirmed, got %', v_entry.status;
  end if;
  if (select status from public.jobs where id = v_wo_job) <> 'Scheduled' then
    raise exception 'Work Order second day: jobs.status should now be Scheduled';
  end if;

  -- Scheduled-by-hand job with no entries (state only this app's history can produce):
  -- tentative work, status stays Scheduled.
  select * into v_entry from public.create_schedule_entry(v_scheduled_job, '<TECH_ID>', '2026-10-14', '08:00', '16:00');
  if v_entry.entry_type <> 'work' or v_entry.status <> 'tentative' then
    raise exception 'Scheduled with no entries: expected tentative work, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_scheduled_job) <> 'Scheduled' then
    raise exception 'Scheduled with no entries: jobs.status must stay Scheduled';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
begin
  begin
    perform public.create_schedule_entry('99999999-9999-9999-9999-999999999a13', '<TECH_ID>', '2026-10-15', '08:00', '09:00');
    raise exception 'technician should not be able to call create_schedule_entry';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'create_schedule_entry Completed-branch checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: create_schedule_entry Completed-branch checks passed.` and no `ERROR`. If any `raise exception` fires, stop and diagnose.

- [x] **Step 6: Record the amendment in the Phase 1 design spec**

In `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md`, directly under the `## Design decisions from this session` heading, insert this paragraph:

```
**Amendment 2026-09-21 (Phase 2 design):** `create_schedule_entry()` now has an explicit `Completed` branch. A booking on a Completed job (a warranty / return visit) is a directly-confirmed `work` entry and leaves `jobs.status` as `Completed`. The rule above ("anything else -> work, tentative unless the job already has a confirmed work entry") therefore applies to `Work Order` and `Scheduled` only. See `docs/superpowers/specs/2026-09-21-shadow-schedule-phase2-design.md`.
```

- [x] **Step 7: Commit**

```bash
git add supabase/policies/023_schedule_entry_functions.sql supabase/migrations/2026-09-21_create_schedule_entry_completed.sql docs/superpowers/specs/2026-09-16-shadow-schedule-design.md
git commit -m "feat: handle Completed jobs explicitly in create_schedule_entry()" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure scheduling logic (`scheduleUtils.js`) and `formatJobLabel`

**Files:**
- Create: `src/lib/scheduleUtils.js`
- Modify: `src/lib/jobConstants.js`
- Create then delete (never committed): `schedule-utils-check.mjs` in the repo root

**Interfaces:**
- Produces (all named exports of `src/lib/scheduleUtils.js`, no imports):
  - constants: `GRID_START_HOUR`(6), `GRID_END_HOUR`(18), `GRID_HOURS`(6..17), `ALL_DAY`('all-day'), `ALL_DAY_START`('06:00'), `ALL_DAY_END`('18:00'), `DEFAULT_START`('08:00'), `START_TIME_OPTIONS`(65 strings '05:00'..'21:00'), `DURATION_PRESETS` (`{ value: number | 'all-day', label }[]`)
  - dates: `toDateString(Date)`, `parseDateString(str)`, `todayString()`, `isValidDateString(str)`, `addDays(str, n)`, `startOfWeek(str)` (Monday), `weekDays(str)` (7 strings), `formatDayLabel(str)`, `formatRangeLabel(view, str)`, `parseBoardParams(params, today?)` -> `{ view: 'day'|'week', date }`
  - times: `timeToMinutes('HH:MM[:SS]')`, `minutesToTime(min)` -> 'HH:MM', `formatTime`, `formatTimeRange`, `formatHourLabel(hour)`, `formatMinutes(min)`
  - durations: `resolveTimes(startTime, duration)` -> `{ start, end }`, `durationFits(startTime, duration)`, `fitDuration(startTime, duration)`, `durationFromTimes(start, end)`, `defaultDuration(jobStatus)`, `durationOptions(current)`
  - layout: `assignLanes(entries)` -> `{ placed: { entry, lane }[], laneCount }`, `blockGeometry(start, end)` -> `{ leftPct, widthPct }`
  - jobs/entries: `classifyUnscheduled(job)` -> `null | { label, tentativeCount }` (job has `status` and `schedule_entries: { entry_type, status }[]`), `entryContext(entry, jobEntries, jobStatus)` -> `{ otherTentative, revertsToWorkOrder }`, `entryTypeLabel`, `entryStatusLabel`, `entryTags`, `compareEntries`
  - messages: `describeBooked(entry, statusBefore, statusAfter)`, `describeConfirmed(before, after)`, `describeRemoved(before, after)`
- `jobConstants.js` gains `formatJobLabel(job)` (job has `job_number`, `clientName`, `site_address`, `status`).

- [x] **Step 1: Write the failing check script**

Create `schedule-utils-check.mjs` in the repo root:

```js
import assert from 'node:assert/strict'
import * as u from './src/lib/scheduleUtils.js'

// dates (2026-09-21 is a Monday)
assert.equal(u.toDateString(new Date(2026, 8, 21, 0, 30)), '2026-09-21')
assert.equal(u.startOfWeek('2026-09-21'), '2026-09-21')
assert.equal(u.startOfWeek('2026-09-24'), '2026-09-21')
assert.equal(u.startOfWeek('2026-09-27'), '2026-09-21')
assert.equal(u.startOfWeek('2026-09-28'), '2026-09-28')
assert.equal(u.addDays('2026-09-30', 1), '2026-10-01')
assert.equal(u.addDays('2026-03-01', -1), '2026-02-28')
assert.deepEqual(u.weekDays('2026-09-24'), [
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
])
assert.equal(u.isValidDateString('2026-02-30'), false)
assert.equal(u.isValidDateString('nope'), false)
assert.equal(u.isValidDateString(null), false)
assert.equal(u.isValidDateString('2026-09-21'), true)

const params = (query) => new URLSearchParams(query)
assert.deepEqual(u.parseBoardParams(params(''), '2026-09-21'), { view: 'week', date: '2026-09-21' })
assert.deepEqual(u.parseBoardParams(params('view=day&date=2026-10-01'), '2026-09-21'), { view: 'day', date: '2026-10-01' })
assert.deepEqual(u.parseBoardParams(params('view=month&date=garbage'), '2026-09-21'), { view: 'week', date: '2026-09-21' })

// times
assert.equal(u.timeToMinutes('08:30:00'), 510)
assert.equal(u.minutesToTime(510), '08:30')
assert.equal(u.formatTime('08:00:00'), '8:00am')
assert.equal(u.formatTime('12:30'), '12:30pm')
assert.equal(u.formatTime('00:15'), '12:15am')
assert.equal(u.formatTime('16:00:00'), '4:00pm')
assert.equal(u.formatTimeRange('08:00:00', '16:00:00'), '8:00am–4:00pm')
assert.equal(u.formatHourLabel(6), '6am')
assert.equal(u.formatHourLabel(12), '12pm')
assert.equal(u.formatHourLabel(17), '5pm')
assert.equal(u.formatMinutes(140), '2h 20m')
assert.equal(u.formatMinutes(45), '45m')
assert.equal(u.formatMinutes(120), '2h')

// durations
assert.equal(u.START_TIME_OPTIONS.length, 65)
assert.equal(u.START_TIME_OPTIONS[0], '05:00')
assert.equal(u.START_TIME_OPTIONS.at(-1), '21:00')
assert.equal(u.DURATION_PRESETS[0].value, 15)
assert.equal(u.DURATION_PRESETS.at(-1).value, u.ALL_DAY)
assert.deepEqual(u.resolveTimes('08:00', 480), { start: '08:00', end: '16:00' })
assert.deepEqual(u.resolveTimes('10:00', u.ALL_DAY), { start: '06:00', end: '18:00' })
assert.equal(u.durationFits('20:00', 240), false)
assert.equal(u.durationFits('16:00', 480), false)
assert.equal(u.durationFits('15:45', 480), true)
assert.equal(u.durationFits('10:00', u.ALL_DAY), true)
assert.equal(u.fitDuration('08:00', 480), 480)
assert.equal(u.fitDuration('20:00', 480), 180)
assert.equal(u.durationFromTimes('06:00:00', '18:00:00'), u.ALL_DAY)
assert.equal(u.durationFromTimes('08:00:00', '16:00:00'), 480)
assert.equal(u.durationFromTimes('08:00:00', '10:20:00'), 140)
assert.equal(u.defaultDuration('Quote'), 60)
assert.equal(u.defaultDuration('Completed'), 60)
assert.equal(u.defaultDuration('Work Order'), 480)
assert.equal(u.defaultDuration('Scheduled'), 480)
assert.equal(u.defaultDuration(undefined), 480)
assert.equal(u.durationOptions(140).at(-1).label, 'Custom (2h 20m)')
assert.equal(u.durationOptions(60).length, u.DURATION_PRESETS.length)
assert.equal(u.durationOptions(u.ALL_DAY).length, u.DURATION_PRESETS.length)

// lanes and geometry
const e = (id, start, end) => ({ id, start_time: start, end_time: end })
let lanes = u.assignLanes([e('a', '08:00:00', '12:00:00'), e('b', '12:00:00', '16:00:00')])
assert.equal(lanes.laneCount, 1)
lanes = u.assignLanes([e('a', '08:00:00', '12:00:00'), e('b', '10:00:00', '14:00:00'), e('c', '11:00:00', '12:30:00')])
assert.equal(lanes.laneCount, 3)
assert.deepEqual(lanes.placed.map((p) => p.lane), [0, 1, 2])
assert.equal(u.assignLanes([]).laneCount, 1)
assert.deepEqual(u.blockGeometry('06:00:00', '18:00:00'), { leftPct: 0, widthPct: 100 })
assert.deepEqual(u.blockGeometry('12:00:00', '15:00:00'), { leftPct: 50, widthPct: 25 })
assert.deepEqual(u.blockGeometry('19:00:00', '20:00:00'), { leftPct: 96, widthPct: 4 })
assert.deepEqual(u.blockGeometry('04:00:00', '05:00:00'), { leftPct: 0, widthPct: 4 })

// unscheduled classification
const job = (status, entries) => ({ status, schedule_entries: entries })
const ent = (entry_type, status) => ({ entry_type, status })
assert.deepEqual(u.classifyUnscheduled(job('Quote', [])), { label: 'Needs inspection', tentativeCount: 0 })
assert.equal(u.classifyUnscheduled(job('Quote', [ent('inspection', 'confirmed')])), null)
assert.deepEqual(
  u.classifyUnscheduled(job('Work Order', [ent('work', 'tentative'), ent('work', 'tentative')])),
  { label: 'Needs work scheduling', tentativeCount: 2 }
)
assert.equal(u.classifyUnscheduled(job('Work Order', [ent('work', 'confirmed')])), null)
assert.notEqual(u.classifyUnscheduled(job('Work Order', [ent('inspection', 'confirmed')])), null)
assert.deepEqual(u.classifyUnscheduled(job('Scheduled', [])), { label: 'Needs work scheduling', tentativeCount: 0 })
assert.equal(u.classifyUnscheduled(job('Scheduled', [ent('work', 'confirmed')])), null)
assert.equal(u.classifyUnscheduled(job('Completed', [])), null)
assert.deepEqual(u.classifyUnscheduled({ status: 'Quote' }), { label: 'Needs inspection', tentativeCount: 0 })

// action context
const tent = { id: 'x', entry_type: 'work', status: 'tentative' }
assert.deepEqual(
  u.entryContext(tent, [tent, { id: 'y', entry_type: 'work', status: 'tentative' }], 'Work Order'),
  { otherTentative: 1, revertsToWorkOrder: false }
)
const last = { id: 'c', entry_type: 'work', status: 'confirmed' }
assert.equal(u.entryContext(last, [last], 'Scheduled').revertsToWorkOrder, true)
assert.equal(u.entryContext(last, [last, { id: 'd', entry_type: 'work', status: 'confirmed' }], 'Scheduled').revertsToWorkOrder, false)
assert.equal(u.entryContext(last, [last], 'Completed').revertsToWorkOrder, false)
const insp = { id: 'i', entry_type: 'inspection', status: 'confirmed' }
assert.equal(u.entryContext(insp, [insp], 'Scheduled').revertsToWorkOrder, false)

// labels and messages
assert.deepEqual(u.entryTags({ entry_type: 'work', status: 'tentative' }), ['Work', 'Tentative'])
assert.deepEqual(u.entryTags({ entry_type: 'work', status: 'confirmed' }), ['Work'])
assert.deepEqual(u.entryTags({ entry_type: 'inspection', status: 'confirmed' }), ['Inspection'])
assert.equal(u.entryStatusLabel({ status: 'confirmed' }), 'Confirmed')
assert.equal(u.entryTypeLabel({ entry_type: 'inspection' }), 'Inspection')
assert.equal(u.describeBooked({ entry_type: 'inspection', status: 'confirmed' }, 'Quote', 'Quote'), 'Booked as a confirmed inspection.')
assert.equal(u.describeBooked({ entry_type: 'work', status: 'tentative' }, 'Work Order', 'Work Order'), 'Booked as a tentative hold.')
assert.equal(u.describeBooked({ entry_type: 'work', status: 'confirmed' }, 'Work Order', 'Scheduled'), 'Booked and confirmed. The job is now Scheduled.')
assert.equal(u.describeBooked({ entry_type: 'work', status: 'confirmed' }, 'Completed', 'Completed'), 'Booked and confirmed.')
assert.equal(u.describeConfirmed('Work Order', 'Scheduled'), 'Booking confirmed. The job is now Scheduled.')
assert.equal(u.describeRemoved('Scheduled', 'Work Order'), 'Booking removed. The job is now Work Order.')
assert.equal(u.describeRemoved('Quote', 'Quote'), 'Booking removed.')
assert.equal(u.describeRemoved(null, null), 'Booking removed.')

console.log('scheduleUtils checks passed')
```

- [x] **Step 2: Run it and watch it fail**

Run: `node schedule-utils-check.mjs`
Expected: FAIL with `Cannot find module ... scheduleUtils.js` (the module does not exist yet).

- [x] **Step 3: Write `src/lib/scheduleUtils.js`**

```js
export const GRID_START_HOUR = 6
export const GRID_END_HOUR = 18
export const GRID_HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, index) => GRID_START_HOUR + index
)
export const ALL_DAY = 'all-day'
export const ALL_DAY_START = '06:00'
export const ALL_DAY_END = '18:00'
export const DEFAULT_START = '08:00'

const MINUTES_PER_DAY = 24 * 60
const GRID_START_MINUTES = GRID_START_HOUR * 60
const GRID_END_MINUTES = GRID_END_HOUR * 60
const MIN_BLOCK_PCT = 4

function pad2(value) {
  return String(value).padStart(2, '0')
}

// ---- dates: plain 'YYYY-MM-DD' strings, local-time arithmetic only ----

export function toDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseDateString(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function todayString() {
  return toDateString(new Date())
}

export function isValidDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? '')) return false
  return toDateString(parseDateString(dateStr)) === dateStr
}

export function addDays(dateStr, days) {
  const date = parseDateString(dateStr)
  date.setDate(date.getDate() + days)
  return toDateString(date)
}

export function startOfWeek(dateStr) {
  const date = parseDateString(dateStr)
  const offsetFromMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offsetFromMonday)
  return toDateString(date)
}

export function weekDays(dateStr) {
  const start = startOfWeek(dateStr)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function formatDayLabel(dateStr) {
  return parseDateString(dateStr).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatRangeLabel(view, dateStr) {
  if (view === 'day') {
    return parseDateString(dateStr).toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  const start = parseDateString(startOfWeek(dateStr))
  const end = parseDateString(addDays(startOfWeek(dateStr), 6))
  const startText = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${startText} – ${endText}`
}

export function parseBoardParams(params, today = todayString()) {
  const rawView = params.get('view')
  const rawDate = params.get('date')
  return {
    view: rawView === 'day' ? 'day' : 'week',
    date: isValidDateString(rawDate) ? rawDate : today,
  }
}

// ---- times: Postgres 'HH:MM[:SS]' strings ----

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

export function minutesToTime(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

export function formatTime(time) {
  const minutes = timeToMinutes(time)
  const hour24 = Math.floor(minutes / 60)
  const suffix = hour24 >= 12 ? 'pm' : 'am'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${pad2(minutes % 60)}${suffix}`
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)}`
}

export function formatHourLabel(hour) {
  return formatTime(`${pad2(hour)}:00`).replace(':00', '')
}

export function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

// ---- start-time and duration pickers ----

export const START_TIME_OPTIONS = (() => {
  const options = []
  for (let minutes = 5 * 60; minutes <= 21 * 60; minutes += 15) {
    options.push(minutesToTime(minutes))
  }
  return options
})()

export const DURATION_PRESETS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 90, label: '1.5 hr' },
  { value: 120, label: '2 hr' },
  ...[3, 4, 5, 6, 7, 8, 9, 10].map((hours) => ({ value: hours * 60, label: `${hours} hr` })),
  { value: ALL_DAY, label: 'All day (6am–6pm)' },
]

export function resolveTimes(startTime, duration) {
  if (duration === ALL_DAY) return { start: ALL_DAY_START, end: ALL_DAY_END }
  return {
    start: startTime.slice(0, 5),
    end: minutesToTime(timeToMinutes(startTime) + duration),
  }
}

export function durationFits(startTime, duration) {
  if (duration === ALL_DAY) return true
  return timeToMinutes(startTime) + duration < MINUTES_PER_DAY
}

export function fitDuration(startTime, duration) {
  if (durationFits(startTime, duration)) return duration
  const fitting = DURATION_PRESETS.filter(
    (preset) => preset.value !== ALL_DAY && durationFits(startTime, preset.value)
  )
  return fitting[fitting.length - 1].value
}

export function durationFromTimes(start, end) {
  if (start.slice(0, 5) === ALL_DAY_START && end.slice(0, 5) === ALL_DAY_END) return ALL_DAY
  return timeToMinutes(end) - timeToMinutes(start)
}

export function defaultDuration(jobStatus) {
  return jobStatus === 'Quote' || jobStatus === 'Completed' ? 60 : 480
}

export function durationOptions(currentDuration) {
  const known = currentDuration === ALL_DAY || DURATION_PRESETS.some((preset) => preset.value === currentDuration)
  if (known) return DURATION_PRESETS
  return [...DURATION_PRESETS, { value: currentDuration, label: `Custom (${formatMinutes(currentDuration)})` }]
}

// ---- Day-grid layout ----

export function assignLanes(entries) {
  const sorted = [...entries].sort(
    (a, b) =>
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time) ||
      timeToMinutes(a.end_time) - timeToMinutes(b.end_time)
  )
  const laneEnds = []
  const placed = []
  for (const entry of sorted) {
    const start = timeToMinutes(entry.start_time)
    let lane = laneEnds.findIndex((end) => end <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = timeToMinutes(entry.end_time)
    placed.push({ entry, lane })
  }
  return { placed, laneCount: Math.max(1, laneEnds.length) }
}

export function blockGeometry(startTime, endTime) {
  const span = GRID_END_MINUTES - GRID_START_MINUTES
  const clamp = (minutes) => Math.min(Math.max(minutes, GRID_START_MINUTES), GRID_END_MINUTES)
  const start = clamp(timeToMinutes(startTime))
  const end = clamp(timeToMinutes(endTime))
  let leftPct = ((start - GRID_START_MINUTES) / span) * 100
  let widthPct = ((end - start) / span) * 100
  if (widthPct < MIN_BLOCK_PCT) {
    widthPct = MIN_BLOCK_PCT
    if (leftPct + widthPct > 100) leftPct = 100 - widthPct
  }
  return { leftPct, widthPct }
}

// ---- jobs and entries ----

export function classifyUnscheduled(job) {
  const entries = job.schedule_entries ?? []
  const tentativeCount = entries.filter((entry) => entry.status === 'tentative').length

  if (job.status === 'Quote') {
    const hasInspection = entries.some(
      (entry) => entry.entry_type === 'inspection' && entry.status === 'confirmed'
    )
    return hasInspection ? null : { label: 'Needs inspection', tentativeCount }
  }

  if (job.status === 'Work Order' || job.status === 'Scheduled') {
    const hasWork = entries.some((entry) => entry.entry_type === 'work' && entry.status === 'confirmed')
    return hasWork ? null : { label: 'Needs work scheduling', tentativeCount }
  }

  return null
}

export function entryContext(entry, jobEntries, jobStatus) {
  const otherTentative = jobEntries.filter(
    (other) => other.status === 'tentative' && other.id !== entry.id
  ).length
  const otherConfirmedWork = jobEntries.some(
    (other) => other.id !== entry.id && other.entry_type === 'work' && other.status === 'confirmed'
  )
  const revertsToWorkOrder =
    entry.entry_type === 'work' &&
    entry.status === 'confirmed' &&
    !otherConfirmedWork &&
    jobStatus === 'Scheduled'
  return { otherTentative, revertsToWorkOrder }
}

export function entryTypeLabel(entry) {
  return entry.entry_type === 'inspection' ? 'Inspection' : 'Work'
}

export function entryStatusLabel(entry) {
  return entry.status === 'tentative' ? 'Tentative' : 'Confirmed'
}

export function entryTags(entry) {
  const tags = [entryTypeLabel(entry)]
  if (entry.status === 'tentative') tags.push('Tentative')
  return tags
}

export function compareEntries(a, b) {
  return `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`)
}

// ---- result messages (built from the real result, never predicted) ----

function withStatusChange(text, statusBefore, statusAfter) {
  return statusBefore && statusAfter && statusBefore !== statusAfter
    ? `${text} The job is now ${statusAfter}.`
    : text
}

export function describeBooked(entry, statusBefore, statusAfter) {
  let text
  if (entry.entry_type === 'inspection') text = 'Booked as a confirmed inspection.'
  else if (entry.status === 'tentative') text = 'Booked as a tentative hold.'
  else text = 'Booked and confirmed.'
  return withStatusChange(text, statusBefore, statusAfter)
}

export function describeConfirmed(statusBefore, statusAfter) {
  return withStatusChange('Booking confirmed.', statusBefore, statusAfter)
}

export function describeRemoved(statusBefore, statusAfter) {
  return withStatusChange('Booking removed.', statusBefore, statusAfter)
}
```

- [x] **Step 4: Add `formatJobLabel` to `src/lib/jobConstants.js`**

Append at the end of the file:

```js
export function formatJobLabel(job) {
  const parts = [formatJobNumber(job.job_number), job.clientName]
  if (job.site_address) parts.push(job.site_address)
  return `${parts.join(' — ')}${job.status === 'Completed' ? ' (Completed)' : ''}`
}
```

- [x] **Step 5: Run the check and watch it pass, in two time zones**

Run: `node schedule-utils-check.mjs`
Expected: `scheduleUtils checks passed`

Then prove the date logic is time-zone independent: `TZ=Australia/Sydney node schedule-utils-check.mjs` and `TZ=UTC node schedule-utils-check.mjs`. Both should also print `scheduleUtils checks passed`. (If this Windows shell ignores `TZ`, note that in the task report and move on; the code uses only local-date arithmetic.)

- [x] **Step 6: Delete the check script, lint, build**

```bash
rm schedule-utils-check.mjs
npm run lint
npm run build
```

Expected: no new lint warnings from these files; build succeeds.

- [x] **Step 7: Commit**

```bash
git add src/lib/scheduleUtils.js src/lib/jobConstants.js
git commit -m "feat: add scheduling date/time/lane/classification helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Data layer (hooks and actions)

**Files:**
- Create: `src/hooks/useTechnicians.js`
- Create: `src/hooks/useScheduleBoard.js`
- Create: `src/hooks/useJobSchedule.js`
- Create: `src/lib/scheduleActions.js`
- Modify: `src/hooks/useJob.js`

**Interfaces:**
- Produces:
  - `useTechnicians()` -> `{ technicians: { id, full_name }[], loading, error }`
  - `useScheduleBoard(rangeStart, rangeEnd)` -> `{ entries, jobs, loaded, error, reload }`. `entries`: `{ id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time }[]` within the range. `jobs`: every job as `{ id, job_number, status, description, site_address, clientName, schedule_entries: { id, entry_type, status }[] }`. `reload()` returns a promise.
  - `useJobSchedule(jobId)` -> `{ entries, loaded, error, reload }` (all of one job's entries, sorted by date/start).
  - `scheduleActions`: `bookEntry({ jobId, technicianId, date, start, end })`, `updateEntry(entryId, { technicianId, date, start, end })`, `confirmEntry(entryId)`, `removeEntry(entryId)` all resolve to `{ data, error }` and never throw; `fetchJobStatus(jobId)` resolves to the status string or `null`.
  - `useJob(...).reload({ silent: true })` reloads without flipping the page to "Loading...".

- [x] **Step 1: Write `src/hooks/useTechnicians.js`**

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useTechnicians() {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data, error: loadError } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('role', 'technician')
          .order('full_name', { ascending: true })
        if (cancelled) return
        if (loadError) setError(loadError)
        else setTechnicians(data)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { technicians, loading, error }
}
```

- [x] **Step 2: Write `src/hooks/useScheduleBoard.js`**

```js
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useScheduleBoard(rangeStart, rangeEnd) {
  const [entries, setEntries] = useState([])
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const latestRequest = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const [entriesResult, jobsResult] = await Promise.all([
        supabase
          .from('schedule_entries')
          .select('id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time')
          .gte('scheduled_date', rangeStart)
          .lte('scheduled_date', rangeEnd),
        supabase
          .from('jobs')
          .select('id, job_number, status, description, site_address, clients(name), schedule_entries(id, entry_type, status)')
          .order('job_number', { ascending: false }),
      ])
      if (requestId !== latestRequest.current) return

      const failure = entriesResult.error ?? jobsResult.error
      if (failure) {
        setError(failure)
        return
      }

      setEntries(entriesResult.data)
      setJobs(
        jobsResult.data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
        }))
      )
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (requestId === latestRequest.current) setError(err)
    }
  }, [rangeStart, rangeEnd])

  useEffect(() => {
    reload()
  }, [reload])

  return { entries, jobs, loaded, error, reload }
}
```

- [x] **Step 3: Write `src/hooks/useJobSchedule.js`**

```js
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobSchedule(jobId) {
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const latestRequest = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const { data, error: loadError } = await supabase
        .from('schedule_entries')
        .select('id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time')
        .eq('job_id', jobId)
        .order('scheduled_date', { ascending: true })
        .order('start_time', { ascending: true })
      if (requestId !== latestRequest.current) return

      if (loadError) {
        setError(loadError)
        return
      }
      setEntries(data)
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (requestId === latestRequest.current) setError(err)
    }
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  return { entries, loaded, error, reload }
}
```

- [x] **Step 4: Write `src/lib/scheduleActions.js`**

```js
import { supabase } from './supabaseClient'

async function run(action) {
  try {
    return await action()
  } catch (err) {
    return { data: null, error: err }
  }
}

export function bookEntry({ jobId, technicianId, date, start, end }) {
  return run(() =>
    supabase.rpc('create_schedule_entry', {
      target_job_id: jobId,
      target_technician_id: technicianId,
      target_date: date,
      target_start: start,
      target_end: end,
    })
  )
}

export function updateEntry(entryId, { technicianId, date, start, end }) {
  return run(() =>
    supabase
      .from('schedule_entries')
      .update({
        technician_id: technicianId,
        scheduled_date: date,
        start_time: start,
        end_time: end,
      })
      .eq('id', entryId)
      .select()
      .single()
  )
}

export function confirmEntry(entryId) {
  return run(() => supabase.rpc('confirm_schedule_entry', { target_entry_id: entryId }))
}

export function removeEntry(entryId) {
  return run(() => supabase.rpc('remove_schedule_entry', { target_entry_id: entryId }))
}

export async function fetchJobStatus(jobId) {
  const { data } = await run(() => supabase.from('jobs').select('status').eq('id', jobId).single())
  return data?.status ?? null
}
```

- [x] **Step 5: Add a silent reload to `src/hooks/useJob.js`**

Replace:

```js
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
```

with:

```js
  const reload = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true)
    setError(null)
```

(Every existing caller invokes `reload()` with no argument, so behaviour is unchanged for them. `silent` lets the Schedule tab refresh the job's status without the whole page flashing "Loading..." and unmounting the tab.)

- [x] **Step 6: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean.

- [x] **Step 7: Commit**

```bash
git add src/hooks/useTechnicians.js src/hooks/useScheduleBoard.js src/hooks/useJobSchedule.js src/lib/scheduleActions.js src/hooks/useJob.js
git commit -m "feat: add schedule data hooks and action wrappers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Board display components and styles

**Files:**
- Create: `src/components/ScheduleBlock.jsx`
- Create: `src/components/DayGrid.jsx`
- Create: `src/components/WeekGrid.jsx`
- Modify: `src/index.css` (append a schedule section)

**Interfaces:**
- Consumes: `scheduleUtils` (Task 2): `GRID_HOURS`, `assignLanes`, `blockGeometry`, `formatHourLabel`, `formatDayLabel`, `todayString`, `entryTags`, `formatTimeRange`, `compareEntries`; `formatJobNumber` from `jobConstants`.
- Produces:
  - `<ScheduleBlock entry job variant style onClick />` where `variant` is `'block'` (Day) or `'chip'` (Week), `job` is a board job (`{ job_number, clientName }`) or undefined, `onClick(entry)`.
  - `<DayGrid date technicians entries jobsById onCellClick onBlockClick />`; `onCellClick(technicianId, date, 'HH:00')`, `onBlockClick(entry)`.
  - `<WeekGrid days technicians entries jobsById onCellClick onBlockClick />`; `onCellClick(technicianId, date, null)`.
  - Every clickable cell carries `data-technician-id`, `data-date` (and `data-hour` in Day) so Phase 3's drag can attach without restructuring.

- [x] **Step 1: Write `src/components/ScheduleBlock.jsx`**

```jsx
import { formatJobNumber } from '../lib/jobConstants'
import { entryTags, formatTimeRange } from '../lib/scheduleUtils'

export default function ScheduleBlock({ entry, job, variant, style, onClick }) {
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

- [x] **Step 2: Write `src/components/DayGrid.jsx`**

```jsx
import { GRID_HOURS, assignLanes, blockGeometry, formatHourLabel } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

const LANE_HEIGHT = 62

function hourToTime(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

export default function DayGrid({ date, technicians, entries, jobsById, onCellClick, onBlockClick }) {
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
                  <button
                    key={hour}
                    type="button"
                    className="schedule-day-cell"
                    data-technician-id={tech.id}
                    data-date={date}
                    data-hour={hour}
                    aria-label={`Book ${tech.full_name} at ${formatHourLabel(hour)}`}
                    onClick={() => onCellClick(tech.id, date, hourToTime(hour))}
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

- [x] **Step 3: Write `src/components/WeekGrid.jsx`**

```jsx
import { Fragment } from 'react'
import { compareEntries, formatDayLabel, todayString } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

export default function WeekGrid({ days, technicians, entries, jobsById, onCellClick, onBlockClick }) {
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
              <div
                key={day}
                className={day === today ? 'schedule-week-cell schedule-week-today' : 'schedule-week-cell'}
                tabIndex={0}
                data-technician-id={tech.id}
                data-date={day}
                aria-label={`Book ${tech.full_name} on ${formatDayLabel(day)}`}
                onClick={() => onCellClick(tech.id, day, null)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === 'Enter') onCellClick(tech.id, day, null)
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
          })}
        </Fragment>
      ))}
    </div>
  )
}
```

- [x] **Step 4: Append the schedule styles to `src/index.css`**

```css
/* ---- Schedule (Dispatch Board) ---- */

.schedule-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
}

.schedule-controls button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--white);
  color: var(--navy);
  font-weight: 600;
  cursor: pointer;
}

.schedule-controls button.active {
  background: var(--navy);
  border-color: var(--navy);
  color: var(--white);
}

.schedule-range-label {
  margin-left: 8px;
  font-weight: 600;
  color: var(--navy);
}

.schedule-notice {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 4px solid var(--orange);
  background: rgba(250, 162, 27, 0.12);
}

.schedule-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.schedule-main {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.schedule-side {
  width: 300px;
  flex-shrink: 0;
}

.schedule-day {
  min-width: 900px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.schedule-day-header,
.schedule-day-row {
  display: flex;
}

.schedule-day-row {
  border-top: 1px solid var(--border);
}

.schedule-day-name {
  box-sizing: border-box;
  width: 140px;
  flex-shrink: 0;
  padding: 8px 10px;
  border-right: 1px solid var(--border);
  font-weight: 600;
  color: var(--navy);
}

.schedule-day-hours {
  display: flex;
  flex: 1;
}

.schedule-day-hour-label {
  flex: 1;
  padding: 8px 4px;
  border-left: 1px solid var(--border);
  font-size: 12px;
  color: var(--navy);
}

.schedule-day-track {
  position: relative;
  flex: 1;
}

.schedule-day-cells {
  position: absolute;
  inset: 0;
  display: flex;
}

.schedule-day-cell {
  flex: 1;
  padding: 0;
  border: none;
  border-left: 1px solid var(--border);
  background: none;
  cursor: pointer;
}

.schedule-day-cell:hover {
  background: rgba(250, 162, 27, 0.12);
}

.schedule-week {
  display: grid;
  grid-template-columns: 140px repeat(7, minmax(120px, 1fr));
  min-width: 1000px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.schedule-week-head,
.schedule-week-name,
.schedule-week-cell {
  box-sizing: border-box;
  padding: 8px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.schedule-week-head,
.schedule-week-name {
  font-weight: 600;
  color: var(--navy);
}

.schedule-week-cell {
  min-height: 60px;
  cursor: pointer;
}

.schedule-week-cell:hover {
  background: rgba(250, 162, 27, 0.08);
}

.schedule-week-today {
  background: rgba(250, 162, 27, 0.15);
}

.schedule-block {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 2px 6px;
  border: 2px solid var(--navy);
  border-radius: 4px;
  background: var(--navy);
  color: var(--white);
  text-align: left;
  font: inherit;
  font-size: 12px;
  line-height: 1.25;
  cursor: pointer;
}

.schedule-block--block {
  position: absolute;
  z-index: 1;
}

.schedule-block--chip {
  width: 100%;
  margin-bottom: 4px;
}

.schedule-block--inspection {
  border-color: var(--orange);
  background: var(--orange);
  color: var(--navy);
}

.schedule-block--tentative {
  border-style: dashed;
  background: repeating-linear-gradient(
    45deg,
    rgba(6, 20, 59, 0.14),
    rgba(6, 20, 59, 0.14) 6px,
    var(--white) 6px,
    var(--white) 12px
  );
  color: var(--navy);
}

.schedule-block--inspection.schedule-block--tentative {
  background: repeating-linear-gradient(
    45deg,
    rgba(250, 162, 27, 0.3),
    rgba(250, 162, 27, 0.3) 6px,
    var(--white) 6px,
    var(--white) 12px
  );
}

.schedule-block-title {
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.schedule-block-meta,
.schedule-block-address {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.schedule-block-address {
  font-size: 11px;
  opacity: 0.85;
}

.schedule-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.schedule-end-preview {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--navy);
}

.unscheduled-panel h2 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--navy);
}

.unscheduled-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.unscheduled-controls select,
.unscheduled-controls input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--white);
  font: inherit;
}

.unscheduled-list {
  max-height: 70vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.unscheduled-card {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  border-left: 4px solid var(--navy);
}

.unscheduled-card:last-child {
  border-bottom: none;
}

.unscheduled-card--quote {
  border-left-color: var(--orange);
}

.unscheduled-badge-circle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--navy);
  color: var(--white);
  font-size: 14px;
  font-weight: 700;
}

.unscheduled-card--quote .unscheduled-badge-circle {
  background: var(--orange);
  color: var(--navy);
}

.unscheduled-card-body {
  flex: 1;
  min-width: 0;
}

.unscheduled-card-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.unscheduled-client {
  overflow: hidden;
  font-weight: 600;
  color: var(--navy);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.unscheduled-number {
  flex-shrink: 0;
  font-size: 13px;
  color: #777;
}

.unscheduled-address,
.unscheduled-description {
  overflow: hidden;
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.unscheduled-description {
  color: #777;
}

.unscheduled-card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.unscheduled-label {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(250, 162, 27, 0.25);
  font-size: 12px;
  color: var(--navy);
}

.unscheduled-hold-badge {
  padding: 1px 6px;
  border: 1px dashed var(--navy);
  border-radius: 4px;
  font-size: 12px;
}

.unscheduled-book {
  margin-left: auto;
  padding: 4px 12px;
}
```

- [x] **Step 5: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean. (These components are not mounted yet; Task 7 mounts them.)

- [x] **Step 6: Commit**

```bash
git add src/components/ScheduleBlock.jsx src/components/DayGrid.jsx src/components/WeekGrid.jsx src/index.css
git commit -m "feat: add Dispatch Board Day/Week grid components and styles" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Book form (`JobPicker` and `BookingModal`)

**Files:**
- Create: `src/components/JobPicker.jsx`
- Create: `src/components/BookingModal.jsx`

**Interfaces:**
- Consumes: `scheduleUtils` (Task 2), `scheduleActions` `bookEntry`/`updateEntry`/`fetchJobStatus` (Task 3), `Modal`, `formatJobLabel`.
- Produces:
  - `<JobPicker jobs selectedLabel onSelect />` (`onSelect(job)`), unscheduled jobs listed first.
  - `<BookingModal mode job jobs technicians initial entry onClose onSaved />`
    - `mode`: `'book'` or `'edit'`.
    - `job`: a fixed job (`{ id, job_number, status, clientName, site_address }`) when opened from an unscheduled card, the Schedule tab, or in edit mode; omit/`null` to show the searchable picker over `jobs` (default `[]`).
    - `initial`: `{ technicianId?, date?, startTime? }` (book mode).
    - `entry`: the entry being edited (edit mode).
    - `onSaved(message)`: awaited after a successful save; the parent closes the modal, shows `message` and reloads.

- [x] **Step 1: Write `src/components/JobPicker.jsx`**

```jsx
import { useState } from 'react'
import { classifyUnscheduled } from '../lib/scheduleUtils'
import { formatJobLabel } from '../lib/jobConstants'

const MAX_RESULTS = 50

export default function JobPicker({ jobs, selectedLabel, onSelect }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const q = query.trim().toLowerCase()
  const ordered = jobs
    .filter((job) => !q || formatJobLabel(job).toLowerCase().includes(q))
    .sort((a, b) => {
      const aRank = classifyUnscheduled(a) ? 0 : 1
      const bRank = classifyUnscheduled(b) ? 0 : 1
      return aRank - bRank || b.job_number - a.job_number
    })
    .slice(0, MAX_RESULTS)

  function handleSelect(job) {
    onSelect(job)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="material-picker">
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder="Search by job number, client or address"
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="material-picker-results">
          {ordered.length === 0 ? (
            <li className="material-picker-empty">No matches</li>
          ) : (
            ordered.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(job)
                  }}
                >
                  {formatJobLabel(job)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
```

- [x] **Step 2: Write `src/components/BookingModal.jsx`**

```jsx
import { useState } from 'react'
import Modal from './Modal'
import JobPicker from './JobPicker'
import { formatJobLabel } from '../lib/jobConstants'
import { bookEntry, fetchJobStatus, updateEntry } from '../lib/scheduleActions'
import {
  ALL_DAY,
  ALL_DAY_START,
  DEFAULT_START,
  START_TIME_OPTIONS,
  defaultDuration,
  describeBooked,
  durationFits,
  durationFromTimes,
  durationOptions,
  fitDuration,
  formatTime,
  resolveTimes,
  todayString,
} from '../lib/scheduleUtils'

export default function BookingModal({
  mode,
  job = null,
  jobs = [],
  technicians,
  initial = {},
  entry = null,
  onClose,
  onSaved,
}) {
  const isEdit = mode === 'edit'
  const [selectedJobId, setSelectedJobId] = useState(job?.id ?? '')
  const [technicianId, setTechnicianId] = useState(isEdit ? entry.technician_id : (initial.technicianId ?? ''))
  const [date, setDate] = useState(isEdit ? entry.scheduled_date : (initial.date ?? todayString()))
  const [startTime, setStartTime] = useState(
    isEdit ? entry.start_time.slice(0, 5) : (initial.startTime ?? DEFAULT_START)
  )
  const [duration, setDuration] = useState(
    isEdit ? durationFromTimes(entry.start_time, entry.end_time) : defaultDuration(job?.status)
  )
  const [durationTouched, setDurationTouched] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedJob = job ?? jobs.find((candidate) => candidate.id === selectedJobId) ?? null
  const startOptions = START_TIME_OPTIONS.includes(startTime)
    ? START_TIME_OPTIONS
    : [...START_TIME_OPTIONS, startTime].sort()
  const isAllDay = duration === ALL_DAY
  const endTime = resolveTimes(startTime, duration).end

  function handleJobSelect(picked) {
    setSelectedJobId(picked.id)
    if (!durationTouched && !isAllDay) {
      setDuration(fitDuration(startTime, defaultDuration(picked.status)))
    }
  }

  function handleStartChange(value) {
    setStartTime(value)
    setDuration((current) => fitDuration(value, current))
  }

  function handleDurationChange(raw) {
    const value = raw === ALL_DAY ? ALL_DAY : Number(raw)
    setDurationTouched(true)
    setDuration(value)
    if (value === ALL_DAY) setStartTime(ALL_DAY_START)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isEdit && !selectedJob) {
      setError('Choose a job.')
      return
    }
    if (!technicianId) {
      setError('Choose a technician.')
      return
    }
    if (!date) {
      setError('Choose a date.')
      return
    }

    setSaving(true)
    setError(null)
    const { start, end } = resolveTimes(startTime, duration)

    if (isEdit) {
      const { error: saveError } = await updateEntry(entry.id, { technicianId, date, start, end })
      if (saveError) {
        setError(saveError.message)
        setSaving(false)
        return
      }
      setSaving(false)
      await onSaved('Booking updated.')
      return
    }

    const { data, error: saveError } = await bookEntry({
      jobId: selectedJob.id,
      technicianId,
      date,
      start,
      end,
    })
    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }
    const statusAfter = await fetchJobStatus(selectedJob.id)
    setSaving(false)
    await onSaved(describeBooked(data, selectedJob.status, statusAfter))
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2>{isEdit ? 'Edit booking' : 'Book'}</h2>

        {job || isEdit ? (
          <p>
            <strong>Job:</strong> {job ? formatJobLabel(job) : 'Unknown job'}
          </p>
        ) : (
          <label>
            Job
            <JobPicker
              jobs={jobs}
              selectedLabel={selectedJob ? formatJobLabel(selectedJob) : ''}
              onSelect={handleJobSelect}
            />
          </label>
        )}

        <label>
          Technician
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required>
            <option value="">Select technician</option>
            {technicians.map((tech) => (
              <option key={tech.id} value={tech.id}>{tech.full_name}</option>
            ))}
          </select>
        </label>

        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <label>
          Start time
          <select
            value={startTime}
            disabled={isAllDay}
            onChange={(e) => handleStartChange(e.target.value)}
          >
            {startOptions.map((time) => (
              <option key={time} value={time}>{formatTime(time)}</option>
            ))}
          </select>
        </label>

        <label>
          Duration
          <select value={duration} onChange={(e) => handleDurationChange(e.target.value)}>
            {durationOptions(duration).map((preset) => (
              <option
                key={preset.value}
                value={preset.value}
                disabled={!durationFits(startTime, preset.value)}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <p className="schedule-end-preview">Ends {formatTime(endTime)}</p>

        {error && <p role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Book'}
        </button>
      </form>
    </Modal>
  )
}
```

- [x] **Step 3: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean.

- [x] **Step 4: Commit**

```bash
git add src/components/JobPicker.jsx src/components/BookingModal.jsx
git commit -m "feat: add Book form modal and job picker" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Shared entry actions and block details modal

**Files:**
- Create: `src/components/ScheduleEntryActions.jsx`
- Create: `src/components/BlockDetailsModal.jsx`

**Interfaces:**
- Consumes: `scheduleActions` `confirmEntry`/`removeEntry`/`fetchJobStatus` (Task 3), `scheduleUtils` `entryContext`/`describeConfirmed`/`describeRemoved`/`entryTypeLabel`/`entryStatusLabel`/`formatDayLabel`/`formatTimeRange` (Task 2), `Modal`, `formatJobNumber`.
- Produces:
  - `<ScheduleEntryActions entry jobEntries jobStatus onEdit onChanged onRefresh />`: renders Confirm (tentative work entries only), Edit and Remove. `jobEntries` is every entry of that job as `{ id, entry_type, status }[]`. `onChanged(message)` is awaited after a successful confirm/remove; `onRefresh()` is awaited after a failed one (so a stale board reloads while the error stays visible).
  - `<BlockDetailsModal entry job technicianName onClose onEdit onChanged onRefresh />` (`job` is a board job; may be undefined).

- [x] **Step 1: Write `src/components/ScheduleEntryActions.jsx`**

```jsx
import { useState } from 'react'
import { confirmEntry, fetchJobStatus, removeEntry } from '../lib/scheduleActions'
import { describeConfirmed, describeRemoved, entryContext } from '../lib/scheduleUtils'

export default function ScheduleEntryActions({
  entry,
  jobEntries,
  jobStatus,
  onEdit,
  onChanged,
  onRefresh,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { otherTentative, revertsToWorkOrder } = entryContext(entry, jobEntries, jobStatus)
  const canConfirm = entry.entry_type === 'work' && entry.status === 'tentative'

  async function handleConfirm() {
    const warning =
      otherTentative > 0
        ? `Confirming this drops the other ${otherTentative} tentative hold${otherTentative === 1 ? '' : 's'} for this job.\n\n`
        : ''
    if (!window.confirm(`${warning}Confirm this booking?`)) return

    setBusy(true)
    setError(null)
    const { error: actionError } = await confirmEntry(entry.id)
    if (actionError) {
      setError(actionError.message)
      setBusy(false)
      await onRefresh()
      return
    }
    const statusAfter = await fetchJobStatus(entry.job_id)
    setBusy(false)
    await onChanged(describeConfirmed(jobStatus, statusAfter))
  }

  async function handleRemove() {
    const extra = revertsToWorkOrder
      ? '\n\nThis is the last confirmed work day, so the job will go back from Scheduled to Work Order.'
      : ''
    if (!window.confirm(`Are you sure you want to remove this booking?${extra}`)) return

    setBusy(true)
    setError(null)
    const { error: actionError } = await removeEntry(entry.id)
    if (actionError) {
      setError(actionError.message)
      setBusy(false)
      await onRefresh()
      return
    }
    const statusAfter = await fetchJobStatus(entry.job_id)
    setBusy(false)
    await onChanged(describeRemoved(jobStatus, statusAfter))
  }

  return (
    <div className="schedule-actions">
      {canConfirm && (
        <button type="button" className="btn-primary" disabled={busy} onClick={handleConfirm}>
          Confirm
        </button>
      )}
      <button type="button" disabled={busy} onClick={onEdit}>Edit</button>
      <button type="button" disabled={busy} onClick={handleRemove}>Remove</button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
```

- [x] **Step 2: Write `src/components/BlockDetailsModal.jsx`**

```jsx
import { Link } from 'react-router-dom'
import Modal from './Modal'
import ScheduleEntryActions from './ScheduleEntryActions'
import { formatJobNumber } from '../lib/jobConstants'
import {
  entryStatusLabel,
  entryTypeLabel,
  formatDayLabel,
  formatTimeRange,
} from '../lib/scheduleUtils'

export default function BlockDetailsModal({
  entry,
  job,
  technicianName,
  onClose,
  onEdit,
  onChanged,
  onRefresh,
}) {
  return (
    <Modal onClose={onClose}>
      {job ? (
        <>
          <h2>{formatJobNumber(job.job_number)} — {job.clientName}</h2>
          <p>{job.site_address || 'No site address'}</p>
          <p><Link to={`/jobs/${job.id}`}>Open job</Link></p>
        </>
      ) : (
        <h2>Booking</h2>
      )}
      <p>Technician: {technicianName ?? 'Unknown'}</p>
      <p>Date: {formatDayLabel(entry.scheduled_date)}</p>
      <p>Time: {formatTimeRange(entry.start_time, entry.end_time)}</p>
      <p>{entryTypeLabel(entry)} · {entryStatusLabel(entry)}</p>
      {job && (
        <ScheduleEntryActions
          entry={entry}
          jobEntries={job.schedule_entries ?? []}
          jobStatus={job.status}
          onEdit={onEdit}
          onChanged={onChanged}
          onRefresh={onRefresh}
        />
      )}
    </Modal>
  )
}
```

- [x] **Step 3: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean.

- [x] **Step 4: Commit**

```bash
git add src/components/ScheduleEntryActions.jsx src/components/BlockDetailsModal.jsx
git commit -m "feat: add shared schedule entry actions and block details modal" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Unscheduled panel, `/schedule` page, route and nav link

**Files:**
- Create: `src/components/UnscheduledList.jsx`
- Create: `src/pages/Schedule.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/AppShell.jsx`

**Interfaces:**
- Consumes: everything from Tasks 2-6.
- Produces: the `/schedule` route (staff only). `<UnscheduledList jobs onBook />` where `onBook(job)`.

- [x] **Step 1: Write `src/components/UnscheduledList.jsx`**

```jsx
import { useState } from 'react'
import { formatJobLabel } from '../lib/jobConstants'
import { classifyUnscheduled } from '../lib/scheduleUtils'

const TYPE_FILTERS = ['All jobs', 'Needs inspection', 'Needs work scheduling']
const BADGE_LETTERS = { Quote: 'Q', 'Work Order': 'W', Scheduled: 'S' }

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
            <li
              key={job.id}
              className={
                job.status === 'Quote'
                  ? 'unscheduled-card unscheduled-card--quote'
                  : 'unscheduled-card'
              }
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
                  <button
                    type="button"
                    className="btn-primary unscheduled-book"
                    onClick={() => onBook(job)}
                  >
                    Book
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [x] **Step 2: Write `src/pages/Schedule.jsx`**

```jsx
import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useScheduleBoard } from '../hooks/useScheduleBoard'
import { useTechnicians } from '../hooks/useTechnicians'
import DayGrid from '../components/DayGrid'
import WeekGrid from '../components/WeekGrid'
import UnscheduledList from '../components/UnscheduledList'
import BookingModal from '../components/BookingModal'
import BlockDetailsModal from '../components/BlockDetailsModal'
import {
  addDays,
  formatRangeLabel,
  parseBoardParams,
  startOfWeek,
  todayString,
  weekDays,
} from '../lib/scheduleUtils'

function ScheduleBoard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { view, date } = parseBoardParams(searchParams)
  const rangeStart = view === 'day' ? date : startOfWeek(date)
  const rangeEnd = view === 'day' ? date : addDays(rangeStart, 6)

  const { entries, jobs, loaded, error, reload } = useScheduleBoard(rangeStart, rangeEnd)
  const { technicians, error: techError } = useTechnicians()
  const [booking, setBooking] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [notice, setNotice] = useState(null)

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((job) => [job.id, job])), [jobs])
  const techNames = useMemo(
    () => Object.fromEntries(technicians.map((tech) => [tech.id, tech.full_name])),
    [technicians]
  )

  function navigate(nextView, nextDate) {
    setSearchParams({ view: nextView, date: nextDate })
  }

  function shift(direction) {
    navigate(view, addDays(date, (view === 'day' ? 1 : 7) * direction))
  }

  function handleCellClick(technicianId, cellDate, startTime) {
    setBooking({ mode: 'book', job: null, initial: { technicianId, date: cellDate, startTime } })
  }

  function handleBookJob(job) {
    setBooking({
      mode: 'book',
      job,
      initial: { date: view === 'day' ? date : todayString() },
    })
  }

  function handleEditFromDetails() {
    setBooking({ mode: 'edit', entry: selectedEntry })
    setSelectedEntry(null)
  }

  async function handleChanged(message) {
    setBooking(null)
    setSelectedEntry(null)
    setNotice(message)
    await reload()
  }

  const bookingJob =
    booking?.mode === 'edit' ? (jobsById[booking.entry.job_id] ?? null) : (booking?.job ?? null)

  return (
    <div>
      <h1>Schedule</h1>

      <div className="schedule-controls">
        <button
          type="button"
          className={view === 'day' ? 'active' : ''}
          onClick={() => navigate('day', date)}
        >
          Day
        </button>
        <button
          type="button"
          className={view === 'week' ? 'active' : ''}
          onClick={() => navigate('week', date)}
        >
          Week
        </button>
        <button type="button" onClick={() => shift(-1)}>‹ Prev</button>
        <button type="button" onClick={() => navigate(view, todayString())}>Today</button>
        <button type="button" onClick={() => shift(1)}>Next ›</button>
        <span className="schedule-range-label">{formatRangeLabel(view, date)}</span>
      </div>

      {notice && <p role="status" className="schedule-notice">{notice}</p>}
      {error && (
        <p role="alert">
          Could not load the schedule: {error.message} <button type="button" onClick={reload}>Retry</button>
        </p>
      )}
      {techError && <p role="alert">Could not load technicians: {techError.message}</p>}

      {!loaded && !error ? (
        <p>Loading...</p>
      ) : (
        <div className="schedule-layout">
          <div className="schedule-main">
            {technicians.length === 0 ? (
              <p>No technicians yet.</p>
            ) : (
              <>
                {entries.length === 0 && <p>No bookings in this range.</p>}
                {view === 'day' ? (
                  <DayGrid
                    date={date}
                    technicians={technicians}
                    entries={entries}
                    jobsById={jobsById}
                    onCellClick={handleCellClick}
                    onBlockClick={setSelectedEntry}
                  />
                ) : (
                  <WeekGrid
                    days={weekDays(date)}
                    technicians={technicians}
                    entries={entries}
                    jobsById={jobsById}
                    onCellClick={handleCellClick}
                    onBlockClick={setSelectedEntry}
                  />
                )}
              </>
            )}
          </div>
          <aside className="schedule-side">
            <UnscheduledList jobs={jobs} onBook={handleBookJob} />
          </aside>
        </div>
      )}

      {selectedEntry && (
        <BlockDetailsModal
          entry={selectedEntry}
          job={jobsById[selectedEntry.job_id]}
          technicianName={techNames[selectedEntry.technician_id]}
          onClose={() => setSelectedEntry(null)}
          onEdit={handleEditFromDetails}
          onChanged={handleChanged}
          onRefresh={reload}
        />
      )}
      {booking && (
        <BookingModal
          mode={booking.mode}
          job={bookingJob}
          jobs={jobs}
          technicians={technicians}
          initial={booking.initial}
          entry={booking.entry}
          onClose={() => setBooking(null)}
          onSaved={handleChanged}
        />
      )}
    </div>
  )
}

export default function Schedule() {
  const { profile } = useOutletContext()
  if (profile?.role === 'technician') return <p>Staff only.</p>
  return <ScheduleBoard />
}
```

- [x] **Step 3: Add the route in `src/App.jsx`**

Add the import after `import QueueList from './pages/QueueList'`:

```jsx
import Schedule from './pages/Schedule'
```

and the route after `<Route path="/queues" element={<QueueList />} />`:

```jsx
        <Route path="/schedule" element={<Schedule />} />
```

- [x] **Step 4: Add the nav link in `src/components/AppShell.jsx`**

After the Queues link line, add:

```jsx
          {profile?.role !== 'technician' && <Link to="/schedule">Schedule</Link>}
```

- [x] **Step 5: Compare the panel to the ServiceM8 reference**

The reference screenshot is `docs/staff schedule reference.png` (the Jobs side panel on the right). Open it next to the running panel and confirm the same structure: a status dropdown plus a search box on top; each card has a round letter badge (Q for Quote in orange, W for Work Order in navy, S for a hand-Scheduled job in navy), a coloured line down its left edge, the client name in bold with the job number right-aligned and muted, then the site address, then a muted one-line description. Zenith's navy and orange replace ServiceM8's blue and orange. The reference's "Lead source" line has no equivalent field in this app, so the job description fills that line (owner's decision, 2026-09-21; lead source itself is a separate backlog item). Adjust the CSS only if something is visibly off.

- [x] **Step 6: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean.

- [x] **Step 7: Manual browser check of the board (dev server: `npm run dev`)**

Log in as **office** or **admin**. There are no test jobs yet; create them through the app first: a client named "Schedule Test Client" and jobs for it (`/jobs/new`): one Quote, two Work Order, one more Work Order that you then edit to status Scheduled with no bookings (this is the "Scheduled by hand, no entries" state), and one Completed. Then verify:

- The Schedule nav link appears; `/schedule` opens on the current week with a technician row per technician, and the unscheduled panel lists the Quote ("Needs inspection"), both Work Orders and the hand-Scheduled job ("Needs work scheduling"), but NOT the Completed one. The panel's dropdown (All jobs / Needs inspection / Needs work scheduling) and search box both narrow the list, and each card shows its round Q / W / S badge, client, job number, address and description.
- Day / Week toggle, Prev / Today / Next work; the URL updates (`?view=...&date=...`); browser Back / Forward step through the views; loading `/schedule?view=bogus&date=nope` falls back to the current week.
- Click "Book" on the Quote job's card: the form opens with the job read-only, duration 1 hr; choose a technician and save. Expect the notice "Booked as a confirmed inspection." and an orange block.
- Book a Work Order job: notice "Booked as a tentative hold." and a lighter dashed navy block tagged "Tentative". Book a second hold for the same job; both appear.
- If any check fails, fix it before committing; do not defer.

- [x] **Step 8: Commit**

```bash
git add src/components/UnscheduledList.jsx src/pages/Schedule.jsx src/App.jsx src/components/AppShell.jsx
git commit -m "feat: add Dispatch Board page with unscheduled panel and nav link" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: JobDetail "Schedule" tab

**Files:**
- Create: `src/components/JobScheduleSection.jsx`
- Modify: `src/pages/JobDetail.jsx`

**Interfaces:**
- Consumes: `useJobSchedule`, `useTechnicians` (Task 3), `BookingModal` (Task 5), `ScheduleEntryActions` (Task 6), `scheduleUtils` helpers, `useJob().reload({ silent: true })` (Task 3).
- Produces: `<JobScheduleSection job onJobChanged />` where `job` is the `useJob` job object and `onJobChanged()` is awaited after any change so `JobDetail` refreshes the job's status.

- [x] **Step 1: Write `src/components/JobScheduleSection.jsx`**

```jsx
import { useState } from 'react'
import { useJobSchedule } from '../hooks/useJobSchedule'
import { useTechnicians } from '../hooks/useTechnicians'
import BookingModal from './BookingModal'
import ScheduleEntryActions from './ScheduleEntryActions'
import {
  entryStatusLabel,
  entryTypeLabel,
  formatDayLabel,
  formatTimeRange,
  todayString,
} from '../lib/scheduleUtils'

export default function JobScheduleSection({ job, onJobChanged }) {
  const { entries, loaded, error, reload } = useJobSchedule(job.id)
  const { technicians } = useTechnicians()
  const [booking, setBooking] = useState(null)
  const [notice, setNotice] = useState(null)

  const techNames = Object.fromEntries(technicians.map((tech) => [tech.id, tech.full_name]))

  async function handleChanged(message) {
    setBooking(null)
    setNotice(message)
    await reload()
    await onJobChanged()
  }

  if (error) {
    return (
      <p role="alert">
        Could not load bookings: {error.message} <button type="button" onClick={reload}>Retry</button>
      </p>
    )
  }
  if (!loaded) return <p>Loading...</p>

  return (
    <div>
      <div className="job-detail-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setBooking({ mode: 'book' })}
        >
          Book
        </button>
      </div>

      {notice && <p role="status" className="schedule-notice">{notice}</p>}

      {entries.length === 0 ? (
        <p>No bookings yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Technician</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDayLabel(entry.scheduled_date)}</td>
                <td>{formatTimeRange(entry.start_time, entry.end_time)}</td>
                <td>{techNames[entry.technician_id] ?? 'Unknown'}</td>
                <td>{entryTypeLabel(entry)} · {entryStatusLabel(entry)}</td>
                <td>
                  <ScheduleEntryActions
                    entry={entry}
                    jobEntries={entries}
                    jobStatus={job.status}
                    onEdit={() => setBooking({ mode: 'edit', entry })}
                    onChanged={handleChanged}
                    onRefresh={reload}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {booking && (
        <BookingModal
          mode={booking.mode}
          job={job}
          technicians={technicians}
          initial={{ date: todayString() }}
          entry={booking.entry}
          onClose={() => setBooking(null)}
          onSaved={handleChanged}
        />
      )}
    </div>
  )
}
```

- [x] **Step 2: Wire the tab into `src/pages/JobDetail.jsx`**

Add the import after `import RoofReportSection from '../components/RoofReportSection'`:

```jsx
import JobScheduleSection from '../components/JobScheduleSection'
```

Replace:

```jsx
const STAFF_TABS = ['Details', 'Job Contact', 'Billing', 'Invoicing', 'Roof Report']
```

with:

```jsx
const STAFF_TABS = ['Details', 'Job Contact', 'Schedule', 'Billing', 'Invoicing', 'Roof Report']
```

After the line `{activeTab === 'Roof Report' && isStaff && <RoofReportSection job={job} />}` add:

```jsx
            {activeTab === 'Schedule' && isStaff && (
              <JobScheduleSection job={job} onJobChanged={() => reload({ silent: true })} />
            )}
```

- [x] **Step 3: Lint and build**

Run: `npm run lint` and `npm run build`. Expected: clean.

- [x] **Step 4: Manual browser check**

As office or admin, open a job: the Schedule tab appears between Job Contact and Billing. Verify: "No bookings yet." on an unbooked job; Book opens the form with the job read-only and today's date; after booking the row appears, the notice shows, and (for a Work Order job booked directly-confirmed later) the Details tab's Status updates without a page reload. As **technician**, open a job: no Schedule tab.

- [x] **Step 5: Commit**

```bash
git add src/components/JobScheduleSection.jsx src/pages/JobDetail.jsx
git commit -m "feat: add Schedule tab to JobDetail" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification, documentation, cleanup and push

**Files:**
- Modify: `docs/superpowers/plans/2026-09-21-shadow-schedule-phase2.md` (check off steps)
- Modify: `CLAUDE.md`

- [x] **Step 1: Full manual browser verification, all three roles**

Use the "Schedule Test Client" jobs from Task 7 (create more as needed). Confirm every item, as **office** (repeat the key ones as **admin**):

- [x] A job set to Scheduled by hand with NO schedule entries appears in the unscheduled panel as "Needs work scheduling"; booking it creates a tentative hold and its status stays Scheduled.
- [x] Inspection booking (Quote job) is a confirmed orange block with no tentative UI, and the job stays Quote.
- [x] Work booking on a Work Order job is tentative; a second hold for the same job coexists; the card shows "2 tentative holds".
- [x] Confirming one hold shows the "drops the other 1 tentative hold" warning; afterwards the sibling is gone from the grid and the job's status is Scheduled (notice says so).
- [x] Booking a second work day on that job is created confirmed directly (solid navy), no tentative step.
- [x] Completed job: it is not in the unscheduled panel; on its Schedule tab, Book defaults to 1 hr, saves as a confirmed work block, and the job's status stays Completed.
- [x] Remove always asks "Are you sure"; removing one of two confirmed work days does not change status; removing the last one adds the "goes back to Work Order" line and the status becomes Work Order.
- [x] Edit changes technician / date / time, persists after a page reload, and does not change the block's Inspection/Work type or its Tentative/Confirmed status.
- [x] Overlapping blocks for one technician split into stacked lanes in Day view; a booking 7:00pm-8:00pm and one 5:00am-6:00am are pinned to the right/left edge with their real times shown.
- [x] "All day" sets the start to 6:00 am and locks the start field; with a 4:00 pm start, durations of 8 hr and over are disabled.
- [x] Bookmark a Week URL and a Day URL and reopen them; Back/Forward step through views; `/schedule?view=bogus&date=nope` falls back to the current week.
- [x] The Jobs list's Scheduled column reflects new confirmed bookings, and a technician who is booked (confirmed) on a job sees it in their Jobs list.
- [x] As **technician**: no Schedule nav link, no Schedule tab on a job, and opening `/schedule` directly shows "Staff only."
- [x] Trigger a failure path once (e.g. in one browser tab remove a booking, then Confirm/Remove it in a stale second tab): a clear message appears and the modal does not hang on a spinner.
- [x] `npm run lint` and `npm run build` are clean.

Report any failure and fix it before continuing.

- [x] **Step 2: Clean up the test data**

Ask the user to run this in the Supabase SQL Editor (jobs first, which cascades their schedule entries, then the client):

```sql
delete from public.jobs where client_id in (select id from public.clients where name = 'Schedule Test Client');
delete from public.clients where name = 'Schedule Test Client';
```

- [x] **Step 3: Update `CLAUDE.md`**

Add a "Shadow Schedule — Phase 2 (Dispatch Board)" entry under "What's Built" directly after the Phase 1 entry, covering: the `create_schedule_entry()` Completed branch and its migration; the `/schedule` page (Day + Week, URL-held view/date, stacked sub-lanes, chips, colours, unscheduled panel incl. the hand-Scheduled case); the shared `BookingModal` (start + duration picker, All day rule, defaults) and `ScheduleEntryActions`; the JobDetail Schedule tab; the local-date rule (no `toISOString()`) and the no-stuck-spinners rule; the deliberate simplification vs. the ServiceM8 ideal (already noted in the Phase 1 entry); the unscheduled panel following the ServiceM8 reference screenshot (`docs/staff schedule reference.png`), with the job description standing in for ServiceM8's "Lead source" line and a lead-source field noted as a separate backlog item; and that the manual browser verification passed. Then replace the Client Feedback List line `6. Shadow schedule — calendar UI with color-coded confirmed/unconfirmed jobs, hidden from field staff when unconfirmed. Not yet scoped in detail.` with `6. Shadow schedule — Phases 1 and 2 done (data model/access, then the Dispatch Board), see "What's Built"; Phase 3 (drag-and-drop) not started.`

- [x] **Step 4: Check off this plan and commit**

```bash
sed -i 's/^- \[ \] /- [x] /' docs/superpowers/plans/2026-09-21-shadow-schedule-phase2.md
git add CLAUDE.md docs/superpowers/plans/2026-09-21-shadow-schedule-phase2.md
git commit -m "docs: record Shadow Schedule Phase 2 completion in CLAUDE.md" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [x] **Step 5: Push (only with the user's go-ahead) and report with the progress checklist**

Ask the user before pushing (a push to `main` auto-deploys to Vercel). When pushed, end the message with the running checklist covering all 3 phases (Phase 1 done, Phase 2 done, Phase 3 not started), per the user's standing instruction.
