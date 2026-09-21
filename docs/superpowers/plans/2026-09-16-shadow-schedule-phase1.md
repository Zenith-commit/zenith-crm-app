# Shadow Schedule Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `schedule_entries` table, its RLS, three write-capable SQL functions (`create_schedule_entry`, `confirm_schedule_entry`, `remove_schedule_entry`), and extend the technician access model (`technician_owns_job()`, `technician_has_job_for_client()`, `get_my_jobs()`) so a confirmed schedule entry grants access the same way `jobs.assigned_to` already does — with full regression coverage of every existing feature that change touches. No calendar UI yet (Phases 2-3) — this phase ends with Dashboard/JobList showing each job's real next confirmed date/time.

**Architecture:** One new table (`schedule_entries`) carries every dispatch booking — inspection or work, tentative or confirmed. All state transitions with side effects (deciding entry type/initial status, confirming, removing) go through three `security invoker` SQL functions, mirroring this project's existing `create_invoice()`/`apply_bundle_to_job()` pattern, so the business rules live in one place instead of being re-implemented by every future caller. `technician_owns_job()` is the single most-reused helper in this codebase (six existing dependents); extending it to also recognize a confirmed schedule entry automatically extends all six without touching their own policy definitions — but that same leverage means it needs the heaviest regression testing in this plan.

**Tech Stack:** React + Vite, Supabase (Postgres RLS + SQL functions). No automated JS test framework exists in this repo — verification follows this project's established pattern of live RLS/function checks run manually in the Supabase SQL Editor (DDL and DO-block verification always in separate submissions — see Global Constraints), plus manual browser verification for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md`

## Global Constraints

