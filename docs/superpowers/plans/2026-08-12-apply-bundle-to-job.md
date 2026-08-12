# Apply Bundle to Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the bundle library to real jobs — a `BillingSection` on the job detail page showing line items grouped by applied bundle, an "Apply Bundle" action, form-style editing of existing lines, adding one-off lines, and removing a whole bundle or an individual line — as specified in `docs/superpowers/specs/2026-08-12-apply-bundle-to-job-design.md`.

**Architecture:** One new Postgres function (`apply_bundle_to_job`, the project's first write-capable function, atomic by virtue of running as a single function call) plus two existing RPCs extended for the technician read path (`get_my_job_line_items` gains `applied_bundle_id`; a new `get_my_job_applied_bundles` mirrors it for group names). Frontend follows the same hook/component conventions as every prior phase — role-branching hook (mirrors `useJob`), presentational grouped-table component using native `<details>/<summary>` for collapsing (no new dependency), direct Supabase calls for mutations.

**Tech Stack:** React 19 + Vite, `react-router-dom`, `@supabase/supabase-js` (all existing, no new dependencies). SQL changes run manually in the Supabase SQL Editor, same as every prior phase.

## Global Constraints

- No table/schema changes in this plan — `job_applied_bundles`, `job_line_items`, `bundles`, `bundle_items` already exist with correct RLS.
- `job_line_items` already has `price_inc_gst`/`total_inc_gst` as stored generated columns — reading and displaying existing lines needs no client-side recalculation. Only the "add one-off item" form needs a live preview computed client-side before the row exists (reusing `calcPriceIncGst`/`calcTotalIncGst` from `src/lib/bundleCalc.js`, applied directly to the selected material's `purchase_cost` since it's already GST-inclusive).
- `apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid)` is the project's first write-capable Postgres function. It is `SECURITY INVOKER` (the default — no keyword needed): admin/office already have full INSERT rights on `job_applied_bundles`/`job_line_items` via existing RLS, so the function buys atomicity (both inserts succeed or neither does, since a single function call is one transactional unit in Postgres), not elevated privilege.
- **Because it's `SECURITY INVOKER`, RLS applies to every statement inside the function, including its own internal `select ... from public.bundles`.** A technician calling it doesn't hit a catchable exception — the initial `bundles` select already returns zero rows under their RLS (no policy = deny), so the header insert's `insert ... select ...` inserts zero rows, and the function returns `NULL` silently. This is a safe, non-leaking failure mode (nothing is ever exposed or written), just not a chatty error — acceptable since the "Apply Bundle" control never renders for technicians in the UI anyway, matching this app's established nav-hiding-plus-RLS-backstop pattern rather than needing an explicit in-function role check.
- Applying a bundle with zero `bundle_items` is allowed — it produces a `job_applied_bundles` header row with zero lines, an empty section staff can add items to.
- The bundle picker only offers `active = true` bundles (`useActiveBundles`, mirrors `useActiveMaterials`). The picker is select-then-explicit-"Apply"-button, not auto-fire-on-change, since this is an immediate database write.
- The same bundle can be applied to the same job more than once — no dedupe, no UI prevention. Each apply is its own `job_applied_bundles` row and its own collapsible group.
- Editing an existing line item's qty/markup is form-style edit-then-Save per row (not inline-per-keystroke, not a whole-array-diff-on-submit like `BundleForm`) — click Edit on a row, it becomes a small form, Save persists that one row.
- Collapsible grouping uses native `<details>/<summary>` — no accordion library, no new dependency, matches this app's zero-extra-dependencies convention.
- This project has no automated JS test framework. Every task's "verify" step is a manual check (`npm run dev` + sign in as the admin/office/technician test accounts) plus `npm run build` / `npx oxlint`.

---

### Task 1: Extend the technician RPCs and build the read-only billing view

**Files:**
- Modify: `supabase/policies/011_job_line_items_policies.sql`
- Modify: `supabase/policies/012_job_applied_bundles_policies.sql`
- Create: `src/hooks/useJobBilling.js`
- Create: `src/components/BillingGroup.jsx` (read-only in this task)
- Create: `src/components/BillingSection.jsx` (read-only in this task)
- Modify: `src/pages/JobDetail.jsx`

**Interfaces:**
- Consumes: `job_line_items`, `job_applied_bundles` tables; `technician_owns_job()` helper (already exists).
- Produces:
  - `get_my_job_line_items(target_job_id uuid)` now returns `id, job_id, qty, item_name_snapshot, applied_bundle_id` (added the last column).
  - `get_my_job_applied_bundles(target_job_id uuid)` — new, returns `id, bundle_name_snapshot`.
  - `useJobBilling(jobId, role)` returns `{ groups, otherItems, loading, error, reload }`. `groups[i]` is `{ id, bundle_name_snapshot, items }`. `otherItems` is line items with `applied_bundle_id = null`. Staff items include `markup_pct, price_inc_gst, total_inc_gst`; technician items don't (RPC never returns them).
  - `<BillingGroup id title items isStaff onChanged />` and `<BillingSection jobId role />` — consumed by later tasks, which replace both files' full contents to add mutation capability.

- [ ] **Step 1: Extend get_my_job_line_items and add get_my_job_applied_bundles**

In `supabase/policies/011_job_line_items_policies.sql`, replace the existing function block (from `create or replace function public.get_my_job_line_items` through its `comment on function` line) with:

```sql
-- CREATE OR REPLACE cannot change an existing function's return columns
-- (Postgres error: "cannot change return type of existing function"),
-- so the old version has to be dropped first.
drop function if exists public.get_my_job_line_items(uuid);

create or replace function public.get_my_job_line_items(target_job_id uuid)
returns table (
  id uuid,
  job_id uuid,
  qty numeric,
  item_name_snapshot text,
  applied_bundle_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select id, job_id, qty, item_name_snapshot, applied_bundle_id
  from public.job_line_items
  where job_id = target_job_id
    and public.technician_owns_job(target_job_id);
$$;

comment on function public.get_my_job_line_items(uuid) is 'Returns qty, item name, and applied_bundle_id (no cost/markup/price) for a job''s line items, restricted to jobs assigned to the calling technician via technician_owns_job(). applied_bundle_id lets the UI group technician-visible lines the same way as staff, paired with get_my_job_applied_bundles() for the group names.';
```

At the end of `supabase/policies/012_job_applied_bundles_policies.sql`, append:

```sql

-- Technicians have no SELECT policy on job_applied_bundles (same
-- reasoning as job_line_items -- deny by default). They read bundle
-- group names for their assigned jobs through this SECURITY DEFINER
-- function instead, mirroring get_my_job_line_items() exactly, just
-- for the header table.
create or replace function public.get_my_job_applied_bundles(target_job_id uuid)
returns table (
  id uuid,
  bundle_name_snapshot text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, bundle_name_snapshot
  from public.job_applied_bundles
  where job_id = target_job_id
    and public.technician_owns_job(target_job_id);
$$;

comment on function public.get_my_job_applied_bundles(uuid) is 'Returns id and bundle_name_snapshot only, restricted to jobs assigned to the calling technician via technician_owns_job(). Pairs with get_my_job_line_items() so technicians can render the same grouped view as staff without any access to cost/markup/price.';
```

- [ ] **Step 2: Run both files against the live Supabase project**

In the Supabase SQL Editor, run the updated `011_job_line_items_policies.sql` block (the `drop function` + `create or replace function` + `comment` statements) first, then the appended block in `012_job_applied_bundles_policies.sql`.

- [ ] **Step 3: Re-verify both RPCs live**

Run this as one submission in the SQL Editor, filling in real admin and technician test-account ids and two distinct real job ids:

```sql
do $$
declare
  job_a uuid;
  job_b uuid;
  test_bundle_id uuid;
  applied_id uuid;
  rpc_line_count_a int;
  rpc_line_applied_bundle_id uuid;
  rpc_header_count_a int;
  rpc_header_name text;
  rpc_line_count_b int;
  rpc_header_count_b int;
begin
  select id into job_a from public.jobs limit 1;
  select id into job_b from public.jobs where id <> job_a limit 1;
  select id into test_bundle_id from public.bundles limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
  set local role authenticated;

  update public.jobs set assigned_to = '<technician-user-id>' where id = job_a;

  insert into public.job_applied_bundles (job_id, bundle_id, bundle_name_snapshot)
  values (job_a, test_bundle_id, 'RPC Test Bundle')
  returning id into applied_id;

  insert into public.job_line_items (job_id, applied_bundle_id, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct)
  values (job_a, applied_id, 'RPC Test Line', 2, 10.00, 0);

  perform set_config('request.jwt.claims', json_build_object('sub', '<technician-user-id>')::text, true);
  set local role authenticated;

  select count(*), max(applied_bundle_id) into rpc_line_count_a, rpc_line_applied_bundle_id
  from public.get_my_job_line_items(job_a);

  select count(*), max(bundle_name_snapshot) into rpc_header_count_a, rpc_header_name
  from public.get_my_job_applied_bundles(job_a);

  select count(*) into rpc_line_count_b from public.get_my_job_line_items(job_b);
  select count(*) into rpc_header_count_b from public.get_my_job_applied_bundles(job_b);

  raise exception 'line_count_a = % (expect 1), applied_bundle_id_matches = % (expect true), header_count_a = % (expect 1), header_name = % (expect RPC Test Bundle), line_count_b = % (expect 0), header_count_b = % (expect 0)',
    rpc_line_count_a, (rpc_line_applied_bundle_id = applied_id), rpc_header_count_a, rpc_header_name, rpc_line_count_b, rpc_header_count_b;
end $$;
```

Expected: `line_count_a = 1`, `applied_bundle_id_matches = true`, `header_count_a = 1`, `header_name = RPC Test Bundle`, `line_count_b = 0`, `header_count_b = 0`. The exception auto-rolls back the temporary job reassignment and test rows — no cleanup needed. (Cost/markup/price staying excluded is structurally guaranteed by the `returns table` column list, not something that needs a runtime check — the function can't return columns it doesn't declare.)

- [ ] **Step 4: Create the useJobBilling hook**

Create `src/hooks/useJobBilling.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobBilling(jobId, role) {
  const [groups, setGroups] = useState([])
  const [otherItems, setOtherItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (role === 'technician') {
      const [bundlesResult, itemsResult] = await Promise.all([
        supabase.rpc('get_my_job_applied_bundles', { target_job_id: jobId }),
        supabase.rpc('get_my_job_line_items', { target_job_id: jobId }),
      ])
      if (bundlesResult.error) {
        setError(bundlesResult.error)
        setLoading(false)
        return
      }
      if (itemsResult.error) {
        setError(itemsResult.error)
        setLoading(false)
        return
      }
      const items = itemsResult.data ?? []
      const headers = bundlesResult.data ?? []
      setGroups(
        headers.map((header) => ({
          id: header.id,
          bundle_name_snapshot: header.bundle_name_snapshot,
          items: items.filter((item) => item.applied_bundle_id === header.id),
        }))
      )
      setOtherItems(items.filter((item) => item.applied_bundle_id === null))
      setLoading(false)
      return
    }

    const [bundlesResult, itemsResult] = await Promise.all([
      supabase
        .from('job_applied_bundles')
        .select('id, bundle_name_snapshot')
        .eq('job_id', jobId)
        .order('applied_at'),
      supabase
        .from('job_line_items')
        .select('id, item_name_snapshot, qty, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id')
        .eq('job_id', jobId)
        .order('created_at'),
    ])
    if (bundlesResult.error) {
      setError(bundlesResult.error)
      setLoading(false)
      return
    }
    if (itemsResult.error) {
      setError(itemsResult.error)
      setLoading(false)
      return
    }
    const items = itemsResult.data
    const headers = bundlesResult.data
    setGroups(
      headers.map((header) => ({
        id: header.id,
        bundle_name_snapshot: header.bundle_name_snapshot,
        items: items.filter((item) => item.applied_bundle_id === header.id),
      }))
    )
    setOtherItems(items.filter((item) => item.applied_bundle_id === null))
    setLoading(false)
  }, [jobId, role])

  useEffect(() => {
    if (!role) return
    reload()
  }, [reload, role])

  return { groups, otherItems, loading, error, reload }
}
```

- [ ] **Step 5: Create the read-only BillingGroup component**

Create `src/components/BillingGroup.jsx`:

```jsx
export default function BillingGroup({ title, items, isStaff }) {
  const groupTotal = isStaff ? items.reduce((sum, item) => sum + (item.total_inc_gst ?? 0), 0) : null

  return (
    <details open>
      <summary>
        {title}
        {isStaff && ` — $${groupTotal.toFixed(2)}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            {isStaff && <th>Markup %</th>}
            {isStaff && <th>Price (inc. GST)</th>}
            {isStaff && <th>Total (inc. GST)</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.item_name_snapshot}</td>
              <td>{item.qty}</td>
              {isStaff && <td>{item.markup_pct}</td>}
              {isStaff && <td>${item.price_inc_gst.toFixed(2)}</td>}
              {isStaff && <td>${item.total_inc_gst.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
```

- [ ] **Step 6: Create the read-only BillingSection component**

Create `src/components/BillingSection.jsx`:

```jsx
import { useJobBilling } from '../hooks/useJobBilling'
import BillingGroup from './BillingGroup'

export default function BillingSection({ jobId, role }) {
  const { groups, otherItems, loading, error } = useJobBilling(jobId, role)
  const isStaff = role !== 'technician'

  if (loading) return <p>Loading billing...</p>
  if (error) return <p role="alert">Could not load billing: {error.message}</p>

  const jobTotal = isStaff
    ? [...groups.flatMap((group) => group.items), ...otherItems].reduce(
        (sum, item) => sum + (item.total_inc_gst ?? 0),
        0
      )
    : null

  return (
    <section>
      <h2>Billing</h2>
      {isStaff && <p>Job Total: ${jobTotal.toFixed(2)}</p>}
      {groups.map((group) => (
        <BillingGroup key={group.id} title={group.bundle_name_snapshot} items={group.items} isStaff={isStaff} />
      ))}
      {otherItems.length > 0 && <BillingGroup title="Other Items" items={otherItems} isStaff={isStaff} />}
    </section>
  )
}
```

- [ ] **Step 7: Mount BillingSection on JobDetail**

In `src/pages/JobDetail.jsx`, add the import:

```jsx
import BillingSection from '../components/BillingSection'
```

And mount it between the job info block and `DiarySection` — replace:

```jsx
      <DiarySection jobId={job.id} />
```

with:

```jsx
      <BillingSection jobId={job.id} role={profile?.role} />
      <DiarySection jobId={job.id} />
```

- [ ] **Step 8: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`, sign in as admin, open any job — confirm a "Billing" section appears below the job info (above Diary) showing "Job Total: $0.00" and no groups (empty state, since nothing's been applied yet — the actual grouped-rendering check happens naturally in Task 2's verify, once there's real data to look at). Sign in as technician, open a job assigned to them — confirm the Billing section loads without error (empty state, no Job Total line since that's staff-only).

- [ ] **Step 9: Commit**

```bash
git add supabase/policies/011_job_line_items_policies.sql supabase/policies/012_job_applied_bundles_policies.sql src/hooks/useJobBilling.js src/components/BillingGroup.jsx src/components/BillingSection.jsx src/pages/JobDetail.jsx
git commit -m "feat: add read-only billing section to job detail"
```

---

### Task 2: apply_bundle_to_job function and the Apply Bundle action

**Files:**
- Create: `supabase/policies/013_apply_bundle_to_job_function.sql`
- Create: `src/hooks/useActiveBundles.js`
- Modify: `src/components/BillingSection.jsx` (full replace)

**Interfaces:**
- Consumes: `apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid) returns uuid`, `useJobBilling` (Task 1).
- Produces: `useActiveBundles()` returning `{ bundles, loading, error }`, each `bundles[i]` is `{ id, name }`.

- [ ] **Step 1: Create the apply_bundle_to_job function**

Create `supabase/policies/013_apply_bundle_to_job_function.sql`:

```sql
-- The first write-capable function in this project. Applies a bundle
-- to a job by inserting one job_applied_bundles header row and one
-- job_line_items row per bundle_items row, as a single atomic unit --
-- if any insert fails, the whole call rolls back, so a partial apply
-- (an empty-looking bundle section with no line items and no visible
-- error) can't happen. SECURITY INVOKER (the default -- no keyword
-- needed) is enough: admin/office already have full INSERT rights on
-- both tables via existing RLS, so this buys atomicity, not elevated
-- privilege. Because RLS still applies to every statement inside a
-- SECURITY INVOKER function, a technician calling this directly gets
-- no error -- the initial `select ... from bundles` already returns
-- zero rows under their RLS, so both inserts affect zero rows and the
-- function returns null. Safe (nothing is written or exposed), just
-- not a chatty failure -- acceptable since the Apply Bundle control
-- never renders for technicians in the UI anyway.
create or replace function public.apply_bundle_to_job(target_job_id uuid, target_bundle_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_applied_bundle_id uuid;
begin
  insert into public.job_applied_bundles (job_id, bundle_id, bundle_name_snapshot, applied_by)
  select target_job_id, target_bundle_id, bundles.name, auth.uid()
  from public.bundles
  where bundles.id = target_bundle_id
  returning id into new_applied_bundle_id;

  insert into public.job_line_items (
    job_id, materials_catalog_id, item_code_snapshot, item_name_snapshot,
    qty, cost_inc_gst_snapshot, markup_pct, applied_bundle_id
  )
  select
    target_job_id,
    materials_catalog.id,
    materials_catalog.item_number,
    materials_catalog.description,
    bundle_items.default_qty,
    coalesce(materials_catalog.purchase_cost, 0),
    bundle_items.default_markup_pct,
    new_applied_bundle_id
  from public.bundle_items
  join public.materials_catalog on materials_catalog.id = bundle_items.materials_catalog_id
  where bundle_items.bundle_id = target_bundle_id;

  return new_applied_bundle_id;
end;
$$;

comment on function public.apply_bundle_to_job(uuid, uuid) is 'Applies a bundle to a job: inserts one job_applied_bundles header row and one job_line_items row per bundle_items row (snapshotting item_number/description/purchase_cost from materials_catalog at this moment; purchase_cost null coalesces to 0, matching the same convention used in the bundle editor), as a single atomic operation. Succeeds even if the bundle has zero bundle_items (an empty header row, by design). Returns the new job_applied_bundles.id, or null if the caller has no RLS access to the bundle (e.g. a technician).';
```

- [ ] **Step 2: Run the file against the live Supabase project**

Run `013_apply_bundle_to_job_function.sql` in the SQL Editor.

- [ ] **Step 3: Verify live — admin apply with items**

Pick a bundle you know has at least one `bundle_item` (e.g. one created during the bundle management phase), and run:

```sql
do $$
declare
  test_job_id uuid;
  test_bundle_id uuid := '<a-bundle-id-with-at-least-one-item>';
  new_applied_id uuid;
  line_count int;
  first_item_name text;
  first_cost numeric;
begin
  select id into test_job_id from public.jobs limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
  set local role authenticated;

  select public.apply_bundle_to_job(test_job_id, test_bundle_id) into new_applied_id;

  select count(*) into line_count from public.job_line_items where applied_bundle_id = new_applied_id;
  select item_name_snapshot, cost_inc_gst_snapshot into first_item_name, first_cost
  from public.job_line_items where applied_bundle_id = new_applied_id limit 1;

  raise exception 'applied_id = % (expect not null), line_count = % (expect > 0), first_item_name = %, first_cost = %', new_applied_id, line_count, first_item_name, first_cost;
end $$;
```

- [ ] **Step 4: Verify live — empty bundle is allowed**

```sql
do $$
declare
  test_job_id uuid;
  empty_bundle_id uuid;
  new_applied_id uuid;
  line_count int;
begin
  select id into test_job_id from public.jobs limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
  set local role authenticated;

  insert into public.bundles (name) values ('Empty Test Bundle') returning id into empty_bundle_id;

  select public.apply_bundle_to_job(test_job_id, empty_bundle_id) into new_applied_id;

  select count(*) into line_count from public.job_line_items where applied_bundle_id = new_applied_id;

  raise exception 'empty bundle apply: applied_id = % (expect not null), line_count = % (expect 0)', new_applied_id, line_count;
end $$;
```

- [ ] **Step 5: Verify live — technician gets a silent null, not data access**

```sql
do $$
declare
  test_job_id uuid;
  test_bundle_id uuid;
  result_id uuid;
begin
  select id into test_job_id from public.jobs limit 1;
  select id into test_bundle_id from public.bundles where active = true limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '<technician-user-id>')::text, true);
  set local role authenticated;

  select public.apply_bundle_to_job(test_job_id, test_bundle_id) into result_id;

  raise exception 'technician apply result_id = % (expect null)', result_id;
end $$;
```

All three blocks auto-roll-back on the `raise exception` — no cleanup needed.

- [ ] **Step 6: Create the useActiveBundles hook**

Create `src/hooks/useActiveBundles.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useActiveBundles() {
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('bundles')
      .select('id, name')
      .eq('active', true)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setBundles(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { bundles, loading, error }
}
```

- [ ] **Step 7: Add the Apply Bundle control to BillingSection**

Replace the full contents of `src/components/BillingSection.jsx` with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useJobBilling } from '../hooks/useJobBilling'
import { useActiveBundles } from '../hooks/useActiveBundles'
import BillingGroup from './BillingGroup'

export default function BillingSection({ jobId, role }) {
  const { groups, otherItems, loading, error, reload } = useJobBilling(jobId, role)
  const isStaff = role !== 'technician'
  const { bundles } = useActiveBundles()
  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  if (loading) return <p>Loading billing...</p>
  if (error) return <p role="alert">Could not load billing: {error.message}</p>

  async function handleApply() {
    if (!selectedBundleId) return
    setApplying(true)
    setApplyError(null)
    const { error } = await supabase.rpc('apply_bundle_to_job', {
      target_job_id: jobId,
      target_bundle_id: selectedBundleId,
    })
    setApplying(false)
    if (error) {
      setApplyError(error.message)
      return
    }
    setSelectedBundleId('')
    await reload()
  }

  const jobTotal = isStaff
    ? [...groups.flatMap((group) => group.items), ...otherItems].reduce(
        (sum, item) => sum + (item.total_inc_gst ?? 0),
        0
      )
    : null

  return (
    <section>
      <h2>Billing</h2>
      {isStaff && <p>Job Total: ${jobTotal.toFixed(2)}</p>}
      {isStaff && (
        <div>
          <select value={selectedBundleId} onChange={(e) => setSelectedBundleId(e.target.value)}>
            <option value="">Select a bundle...</option>
            {bundles.map((bundle) => (
              <option key={bundle.id} value={bundle.id}>{bundle.name}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={handleApply} disabled={!selectedBundleId || applying}>
            {applying ? 'Applying...' : 'Apply Bundle'}
          </button>
          {applyError && <p role="alert">{applyError}</p>}
        </div>
      )}
      {groups.map((group) => (
        <BillingGroup key={group.id} title={group.bundle_name_snapshot} items={group.items} isStaff={isStaff} />
      ))}
      {otherItems.length > 0 && <BillingGroup title="Other Items" items={otherItems} isStaff={isStaff} />}
    </section>
  )
}
```

- [ ] **Step 8: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`.
1. Sign in as admin, open a job. Use the picker to Apply a bundle that has line items — confirm a new collapsible group appears with the bundle's name, correct items, correct per-row price/total, correct group subtotal, and the Job Total updates to match.
2. Apply the same bundle again — confirm a *second*, separate group appears (not merged with the first).
3. Apply an empty bundle (create one at `/bundles/new` with zero line items first, if you don't have one) — confirm an empty group section appears.
4. Sign in as the technician assigned to that job — confirm they see the same grouped structure (bundle names as section headers, qty + item name per line) with no Job Total, no Apply control, no cost/markup/price anywhere.

- [ ] **Step 9: Commit**

```bash
git add supabase/policies/013_apply_bundle_to_job_function.sql src/hooks/useActiveBundles.js src/components/BillingSection.jsx
git commit -m "feat: add apply_bundle_to_job function and Apply Bundle action"
```

---

### Task 3: Edit existing line items and add one-off items

**Files:**
- Modify: `src/components/BillingGroup.jsx` (full replace)
- Create: `src/components/AddOneOffLineItemForm.jsx`
- Modify: `src/components/BillingSection.jsx` (full replace)

**Interfaces:**
- Consumes: `calcPriceIncGst`, `calcTotalIncGst` (`src/lib/bundleCalc.js`, from the bundle management phase), `useActiveMaterials` (also from that phase).
- Produces: `<BillingGroup ... onChanged />` now mutates; `<AddOneOffLineItemForm jobId onAdded />`.

- [ ] **Step 1: Add per-row edit-then-Save to BillingGroup**

Replace the full contents of `src/components/BillingGroup.jsx` with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function BillingGroup({ title, items, isStaff, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [editQty, setEditQty] = useState('')
  const [editMarkup, setEditMarkup] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const groupTotal = isStaff ? items.reduce((sum, item) => sum + (item.total_inc_gst ?? 0), 0) : null

  function startEdit(item) {
    setEditingId(item.id)
    setEditQty(item.qty)
    setEditMarkup(item.markup_pct)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('job_line_items')
      .update({ qty: Number(editQty), markup_pct: Number(editMarkup) })
      .eq('id', editingId)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingId(null)
    await onChanged()
  }

  return (
    <details open>
      <summary>
        {title}
        {isStaff && ` — $${groupTotal.toFixed(2)}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            {isStaff && <th>Markup %</th>}
            {isStaff && <th>Price (inc. GST)</th>}
            {isStaff && <th>Total (inc. GST)</th>}
            {isStaff && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) =>
            editingId === item.id ? (
              <tr key={item.id}>
                <td colSpan={isStaff ? 6 : 2}>
                  <form onSubmit={handleSaveEdit}>
                    <label>
                      Qty
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                      />
                    </label>
                    <label>
                      Markup %
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editMarkup}
                        onChange={(e) => setEditMarkup(e.target.value)}
                      />
                    </label>
                    {error && <p role="alert">{error}</p>}
                    <button className="btn-primary" type="submit" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={item.id}>
                <td>{item.item_name_snapshot}</td>
                <td>{item.qty}</td>
                {isStaff && <td>{item.markup_pct}</td>}
                {isStaff && <td>${item.price_inc_gst.toFixed(2)}</td>}
                {isStaff && <td>${item.total_inc_gst.toFixed(2)}</td>}
                {isStaff && (
                  <td>
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            )
          )}
        </tbody>
      </table>
    </details>
  )
}
```

- [ ] **Step 2: Create the add-one-off-item form**

Create `src/components/AddOneOffLineItemForm.jsx`:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst } from '../lib/bundleCalc'

export default function AddOneOffLineItemForm({ jobId, onAdded }) {
  const { materials } = useActiveMaterials()
  const [materialId, setMaterialId] = useState('')
  const [qty, setQty] = useState(1)
  const [markupPct, setMarkupPct] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedMaterial = materials.find((m) => m.id === materialId)
  const costIncGst = selectedMaterial?.purchase_cost ?? 0
  const priceIncGst = calcPriceIncGst(costIncGst, Number(markupPct) || 0)
  const totalIncGst = calcTotalIncGst(costIncGst, Number(markupPct) || 0, Number(qty) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedMaterial) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('job_line_items').insert({
      job_id: jobId,
      materials_catalog_id: selectedMaterial.id,
      item_code_snapshot: selectedMaterial.item_number,
      item_name_snapshot: selectedMaterial.description,
      qty: Number(qty),
      cost_inc_gst_snapshot: costIncGst,
      markup_pct: Number(markupPct),
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setMaterialId('')
    setQty(1)
    setMarkupPct(0)
    await onAdded()
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Add One-off Item</h3>
      <label>
        Material
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Select a material...</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>{material.description}</option>
          ))}
        </select>
      </label>
      <label>
        Qty
        <input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <label>
        Markup %
        <input
          type="number"
          step="0.01"
          min="0"
          value={markupPct}
          onChange={(e) => setMarkupPct(e.target.value)}
        />
      </label>
      {selectedMaterial && (
        <p>
          Preview: Price ${priceIncGst.toFixed(2)} · Total ${totalIncGst.toFixed(2)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={!selectedMaterial || saving}>
        {saving ? 'Adding...' : 'Add Item'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Wire onChanged and mount the add-one-off form**

Replace the full contents of `src/components/BillingSection.jsx` with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useJobBilling } from '../hooks/useJobBilling'
import { useActiveBundles } from '../hooks/useActiveBundles'
import BillingGroup from './BillingGroup'
import AddOneOffLineItemForm from './AddOneOffLineItemForm'

export default function BillingSection({ jobId, role }) {
  const { groups, otherItems, loading, error, reload } = useJobBilling(jobId, role)
  const isStaff = role !== 'technician'
  const { bundles } = useActiveBundles()
  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  if (loading) return <p>Loading billing...</p>
  if (error) return <p role="alert">Could not load billing: {error.message}</p>

  async function handleApply() {
    if (!selectedBundleId) return
    setApplying(true)
    setApplyError(null)
    const { error } = await supabase.rpc('apply_bundle_to_job', {
      target_job_id: jobId,
      target_bundle_id: selectedBundleId,
    })
    setApplying(false)
    if (error) {
      setApplyError(error.message)
      return
    }
    setSelectedBundleId('')
    await reload()
  }

  const jobTotal = isStaff
    ? [...groups.flatMap((group) => group.items), ...otherItems].reduce(
        (sum, item) => sum + (item.total_inc_gst ?? 0),
        0
      )
    : null

  return (
    <section>
      <h2>Billing</h2>
      {isStaff && <p>Job Total: ${jobTotal.toFixed(2)}</p>}
      {isStaff && (
        <div>
          <select value={selectedBundleId} onChange={(e) => setSelectedBundleId(e.target.value)}>
            <option value="">Select a bundle...</option>
            {bundles.map((bundle) => (
              <option key={bundle.id} value={bundle.id}>{bundle.name}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={handleApply} disabled={!selectedBundleId || applying}>
            {applying ? 'Applying...' : 'Apply Bundle'}
          </button>
          {applyError && <p role="alert">{applyError}</p>}
        </div>
      )}
      {groups.map((group) => (
        <BillingGroup key={group.id} title={group.bundle_name_snapshot} items={group.items} isStaff={isStaff} onChanged={reload} />
      ))}
      {otherItems.length > 0 && (
        <BillingGroup title="Other Items" items={otherItems} isStaff={isStaff} onChanged={reload} />
      )}
      {isStaff && <AddOneOffLineItemForm jobId={jobId} onAdded={reload} />}
    </section>
  )
}
```

- [ ] **Step 4: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`, sign in as admin, open a job with an applied bundle from Task 2.
1. Click "Edit" on a line item, change qty and markup, click "Save" — confirm the row updates immediately and the group/job totals recompute. Reload the browser page — confirm the change persisted.
2. Click "Edit" then "Cancel" — confirm no change is saved.
3. Use "Add One-off Item": select a material, watch the live preview update as you change qty/markup, submit — confirm a new line appears in "Other Items" with correct values, and reload to confirm it persisted.
4. Sign in as office, repeat a quick edit — confirm office has the same access.
5. Sign in as technician — confirm no Edit buttons or Add One-off form render anywhere.

- [ ] **Step 5: Commit**

```bash
git add src/components/BillingGroup.jsx src/components/AddOneOffLineItemForm.jsx src/components/BillingSection.jsx
git commit -m "feat: add line item editing and one-off item creation to billing section"
```

---

### Task 4: Remove a whole bundle or an individual line item

**Files:**
- Modify: `src/components/BillingGroup.jsx` (full replace)
- Modify: `src/components/BillingSection.jsx` (pass `id` prop to each group)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — this is the last task in the plan.

- [ ] **Step 1: Add Remove actions to BillingGroup**

Replace the full contents of `src/components/BillingGroup.jsx` with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function BillingGroup({ id, title, items, isStaff, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [editQty, setEditQty] = useState('')
  const [editMarkup, setEditMarkup] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const groupTotal = isStaff ? items.reduce((sum, item) => sum + (item.total_inc_gst ?? 0), 0) : null

  function startEdit(item) {
    setEditingId(item.id)
    setEditQty(item.qty)
    setEditMarkup(item.markup_pct)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('job_line_items')
      .update({ qty: Number(editQty), markup_pct: Number(editMarkup) })
      .eq('id', editingId)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingId(null)
    await onChanged()
  }

  async function handleRemoveItem(itemId) {
    if (!window.confirm('Remove this line item?')) return
    const { error } = await supabase.from('job_line_items').delete().eq('id', itemId)
    if (!error) await onChanged()
  }

  async function handleRemoveGroup() {
    if (!window.confirm(`Remove "${title}" and all its line items? This cannot be undone.`)) return
    const { error } = await supabase.from('job_applied_bundles').delete().eq('id', id)
    if (!error) await onChanged()
  }

  return (
    <details open>
      <summary>
        {title}
        {isStaff && ` — $${groupTotal.toFixed(2)}`}
      </summary>
      {isStaff && id && <button onClick={handleRemoveGroup}>Remove Bundle</button>}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            {isStaff && <th>Markup %</th>}
            {isStaff && <th>Price (inc. GST)</th>}
            {isStaff && <th>Total (inc. GST)</th>}
            {isStaff && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) =>
            editingId === item.id ? (
              <tr key={item.id}>
                <td colSpan={isStaff ? 6 : 2}>
                  <form onSubmit={handleSaveEdit}>
                    <label>
                      Qty
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                      />
                    </label>
                    <label>
                      Markup %
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editMarkup}
                        onChange={(e) => setEditMarkup(e.target.value)}
                      />
                    </label>
                    {error && <p role="alert">{error}</p>}
                    <button className="btn-primary" type="submit" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={item.id}>
                <td>{item.item_name_snapshot}</td>
                <td>{item.qty}</td>
                {isStaff && <td>{item.markup_pct}</td>}
                {isStaff && <td>${item.price_inc_gst.toFixed(2)}</td>}
                {isStaff && <td>${item.total_inc_gst.toFixed(2)}</td>}
                {isStaff && (
                  <td>
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleRemoveItem(item.id)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            )
          )}
        </tbody>
      </table>
    </details>
  )
}
```

- [ ] **Step 2: Pass id to each BillingGroup**

In `src/components/BillingSection.jsx`, update the two `<BillingGroup>` usages:

```jsx
      {groups.map((group) => (
        <BillingGroup
          key={group.id}
          id={group.id}
          title={group.bundle_name_snapshot}
          items={group.items}
          isStaff={isStaff}
          onChanged={reload}
        />
      ))}
      {otherItems.length > 0 && (
        <BillingGroup id={null} title="Other Items" items={otherItems} isStaff={isStaff} onChanged={reload} />
      )}
```

(The "Other Items" group passes `id={null}`, so its `isStaff && id && <button>Remove Bundle</button>` guard never renders — there's no `job_applied_bundles` row backing it to delete.)

- [ ] **Step 3: Verify**

Run `npm run build` / `npx oxlint` — both clean. Run `npm run dev`, sign in as admin, open a job with at least two applied bundles (from earlier testing) plus a one-off item.
1. Confirm "Remove Bundle" appears on named groups but not on "Other Items".
2. Click "Remove" on a single line item inside a group, confirm the dialog, confirm only that line disappears and the rest of the group (and its subtotal) stays correct. Reload to confirm it persisted.
3. Click "Remove Bundle" on a group, confirm the dialog, confirm the whole group disappears. Reload to confirm it's gone (cascade removed its line items too, at the DB layer already proven in the `job_applied_bundles` phase).
4. Confirm the "Other Items" one-off line and any other untouched groups are unaffected by both removals.
5. Sign in as technician — confirm no Remove buttons render anywhere.

- [ ] **Step 4: Commit**

```bash
git add src/components/BillingGroup.jsx src/components/BillingSection.jsx
git commit -m "feat: add remove-bundle and remove-line-item actions to billing section"
```

---

## Self-Review

**Spec coverage:** RPC extension + re-verification (Task 1) covers the `get_my_job_line_items`/new `get_my_job_applied_bundles` section of the spec, including the "re-verify with the same rigor as the original build" requirement. Read-only grouped display with native `<details>` (Task 1) covers the grouping/technician-view section. `apply_bundle_to_job` with its atomicity and empty-bundle behavior (Task 2) covers the copy-mechanism section, including the corrected understanding that a technician's call returns `null` rather than throwing (documented inline as a comment, not silently changed from the spec without explanation). Form-style edit-then-Save (Task 3) matches the explicit decision against inline-per-field editing. One-off item addition with live client-side preview (Task 3) covers that spec requirement, correctly noting `job_line_items`' stored generated columns mean no recompute is needed for the read path. Remove-whole-bundle and remove-individual-line (Task 4) cover the removal section. Out-of-scope items (invoicing, dropping `job_costs`, bundle management screen changes, reordering) correctly have no task.

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code; every verify step has concrete actions and expected values.

**Type/name consistency:** `useJobBilling`'s `groups[i].items` and `otherItems` entries carry the same field names (`id, item_name_snapshot, qty, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id`) whether sourced from the direct `job_line_items` select (staff) or the RPC (technician, minus the cost/markup/price fields) — `BillingGroup`'s `isStaff` branches are the only thing that changes which fields it reads, so there's no shape drift between the two data sources. `BillingGroup`'s prop signature grows across Task 1 → 4 (`title, items, isStaff` → `+ onChanged` → `+ id`) and each task's full-file replace keeps `BillingSection`'s usage in sync with the current signature at that point — no task calls a prop that doesn't exist yet. `apply_bundle_to_job`'s parameter names (`target_job_id`, `target_bundle_id`) match exactly what `BillingSection.jsx`'s `supabase.rpc('apply_bundle_to_job', { target_job_id, target_bundle_id })` call sends.