- This project has no Supabase CLI/service-role access configured in this environment — every SQL file must be run by the human via the Supabase Dashboard SQL Editor, not executed directly by the agent.
- **Never combine real DDL (`create table`, `create or replace function`, `drop function`) with a `DO $$ ... raise exception $$` verification block in the same SQL Editor submission.** A prior incident in this project (see `docs/superpowers/specs/2026-09-16-shadow-schedule-design.md`'s background and this project's memory) had DDL silently rolled back because it shared a submission with a self-terminating verification block. Always: DDL submission → separate plain `select` sanity check → separate `DO` block verification, three distinct submissions.
- `uuid` has no `MAX`/`MIN` aggregate in Postgres — cast to `text` first if a test ever needs one.
- A raw SQL Editor session has no `request.jwt.claims` set by default — every impersonation check must wrap the query in `set local role authenticated; set local request.jwt.claims to '{"sub": "<uuid>"}';` inside an explicit `begin ... rollback;` block, per this project's established pattern (see `docs/superpowers/plans/2026-09-11-queue-tab.md` Task 1 for a worked example).
- `entry_type` is fixed at creation from `jobs.status` at that moment and is never recalculated later — do not add logic anywhere that re-derives or changes `entry_type` after insert.
- Only `entry_type = 'work'` entries ever pass through `status = 'tentative'`. Inspection entries are always inserted directly as `'confirmed'` — this is enforced inside `create_schedule_entry()`, not left to any caller to get right.
- `jobs.status` auto-transitions (`Work Order -> Scheduled` on first confirmed work entry, `Scheduled -> Work Order` on removing a job's last confirmed work entry) only ever fire for `entry_type = 'work'`. Never touch `jobs.status` for an inspection entry.
- The `Scheduled -> Work Order` revert is a fixed target, not "whatever status the job had before" — this app has no prior-status-history column anywhere, and this phase does not add one.
- Do not touch `jobs.assigned_to`, the manual technician `<select>` on `JobForm`, or any bundle/invoice/roof-report code — this phase only adds a new, additive access path alongside `assigned_to`.
- No calendar UI, no drag-and-drop, no new npm dependency in this phase — that is Phases 2 and 3.

---

### Task 1: `schedule_entries` table and RLS

**Files:**
- Create: `supabase/schema/018_schedule_entries.sql`
- Create: `supabase/policies/022_schedule_entries_policies.sql`

**Interfaces:**
- Produces: types `public.schedule_entry_type` (`'inspection' | 'work'`), `public.schedule_entry_status` (`'tentative' | 'confirmed'`), and table `public.schedule_entries(id uuid, job_id uuid, technician_id uuid, entry_type public.schedule_entry_type, status public.schedule_entry_status, scheduled_date date, start_time time, end_time time, created_by uuid, created_at timestamptz)`. Consumed by Task 2 (`create_schedule_entry`), Task 3 (`confirm_schedule_entry`), Task 4 (`remove_schedule_entry`), and Task 5 (the extended `technician_owns_job()`/`technician_has_job_for_client()`/`get_my_jobs()`).

- [x] **Step 1: Write the schema file**

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

- [x] **Step 2: Write the RLS policy file**

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
-- is extended in Task 5 to read this very table, and routing through it
-- here would be circular.
create policy "schedule_entries_technician_select" on public.schedule_entries
  for select
  using (
    public.current_app_role() = 'technician'
    and status = 'confirmed'
    and technician_id = auth.uid()
  );
```

- [x] **Step 3: Run both files against the live Supabase project**

Ask the user to open the Supabase Dashboard SQL Editor and run the contents of `supabase/schema/018_schedule_entries.sql`, then `supabase/policies/022_schedule_entries_policies.sql`, each as its own submission, and confirm both ran with no errors.

- [x] **Step 4: Look up the three test-account UUIDs**

Ask the user to run this and report back the three ids (skip if already known from a prior session):

```sql
select id, role from public.users where role in ('admin', 'office', 'technician');
```

- [x] **Step 5: Run the live RLS verification block**

Substitute the real UUIDs in place of `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>`, then ask the user to run this whole block as its own separate submission (it rolls back at the end, so no test rows are left behind):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999801';
  v_job_id uuid := '99999999-9999-9999-9999-999999999811';
  v_entry_a uuid;
  v_entry_b uuid;
begin
  insert into public.clients (id, name) values (v_client_id, 'Schedule RLS Test Client');
  insert into public.jobs (id, client_id, status) values (v_job_id, v_client_id, 'Work Order');

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_job_id, '<TECH_ID>', 'work', 'confirmed', '2026-10-01', '08:00', '16:00', '<ADMIN_ID>')
  returning id into v_entry_a;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_job_id, '<TECH_ID>', 'work', 'tentative', '2026-10-02', '08:00', '16:00', '<ADMIN_ID>')
  returning id into v_entry_b;

  if (select count(*) from public.schedule_entries where job_id = v_job_id) <> 2 then
    raise exception 'admin should see both inserted entries';
  end if;

  update public.schedule_entries set start_time = '09:00' where id = v_entry_b;
  if (select start_time from public.schedule_entries where id = v_entry_b) <> '09:00' then
    raise exception 'admin should be able to update an entry';
  end if;

  delete from public.schedule_entries where id = v_entry_b;
  if (select count(*) from public.schedule_entries where id = v_entry_b) <> 0 then
    raise exception 'admin delete should have removed the row';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_job_id uuid := '99999999-9999-9999-9999-999999999811';
  v_entry_c uuid;
begin
  if (select count(*) from public.schedule_entries where job_id = v_job_id) <> 1 then
    raise exception 'office should be able to select the remaining entry';
  end if;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_job_id, '<TECH_ID>', 'work', 'tentative', '2026-10-03', '08:00', '16:00', '<OFFICE_ID>')
  returning id into v_entry_c;

  update public.schedule_entries set end_time = '17:00' where id = v_entry_c;
  if (select end_time from public.schedule_entries where id = v_entry_c) <> '17:00' then
    raise exception 'office should be able to update an entry';
  end if;

  delete from public.schedule_entries where id = v_entry_c;
  if (select count(*) from public.schedule_entries where id = v_entry_c) <> 0 then
    raise exception 'office delete should have removed the row';
  end if;

  -- leave one tentative entry for <TECH_ID> in place so the technician
  -- block below can confirm it's correctly hidden despite matching their
  -- own technician_id.
  insert into public.schedule_entries
    (id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    ('99999999-9999-9999-9999-999999999821', v_job_id, '<TECH_ID>', 'work', 'tentative', '2026-10-04', '08:00', '16:00', '<OFFICE_ID>');
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_job_id uuid := '99999999-9999-9999-9999-999999999811';
  v_confirmed_id uuid := '99999999-9999-9999-9999-999999999812';
  v_rowcount int;
begin
  -- sanity: recreate the confirmed entry lost to the rollback boundary
  -- doesn't apply here since we're still inside the same transaction --
  -- the admin block's v_entry_a is still present. Confirm technician sees
  -- exactly that one row, not the tentative one left by office.
  if (select count(*) from public.schedule_entries where job_id = v_job_id) <> 1 then
    raise exception 'technician should see exactly 1 confirmed entry, not the tentative one';
  end if;

  if (select status from public.schedule_entries where job_id = v_job_id) <> 'confirmed' then
    raise exception 'the one entry technician can see must be confirmed';
  end if;

  begin
    insert into public.schedule_entries
      (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
    values
      (v_job_id, '<TECH_ID>', 'work', 'confirmed', '2026-10-05', '08:00', '16:00', '<TECH_ID>');
    raise exception 'technician should not be able to insert a schedule_entries row';
  exception when insufficient_privilege then
    null; -- expected
  end;

  update public.schedule_entries set start_time = '10:00' where job_id = v_job_id;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then
    raise exception 'technician should not be able to update any schedule_entries row (rows affected: %)', v_rowcount;
  end if;

  delete from public.schedule_entries where job_id = v_job_id;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then
    raise exception 'technician should not be able to delete any schedule_entries row (rows affected: %)', v_rowcount;
  end if;

  raise notice 'All schedule_entries RLS checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: All schedule_entries RLS checks passed.` and no unexpected `ERROR`.

- [x] **Step 6: Commit**

```bash
git add supabase/schema/018_schedule_entries.sql supabase/policies/022_schedule_entries_policies.sql
git commit -m "feat: add schedule_entries table and RLS"
```

---

### Task 2: `create_schedule_entry()` function

**Files:**
- Create: `supabase/policies/023_schedule_entry_functions.sql`

**Interfaces:**
- Consumes: `public.schedule_entries` (Task 1), `public.jobs`.
- Produces: `public.create_schedule_entry(target_job_id uuid, target_technician_id uuid, target_date date, target_start time, target_end time) returns public.schedule_entries`. Consumed by Task 6's frontend (Phase 2/3) and by Task 3/4's verification setup (this plan calls it directly via SQL to build test fixtures).

- [x] **Step 1: Write the function**

```sql
-- Inserts one schedule_entries row, deciding entry_type and initial status
-- from the job's current state. This is the single place that owns the
-- "inspection is always direct-confirm; work is tentative unless the job
-- already has a confirmed work entry" rule, so callers never have to
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

comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs always get a directly-confirmed inspection entry. Work-Order-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';
```

- [x] **Step 2: Run the file against the live Supabase project**

Ask the user to run `supabase/policies/023_schedule_entry_functions.sql` in the SQL Editor as its own submission and confirm no errors.

- [x] **Step 3: Run the live verification block**

Substitute the real `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>`, then ask the user to run this as a separate submission:

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999802';
  v_quote_job uuid := '99999999-9999-9999-9999-999999999831';
  v_wo_job uuid := '99999999-9999-9999-9999-999999999832';
  v_entry public.schedule_entries;
begin
  insert into public.clients (id, name) values (v_client_id, 'Create Entry Test Client');
  insert into public.jobs (id, client_id, status) values (v_quote_job, v_client_id, 'Quote');
  insert into public.jobs (id, client_id, status) values (v_wo_job, v_client_id, 'Work Order');

  -- Quote-stage job: direct-confirm inspection, no status change.
  select * into v_entry from public.create_schedule_entry(v_quote_job, '<TECH_ID>', '2026-10-10', '09:00', '10:00');
  if v_entry.entry_type <> 'inspection' or v_entry.status <> 'confirmed' then
    raise exception 'Quote-stage entry should be a directly-confirmed inspection, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_quote_job) <> 'Quote' then
    raise exception 'booking an inspection must never change jobs.status';
  end if;

  -- Work-Order-stage job, no existing confirmed work entry: tentative.
  select * into v_entry from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-11', '08:00', '16:00');
  if v_entry.entry_type <> 'work' or v_entry.status <> 'tentative' then
    raise exception 'first Work-Order-stage entry should be tentative, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_wo_job) <> 'Work Order' then
    raise exception 'a tentative entry must never change jobs.status';
  end if;

  -- Simulate "this job already has a confirmed work entry" by directly
  -- confirming the one just created (Task 3 builds the real confirm
  -- function; this plain update is only to set up this test's precondition).
  update public.schedule_entries set status = 'confirmed' where id = v_entry.id;

  -- Work-Order-stage job that already has a confirmed work entry: the
  -- next entry is also directly confirmed, and since jobs.status is still
  -- 'Work Order' at this point (only confirm_schedule_entry advances it,
  -- per Task 3), this direct-confirm path advances it too.
  select * into v_entry from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-12', '08:00', '16:00');
  if v_entry.entry_type <> 'work' or v_entry.status <> 'confirmed' then
    raise exception 'a second day on an already-confirmed job should be directly confirmed, got type=% status=%', v_entry.entry_type, v_entry.status;
  end if;
  if (select status from public.jobs where id = v_wo_job) <> 'Scheduled' then
    raise exception 'jobs.status should now be Scheduled';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_wo_job uuid := '99999999-9999-9999-9999-999999999832';
begin
  begin
    perform public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-13', '08:00', '16:00');
    raise exception 'technician should not be able to call create_schedule_entry directly';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'create_schedule_entry checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: create_schedule_entry checks passed.` and no unexpected `ERROR`.

- [x] **Step 4: Commit**

```bash
git add supabase/policies/023_schedule_entry_functions.sql
git commit -m "feat: add create_schedule_entry() function"
```

---

### Task 3: `confirm_schedule_entry()` function

**Files:**
- Modify: `supabase/policies/023_schedule_entry_functions.sql`

**Interfaces:**
- Consumes: `public.schedule_entries`, `public.jobs`, `public.create_schedule_entry()` (Task 2, used only to build test fixtures).
- Produces: `public.confirm_schedule_entry(target_entry_id uuid) returns public.schedule_entries`. Consumed by Task 6's frontend (Phase 2/3).

- [x] **Step 1: Append the function to the same file**

Add to the end of `supabase/policies/023_schedule_entry_functions.sql`:

```sql
-- Promotes one tentative work entry to confirmed and drops every other
-- tentative entry for the same job (the "pick one, drop the rest" rule).
-- Guard: only ever applies to entry_type=work, status=tentative rows --
-- confirming an already-confirmed row, an inspection row, or a bad id all
-- raise rather than silently doing nothing.
create or replace function public.confirm_schedule_entry(target_entry_id uuid)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
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

comment on function public.confirm_schedule_entry(uuid) is 'Promotes one tentative work entry to confirmed, deletes every other tentative entry for the same job, and advances jobs.status Work Order -> Scheduled if not already there. Raises if the target row is not a tentative work entry.';
```

- [x] **Step 2: Run the file against the live Supabase project**

Ask the user to re-run the full `supabase/policies/023_schedule_entry_functions.sql` file (both functions — `create or replace function` is safe to re-run) as its own submission and confirm no errors.

- [x] **Step 3: Run the live verification block**

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999803';
  v_wo_job uuid := '99999999-9999-9999-9999-999999999841';
  v_quote_job uuid := '99999999-9999-9999-9999-999999999842';
  v_entry_a public.schedule_entries;
  v_entry_b public.schedule_entries;
  v_inspection public.schedule_entries;
  v_result public.schedule_entries;
begin
  insert into public.clients (id, name) values (v_client_id, 'Confirm Entry Test Client');
  insert into public.jobs (id, client_id, status) values (v_wo_job, v_client_id, 'Work Order');
  insert into public.jobs (id, client_id, status) values (v_quote_job, v_client_id, 'Quote');

  -- Two tentative candidates for the same job.
  select * into v_entry_a from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-20', '08:00', '16:00');
  select * into v_entry_b from public.create_schedule_entry(v_wo_job, '<TECH_ID>', '2026-10-21', '08:00', '16:00');
  if v_entry_a.status <> 'tentative' or v_entry_b.status <> 'tentative' then
    raise exception 'both candidates should start tentative';
  end if;

  select * into v_result from public.confirm_schedule_entry(v_entry_a.id);
  if v_result.status <> 'confirmed' then
    raise exception 'confirmed entry should have status confirmed';
  end if;
  if (select count(*) from public.schedule_entries where id = v_entry_b.id) <> 0 then
    raise exception 'sibling tentative entry should have been deleted';
  end if;
  if (select status from public.jobs where id = v_wo_job) <> 'Scheduled' then
    raise exception 'jobs.status should now be Scheduled';
  end if;

  -- Guard: confirming an already-confirmed row raises.
  begin
    perform public.confirm_schedule_entry(v_entry_a.id);
    raise exception 'confirming an already-confirmed row should raise';
  exception when others then
    if sqlerrm not like '%is not a tentative work entry%' then
      raise;
    end if;
  end;

  -- Guard: confirming an inspection entry raises.
  select * into v_inspection from public.create_schedule_entry(v_quote_job, '<TECH_ID>', '2026-10-22', '09:00', '10:00');
  begin
    perform public.confirm_schedule_entry(v_inspection.id);
    raise exception 'confirming an inspection entry should raise';
  exception when others then
    if sqlerrm not like '%is not a tentative work entry%' then
      raise;
    end if;
  end;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999804';
  v_wo_job uuid := '99999999-9999-9999-9999-999999999843';
  v_entry public.schedule_entries;
begin
  -- Set up a fresh tentative entry as office would, but we're now
  -- impersonating technician for the actual confirm attempt below --
  -- reuse the already-committed-in-this-transaction v_wo_job entries
  -- from the office block isn't visible here since it's a different DO
  -- block variable scope, so look up an existing tentative row directly.
  -- None exists at this point (the only one from the office block was
  -- consumed), so instead verify technician cannot even see a row to
  -- attempt confirming -- the more realistic failure mode.
  if (select count(*) from public.schedule_entries where technician_id = '<TECH_ID>' and status = 'tentative') <> 0 then
    raise exception 'no tentative rows should be visible to technician at all';
  end if;

  raise notice 'confirm_schedule_entry checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: confirm_schedule_entry checks passed.` and no unexpected `ERROR`.

- [x] **Step 4: Commit**

```bash
git add supabase/policies/023_schedule_entry_functions.sql
git commit -m "feat: add confirm_schedule_entry() function"
```

---

### Task 4: `remove_schedule_entry()` function

**Files:**
- Modify: `supabase/policies/023_schedule_entry_functions.sql`

**Interfaces:**
- Consumes: `public.schedule_entries`, `public.jobs`.
- Produces: `public.remove_schedule_entry(target_entry_id uuid) returns void`. Consumed by Task 6's frontend (Phase 2/3).

- [x] **Step 1: Append the function to the same file**

```sql
-- Deletes one entry and, if it was a job's last remaining confirmed work
-- entry, reverts jobs.status Scheduled -> Work Order. A no-op (not an
-- error) if the caller's RLS doesn't let the delete match any row --
-- same fail-closed shape as apply_bundle_to_job()'s silent-null pattern.
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

comment on function public.remove_schedule_entry(uuid) is 'Deletes one schedule entry. If it was a job''s last remaining confirmed work entry and the job is still exactly Scheduled, reverts jobs.status to Work Order. Never touches jobs.status for an inspection entry, or for a job whose status has since moved past Scheduled (e.g. Completed).';
```

- [x] **Step 2: Run the file against the live Supabase project**

Ask the user to re-run the full `supabase/policies/023_schedule_entry_functions.sql` file (all three functions) as its own submission and confirm no errors.

- [x] **Step 3: Run the live verification block**

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999805';
  v_multi_day_job uuid := '99999999-9999-9999-9999-999999999851';
  v_quote_job uuid := '99999999-9999-9999-9999-999999999852';
  v_completed_job uuid := '99999999-9999-9999-9999-999999999853';
  v_day1 uuid;
  v_day2 uuid;
  v_inspection uuid;
  v_leftover uuid;
begin
  insert into public.clients (id, name) values (v_client_id, 'Remove Entry Test Client');
  insert into public.jobs (id, client_id, status) values (v_multi_day_job, v_client_id, 'Scheduled');
  insert into public.jobs (id, client_id, status) values (v_quote_job, v_client_id, 'Quote');
  insert into public.jobs (id, client_id, status) values (v_completed_job, v_client_id, 'Completed');

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_multi_day_job, '<TECH_ID>', 'work', 'confirmed', '2026-10-30', '08:00', '16:00', '<OFFICE_ID>')
  returning id into v_day1;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_multi_day_job, '<TECH_ID>', 'work', 'confirmed', '2026-10-31', '08:00', '16:00', '<OFFICE_ID>')
  returning id into v_day2;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_quote_job, '<TECH_ID>', 'inspection', 'confirmed', '2026-10-15', '09:00', '10:00', '<OFFICE_ID>')
  returning id into v_inspection;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_completed_job, '<TECH_ID>', 'work', 'confirmed', '2026-09-01', '08:00', '16:00', '<OFFICE_ID>')
  returning id into v_leftover;

  -- Removing one of two confirmed work days should not revert status.
  perform public.remove_schedule_entry(v_day1);
  if (select status from public.jobs where id = v_multi_day_job) <> 'Scheduled' then
    raise exception 'status should stay Scheduled while a confirmed work day remains';
  end if;

  -- Removing the last remaining confirmed work day should revert status.
  perform public.remove_schedule_entry(v_day2);
  if (select status from public.jobs where id = v_multi_day_job) <> 'Work Order' then
    raise exception 'status should revert to Work Order once no confirmed work day remains';
  end if;

  -- Removing a confirmed inspection entry must never touch jobs.status.
  perform public.remove_schedule_entry(v_inspection);
  if (select status from public.jobs where id = v_quote_job) <> 'Quote' then
    raise exception 'removing an inspection entry must never change jobs.status';
  end if;

  -- Removing a job's last confirmed work entry when the job has since
  -- moved to Completed must not pull it back to Work Order.
  perform public.remove_schedule_entry(v_leftover);
  if (select status from public.jobs where id = v_completed_job) <> 'Completed' then
    raise exception 'a Completed job must never be reverted by removing an old entry';
  end if;

  raise notice 'remove_schedule_entry office checks passed.';
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_client_id uuid := '99999999-9999-9999-9999-999999999806';
  v_job_id uuid := '99999999-9999-9999-9999-999999999854';
  v_entry_id uuid;
begin
  -- This DO block runs under a different role than the entry was created
  -- under; set up fixture data first while still impersonating technician
  -- is not possible (technician has no insert policy), so instead prove
  -- the no-op behavior against a row technician cannot see at all: a
  -- syntactically valid but nonexistent id.
  perform public.remove_schedule_entry('00000000-0000-0000-0000-000000000000');
  -- No exception expected -- a delete matching zero rows is a silent
  -- no-op by design, mirroring apply_bundle_to_job()'s existing pattern.
  raise notice 'remove_schedule_entry technician no-op check passed.';
end $$;

rollback;
```

Expected: `NOTICE: remove_schedule_entry office checks passed.` and `NOTICE: remove_schedule_entry technician no-op check passed.`, no unexpected `ERROR`.

- [x] **Step 4: Commit**

```bash
git add supabase/policies/023_schedule_entry_functions.sql
git commit -m "feat: add remove_schedule_entry() function"
```

---

### Task 5: Extend the technician access model

**Files:**
- Modify: `supabase/policies/001_helper_function.sql` (fresh-install source of truth for `technician_owns_job()`/`technician_has_job_for_client()`)
- Modify: `supabase/policies/004_jobs_policies.sql` (fresh-install source of truth for `get_my_jobs()`)
- Create: `supabase/migrations/2026-09-16_schedule_access_model.sql` (the exact statements to run against the already-live database)

**Interfaces:**
- Consumes: `public.schedule_entries` (Task 1).
- Produces: `technician_owns_job(target_job_id uuid)` and `technician_has_job_for_client(target_client_id uuid)` now also return `true` when the calling technician has a confirmed schedule entry for the job/a job for that client, in addition to the existing `assigned_to` check. `get_my_jobs()` gains three new return columns: `next_scheduled_date date`, `next_scheduled_start_time time`, `additional_scheduled_days integer`. Consumed by Task 6 (frontend display) and by every existing dependent listed in the regression test below — none of those dependents' own files need to change.

- [x] **Step 1: Update `technician_owns_job()` and `technician_has_job_for_client()` in `001_helper_function.sql`**

Replace the two function bodies in `supabase/policies/001_helper_function.sql` (leave `current_app_role()` untouched):

```sql
-- Whether the given job is assigned to the calling technician, either
-- directly (jobs.assigned_to) or via a confirmed schedule_entries row --
-- the second path covers a technician scheduled for part of a multi-day,
-- multi-technician job who isn't the job's single assigned_to value.
create or replace function public.technician_owns_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where id = target_job_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.schedule_entries
    where job_id = target_job_id
      and technician_id = auth.uid()
      and status = 'confirmed'
  );
$$;

-- Whether the calling technician has any job assigned to them (directly
-- or via a confirmed schedule entry) for the given client. Same
-- reasoning as technician_owns_job() above.
create or replace function public.technician_has_job_for_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where client_id = target_client_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.jobs j
    join public.schedule_entries se on se.job_id = j.id
    where j.client_id = target_client_id
      and se.technician_id = auth.uid()
      and se.status = 'confirmed'
  );
$$;
```

- [x] **Step 2: Update `get_my_jobs()` in `004_jobs_policies.sql`**

Replace the `get_my_jobs()` definition in `supabase/policies/004_jobs_policies.sql`:

```sql
create or replace function public.get_my_jobs()
returns table (
  id uuid,
  job_number integer,
  client_id uuid,
  status public.job_status,
  description text,
  site_address text,
  created_at timestamptz,
  updated_at timestamptz,
  next_scheduled_date date,
  next_scheduled_start_time time,
  additional_scheduled_days integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id, j.job_number, j.client_id, j.status, j.description, j.site_address, j.created_at, j.updated_at,
    next_entry.scheduled_date,
    next_entry.start_time,
    coalesce(other_count.cnt, 0)
  from public.jobs j
  left join lateral (
    select se.scheduled_date, se.start_time
    from public.schedule_entries se
    where se.job_id = j.id and se.status = 'confirmed'
    order by se.scheduled_date asc, se.start_time asc
    limit 1
  ) next_entry on true
  left join lateral (
    select greatest(count(*) - 1, 0) as cnt
    from public.schedule_entries se2
    where se2.job_id = j.id and se2.status = 'confirmed'
  ) other_count on true
  where j.assigned_to = auth.uid()
     or exists (
       select 1 from public.schedule_entries se3
       where se3.job_id = j.id and se3.technician_id = auth.uid() and se3.status = 'confirmed'
     );
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs -- via jobs.assigned_to or a confirmed schedule_entries row -- including job_number, site_address, and the soonest confirmed date/time plus a count of any additional confirmed days, without quoted_price/job_type (both dropped from the table) or invoiced status.';
```

- [x] **Step 3: Write the live migration file**

```sql
-- 2026-09-16_schedule_access_model.sql
-- Extends the technician access model so a confirmed schedule_entries row
-- grants job/client access the same way jobs.assigned_to already does,
-- and adds scheduling columns to get_my_jobs(). Run against the live
-- database in the same order as the three statements below: the two
-- create-or-replace calls are safe to run as-is (signature unchanged),
-- but get_my_jobs() changes its return columns, so it must be dropped
-- before being recreated.

create or replace function public.technician_owns_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where id = target_job_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.schedule_entries
    where job_id = target_job_id
      and technician_id = auth.uid()
      and status = 'confirmed'
  );
$$;

create or replace function public.technician_has_job_for_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where client_id = target_client_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.jobs j
    join public.schedule_entries se on se.job_id = j.id
    where j.client_id = target_client_id
      and se.technician_id = auth.uid()
      and se.status = 'confirmed'
  );
$$;

drop function public.get_my_jobs();

create function public.get_my_jobs()
returns table (
  id uuid,
  job_number integer,
  client_id uuid,
  status public.job_status,
  description text,
  site_address text,
  created_at timestamptz,
  updated_at timestamptz,
  next_scheduled_date date,
  next_scheduled_start_time time,
  additional_scheduled_days integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id, j.job_number, j.client_id, j.status, j.description, j.site_address, j.created_at, j.updated_at,
    next_entry.scheduled_date,
    next_entry.start_time,
    coalesce(other_count.cnt, 0)
  from public.jobs j
  left join lateral (
    select se.scheduled_date, se.start_time
    from public.schedule_entries se
    where se.job_id = j.id and se.status = 'confirmed'
    order by se.scheduled_date asc, se.start_time asc
    limit 1
  ) next_entry on true
  left join lateral (
    select greatest(count(*) - 1, 0) as cnt
    from public.schedule_entries se2
    where se2.job_id = j.id and se2.status = 'confirmed'
  ) other_count on true
  where j.assigned_to = auth.uid()
     or exists (
       select 1 from public.schedule_entries se3
       where se3.job_id = j.id and se3.technician_id = auth.uid() and se3.status = 'confirmed'
     );
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs -- via jobs.assigned_to or a confirmed schedule_entries row -- including job_number, site_address, and the soonest confirmed date/time plus a count of any additional confirmed days, without quoted_price/job_type (both dropped from the table) or invoiced status.';
```

- [x] **Step 4: Run the migration against the live Supabase project**

Ask the user to run `supabase/migrations/2026-09-16_schedule_access_model.sql` in the SQL Editor as its own submission and confirm no errors. Then ask them to run this plain, separate `select` to independently confirm `get_my_jobs()`'s new signature is actually live (do not trust the DDL submission alone):

```sql
select pg_get_function_result(oid) from pg_proc where proname = 'get_my_jobs';
```

Expected: the result string contains `next_scheduled_date date, next_scheduled_start_time time, additional_scheduled_days integer`.

- [x] **Step 5: Run the full regression verification block**

This is the highest-blast-radius change in this phase — `technician_owns_job()` gates six existing features. Substitute `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>`, then ask the user to run this as its own separate submission:

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
declare
  v_client_x uuid := '99999999-9999-9999-9999-999999999901';
  v_client_y uuid := '99999999-9999-9999-9999-999999999902';
  v_client_z uuid := '99999999-9999-9999-9999-999999999903';
  v_job_x uuid := '99999999-9999-9999-9999-999999999911'; -- assigned_to = TECH, no schedule entries
  v_job_y uuid := '99999999-9999-9999-9999-999999999912'; -- assigned_to = null, confirmed schedule entry for TECH
  v_job_z uuid := '99999999-9999-9999-9999-999999999913'; -- assigned_to = null, no schedule entries
  v_bundle_id uuid := '99999999-9999-9999-9999-999999999921';
  v_material_id uuid;
begin
  insert into public.clients (id, name) values
    (v_client_x, 'Regression Client X'),
    (v_client_y, 'Regression Client Y'),
    (v_client_z, 'Regression Client Z');

  insert into public.jobs (id, client_id, status, assigned_to) values
    (v_job_x, v_client_x, 'Scheduled', '<TECH_ID>'),
    (v_job_y, v_client_y, 'Scheduled', null),
    (v_job_z, v_client_z, 'Scheduled', null);

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (v_job_y, '<TECH_ID>', 'work', 'confirmed', '2026-11-01', '08:00', '16:00', '<ADMIN_ID>');

  -- job_diary fixtures
  insert into public.job_diary (job_id, entry_text, created_by) values
    (v_job_x, 'Diary on job X', '<ADMIN_ID>'),
    (v_job_y, 'Diary on job Y', '<ADMIN_ID>'),
    (v_job_z, 'Diary on job Z', '<ADMIN_ID>');

  -- communications (SMS) fixtures
  insert into public.communications (job_id, type, direction, sender, recipient, body, sent_by) values
    (v_job_x, 'sms', 'outbound', 'Zenith', '0400000000', 'SMS on job X', '<ADMIN_ID>'),
    (v_job_y, 'sms', 'outbound', 'Zenith', '0400000000', 'SMS on job Y', '<ADMIN_ID>'),
    (v_job_z, 'sms', 'outbound', 'Zenith', '0400000000', 'SMS on job Z', '<ADMIN_ID>');

  -- job_contacts fixtures
  insert into public.job_contacts (job_id, first_name, updated_by) values
    (v_job_x, 'Contact X', '<ADMIN_ID>'),
    (v_job_y, 'Contact Y', '<ADMIN_ID>'),
    (v_job_z, 'Contact Z', '<ADMIN_ID>');

  -- job_line_items fixtures (one-off lines, no materials_catalog row needed)
  insert into public.job_line_items (job_id, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct) values
    (v_job_x, 'Line on job X', 1, 100, 20),
    (v_job_y, 'Line on job Y', 1, 100, 20),
    (v_job_z, 'Line on job Z', 1, 100, 20);

  -- job_applied_bundles fixtures (needs one real bundle row to satisfy the FK)
  insert into public.bundles (id, name) values (v_bundle_id, 'Regression Test Bundle');
  insert into public.job_applied_bundles (job_id, bundle_id, bundle_name_snapshot, applied_by) values
    (v_job_x, v_bundle_id, 'Regression Test Bundle', '<ADMIN_ID>'),
    (v_job_y, v_bundle_id, 'Regression Test Bundle', '<ADMIN_ID>'),
    (v_job_z, v_bundle_id, 'Regression Test Bundle', '<ADMIN_ID>');

  raise notice 'Regression fixtures created.';
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_job_x uuid := '99999999-9999-9999-9999-999999999911';
  v_job_y uuid := '99999999-9999-9999-9999-999999999912';
  v_job_z uuid := '99999999-9999-9999-9999-999999999913';
  v_client_x uuid := '99999999-9999-9999-9999-999999999901';
  v_client_y uuid := '99999999-9999-9999-9999-999999999902';
  v_client_z uuid := '99999999-9999-9999-9999-999999999903';
  v_my_jobs record;
  v_found_x boolean := false;
  v_found_y boolean := false;
  v_found_z boolean := false;
  v_y_next_date date;
begin
  -- get_my_jobs(): X (assigned_to-only) and Y (schedule-entry-only) must
  -- both appear; Z (neither) must not.
  for v_my_jobs in select * from public.get_my_jobs() loop
    if v_my_jobs.id = v_job_x then v_found_x := true; end if;
    if v_my_jobs.id = v_job_y then
      v_found_y := true;
      v_y_next_date := v_my_jobs.next_scheduled_date;
    end if;
    if v_my_jobs.id = v_job_z then v_found_z := true; end if;
  end loop;

  if not v_found_x then raise exception 'get_my_jobs() should include the assigned_to-only job'; end if;
  if not v_found_y then raise exception 'get_my_jobs() should include the schedule-entry-only job'; end if;
  if v_found_z then raise exception 'get_my_jobs() should not include the unrelated job'; end if;
  if v_y_next_date <> '2026-11-01' then raise exception 'get_my_jobs() should return the confirmed date for job Y'; end if;

  -- job_diary: X and Y select+insert; Z neither.
  if (select count(*) from public.job_diary where job_id = v_job_x) <> 1 then
    raise exception 'technician should see job_diary for the assigned_to-only job';
  end if;
  if (select count(*) from public.job_diary where job_id = v_job_y) <> 1 then
    raise exception 'technician should see job_diary for the schedule-entry-only job';
  end if;
  if (select count(*) from public.job_diary where job_id = v_job_z) <> 0 then
    raise exception 'technician should not see job_diary for the unrelated job';
  end if;
  insert into public.job_diary (job_id, entry_text, created_by) values (v_job_y, 'Tech note on Y', '<TECH_ID>');
  if (select count(*) from public.job_diary where job_id = v_job_y and created_by = '<TECH_ID>') <> 1 then
    raise exception 'technician should be able to insert job_diary on the schedule-entry-only job';
  end if;

  -- communications (SMS): same X/Y/Z pattern.
  if (select count(*) from public.communications where job_id = v_job_x) <> 1 then
    raise exception 'technician should see communications for the assigned_to-only job';
  end if;
  if (select count(*) from public.communications where job_id = v_job_y) <> 1 then
    raise exception 'technician should see communications for the schedule-entry-only job';
  end if;
  if (select count(*) from public.communications where job_id = v_job_z) <> 0 then
    raise exception 'technician should not see communications for the unrelated job';
  end if;

  -- job_contacts: same X/Y/Z pattern (select-only for technicians).
  if (select count(*) from public.job_contacts where job_id = v_job_x) <> 1 then
    raise exception 'technician should see job_contacts for the assigned_to-only job';
  end if;
  if (select count(*) from public.job_contacts where job_id = v_job_y) <> 1 then
    raise exception 'technician should see job_contacts for the schedule-entry-only job';
  end if;
  if (select count(*) from public.job_contacts where job_id = v_job_z) <> 0 then
    raise exception 'technician should not see job_contacts for the unrelated job';
  end if;

  -- get_my_job_line_items(): same X/Y/Z pattern.
  if (select count(*) from public.get_my_job_line_items(v_job_x)) <> 1 then
    raise exception 'technician should see line items for the assigned_to-only job';
  end if;
  if (select count(*) from public.get_my_job_line_items(v_job_y)) <> 1 then
    raise exception 'technician should see line items for the schedule-entry-only job';
  end if;
  if (select count(*) from public.get_my_job_line_items(v_job_z)) <> 0 then
    raise exception 'technician should not see line items for the unrelated job';
  end if;

  -- get_my_job_applied_bundles(): same X/Y/Z pattern.
  if (select count(*) from public.get_my_job_applied_bundles(v_job_x)) <> 1 then
    raise exception 'technician should see applied bundles for the assigned_to-only job';
  end if;
  if (select count(*) from public.get_my_job_applied_bundles(v_job_y)) <> 1 then
    raise exception 'technician should see applied bundles for the schedule-entry-only job';
  end if;
  if (select count(*) from public.get_my_job_applied_bundles(v_job_z)) <> 0 then
    raise exception 'technician should not see applied bundles for the unrelated job';
  end if;

  -- clients_technician_select (technician_has_job_for_client()): same
  -- X/Y/Z pattern, keyed by client this time.
  if (select count(*) from public.clients where id = v_client_x) <> 1 then
    raise exception 'technician should see the client for the assigned_to-only job';
  end if;
  if (select count(*) from public.clients where id = v_client_y) <> 1 then
    raise exception 'technician should see the client for the schedule-entry-only job';
  end if;
  if (select count(*) from public.clients where id = v_client_z) <> 0 then
    raise exception 'technician should not see the client for the unrelated job';
  end if;

  raise notice 'All technician_owns_job() dependent regression checks passed.';
end $$;

rollback;
```

Expected: `NOTICE: Regression fixtures created.` then `NOTICE: All technician_owns_job() dependent regression checks passed.`, no unexpected `ERROR`. If any `raise exception` fires, stop and diagnose before continuing — this is the change with the widest blast radius in this phase.

Ask the user to also manually verify the one dependent a `DO` block cannot exercise — the `diary-photos` storage bucket policies (both upload and select), which also route through `technician_owns_job()`. Using the real running app (`npm run dev`): as the technician test account, open job Y (the schedule-entry-only job from the fixtures above, or an equivalent real job where the technician has a confirmed schedule entry but is not `assigned_to`) and confirm the Diary section lets them upload and view a photo; then open a job where the technician has neither `assigned_to` nor a confirmed schedule entry and confirm the Diary section shows no upload/view access. This mirrors how the Roof Report Generator's one non-`DO`-block-testable storage check was verified in this project previously.

- [x] **Step 6: Commit**

```bash
git add supabase/policies/001_helper_function.sql supabase/policies/004_jobs_policies.sql supabase/migrations/2026-09-16_schedule_access_model.sql
git commit -m "feat: extend technician access model to recognize confirmed schedule entries"
```

---

### Task 6: Dashboard/JobList real scheduled date/time display

**Files:**
- Modify: `src/lib/jobConstants.js`
- Modify: `src/hooks/useJobs.js`
- Modify: `src/components/JobRow.jsx`
- Modify: `src/pages/JobList.jsx`

**Interfaces:**
- Consumes: `get_my_jobs()`'s new columns (Task 5, technician branch) and a new `schedule_entries` embed on the staff-role query (Task 1).
- Produces: `deriveScheduleSummary(entries)` and `formatScheduleSummary(job)` exported from `jobConstants.js`. Every job object returned by `useJobs()` now has `next_scheduled_date`, `next_scheduled_start_time`, and `additional_scheduled_days`, computed identically regardless of role. Not consumed elsewhere in this phase — Phases 2/3 build their own dedicated queries for the calendar grid itself.

**Scope note:** `Dashboard.jsx` itself is not modified — it only ever rendered aggregate per-status counts (a `stat-cards` grid), never individual job rows, so there is no per-job cell there to put a date/time into. `JobList.jsx`/`JobRow.jsx` are where individual jobs are actually listed for every role today (including technicians, via the existing "Jobs" nav link), so that is where this task adds the real date/time. Flag this to the user if a literal per-job breakdown on the Dashboard page itself was actually wanted — that would be a small additional change, not part of this task as written.

- [x] **Step 1: Add the helpers to `jobConstants.js`**

Add to `src/lib/jobConstants.js`:

```js
export function deriveScheduleSummary(entries) {
  const confirmed = (entries ?? [])
    .filter((entry) => entry.status === 'confirmed')
    .sort((a, b) => `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`))

  if (confirmed.length === 0) {
    return { next_scheduled_date: null, next_scheduled_start_time: null, additional_scheduled_days: 0 }
  }

  return {
    next_scheduled_date: confirmed[0].scheduled_date,
    next_scheduled_start_time: confirmed[0].start_time,
    additional_scheduled_days: confirmed.length - 1,
  }
}

export function formatScheduleSummary(job) {
  if (!job.next_scheduled_date) return '—'

  const date = new Date(`${job.next_scheduled_date}T${job.next_scheduled_start_time ?? '00:00:00'}`)
  const dateStr = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const timeStr = job.next_scheduled_start_time
    ? date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : null

  const base = timeStr ? `${dateStr}, ${timeStr}` : dateStr
  const extra = job.additional_scheduled_days > 0
    ? ` (+${job.additional_scheduled_days} more day${job.additional_scheduled_days === 1 ? '' : 's'})`
    : ''

  return `${base}${extra}`
}
```

- [x] **Step 2: Extend `useJobs.js`'s staff-role query**

In `src/hooks/useJobs.js`, add the import:

```js
import { deriveScheduleSummary } from '../lib/jobConstants'
```

Replace the staff-role `.select(...)` call:

```js
      const { data, error: jobsError } = await supabase
        .from('jobs')
        .select(
          'id, job_number, status, description, site_address, client_id, assigned_to, queue_id, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name), queues(name)'
        )
        .order('created_at', { ascending: false })
```

with:

```js
      const { data, error: jobsError } = await supabase
        .from('jobs')
        .select(
          'id, job_number, status, description, site_address, client_id, assigned_to, queue_id, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name), queues(name), schedule_entries(scheduled_date, start_time, status)'
        )
        .order('created_at', { ascending: false })
```

Replace the mapping below it:

```js
      setJobs(
        data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
          assignedName: job.assigned?.full_name ?? 'Unassigned',
          queueName: job.queues?.name ?? 'Unqueued',
        }))
      )
```

with:

```js
      setJobs(
        data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
          assignedName: job.assigned?.full_name ?? 'Unassigned',
          queueName: job.queues?.name ?? 'Unqueued',
          ...deriveScheduleSummary(job.schedule_entries),
        }))
      )
```

The technician branch (`get_my_jobs()` RPC) needs no change here — its rows already spread through `...job`, which now includes `next_scheduled_date`/`next_scheduled_start_time`/`additional_scheduled_days` directly from the RPC (Task 5).

- [x] **Step 3: Add the Scheduled column to `JobRow.jsx`**

Replace the full contents of `src/components/JobRow.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { formatJobNumber, formatScheduleSummary } from '../lib/jobConstants'

export default function JobRow({ job, role }) {
  const isStaff = role !== 'technician'

  return (
    <tr>
      <td>{formatJobNumber(job.job_number)}</td>
      <td><Link to={`/jobs/${job.id}`}>{job.clientName}</Link></td>
      <td>{job.site_address || '—'}</td>
      <td>{job.status}</td>
      <td>{formatScheduleSummary(job)}</td>
      {isStaff && <td>{job.assignedName}</td>}
      {isStaff && <td>{job.queueName}</td>}
    </tr>
  )
}
```

- [x] **Step 4: Add the Scheduled column header to `JobList.jsx`**

In `src/pages/JobList.jsx`, replace the table header:

```jsx
          <tr>
            <th>Job #</th>
            <th>Client</th>
            <th>Site Address</th>
            <th>Status</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Queue</th>}
          </tr>
```

with:

```jsx
          <tr>
            <th>Job #</th>
            <th>Client</th>
            <th>Site Address</th>
            <th>Status</th>
            <th>Scheduled</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Queue</th>}
          </tr>
```

- [x] **Step 5: Manually verify in the browser**

For each of the three test accounts, using real jobs with `schedule_entries` rows created via the SQL Editor (`create_schedule_entry`/`confirm_schedule_entry` from Tasks 2-3, since no UI exists yet to create them):
- A job with one confirmed entry shows "Scheduled — {date}, {time}" with no "+N more days" suffix.
- A job with two or more confirmed entries shows the earliest date/time plus the correct "+N more days" count.
- A job with only tentative entries (no confirmed ones) shows "—", same as a job with no entries at all.
- As technician: the Scheduled column reflects a job they're confirmed on via `schedule_entries` alone (not `assigned_to`), consistent with Task 5's access-model extension.
- As admin/office: confirm the Jobs list's existing Queue/Assigned To columns and filters still work unchanged alongside the new column.

- [x] **Step 6: Commit**

```bash
git add src/lib/jobConstants.js src/hooks/useJobs.js src/components/JobRow.jsx src/pages/JobList.jsx
git commit -m "feat: show real confirmed schedule date/time on Dashboard/JobList"
```
