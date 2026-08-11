# Materials & Services Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Materials & Services price-list catalog (table, RLS, list screen, create/edit screens) as specified in `docs/superpowers/specs/2026-08-11-materials-catalog-design.md`.

**Architecture:** New `materials_catalog` table, RLS-restricted to admin/office (no policy for technicians, same pattern as `job_costs`). UI follows the exact same hook + list-page + form-component + new/detail-page pattern already established for clients and jobs in the Day 3-4 build.

**Tech Stack:** React 19 + Vite, `react-router-dom`, `@supabase/supabase-js` (all existing, no new dependencies). One new SQL schema file and one new SQL policies file, run manually in the Supabase SQL Editor (this project has no migration runner).

## Global Constraints

- `item_number` is optional text, not unique-constrained.
- `description` is required; it is the item's sole name/description field (no separate "name" column).
- `item_type` is constrained to exactly `'material'` or `'service'`.
- `tax_rate` defaults to `10.00` (Australia GST) but is stored per-row and editable, not hardcoded in app code.
- `price_includes_tax` defaults to `false`.
- `active` defaults to `true`; the list screen only shows `active = true` rows. No archive/deactivate UI control in this plan (deferred) — the column exists so it's safe to hand-set via SQL if ever needed, but there's no button for it yet.
- Admin and office both get full CRUD (select/insert/update/delete) via RLS. No policy at all for technicians — Postgres RLS denies by default.
- Catalog nav link in `AppShell` is hidden when `profile.role === 'technician'`. No additional client-side route guard beyond that — consistent with how `/clients/new` etc. are handled elsewhere (RLS is the actual enforcement).
- No computed tax-inclusive/exclusive price shown anywhere — display only what's stored.
- This project has no automated JS test framework. Every task's "verify" step is a manual check (`npm run dev` + sign in as test accounts), matching the pattern used throughout Day 1-4.

---

### Task 1: `materials_catalog` table and RLS policies

**Files:**
- Create: `supabase/schema/007_materials_catalog.sql`
- Create: `supabase/policies/008_materials_catalog_policies.sql`

**Interfaces:**
- Produces: table `public.materials_catalog` with columns `id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active, created_at`, consumed by every task below.

- [ ] **Step 1: Create the schema file**

Create `supabase/schema/007_materials_catalog.sql`:

```sql
create table public.materials_catalog (
  id uuid primary key default gen_random_uuid(),
  item_number text,
  description text not null,
  item_type text not null check (item_type in ('material', 'service')),
  price numeric(10, 2) not null,
  purchase_cost numeric(10, 2),
  tax_rate numeric(4, 2) not null default 10.00,
  price_includes_tax boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.materials_catalog is 'Reusable price list of materials and services, similar to ServiceM8''s catalog. Admin/office only -- technicians have no access.';
```

- [ ] **Step 2: Create the policies file**

Create `supabase/policies/008_materials_catalog_policies.sql`:

```sql
alter table public.materials_catalog enable row level security;

create policy "materials_catalog_admin_all" on public.materials_catalog
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "materials_catalog_office_all" on public.materials_catalog
  for all
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as job_costs.
```

- [ ] **Step 3: Run both files against the live Supabase project**

In the Supabase SQL Editor, run `007_materials_catalog.sql` then `008_materials_catalog_policies.sql`, in that order (schema before policies, matching how every prior table was set up).

- [ ] **Step 4: Verify RLS with role impersonation**

In the SQL Editor, run each of these as separate submissions (per the project's established gotcha: only the last statement's result shows when several run together):

Admin/office should see and be able to insert:
```sql
select set_config('request.jwt.claims', json_build_object('sub', '<admin-user-id>')::text, true);
set local role authenticated;
insert into public.materials_catalog (description, item_type, price) values ('Test Item', 'material', 10.00) returning id;
```
Expected: succeeds, returns a row.

Technician should see nothing:
```sql
select set_config('request.jwt.claims', json_build_object('sub', '<technician-user-id>')::text, true);
set local role authenticated;
select * from public.materials_catalog;
```
Expected: zero rows.

Clean up the test row afterward (`delete from public.materials_catalog where description = 'Test Item';`, run as admin via the SQL Editor's default role — not required to be RLS-impersonated for cleanup).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema/007_materials_catalog.sql supabase/policies/008_materials_catalog_policies.sql
git commit -m "feat: add materials_catalog table and RLS policies"
```

---

### Task 2: Catalog list screen

**Files:**
- Create: `src/hooks/useMaterialsCatalog.js`
- Create: `src/pages/CatalogList.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `materials_catalog` table (Task 1).
- Produces: `useMaterialsCatalog()` returning `{ items, loading, error }`, where each `items[i]` is `{ id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active }`.

- [ ] **Step 1: Create the useMaterialsCatalog hook**

Create `src/hooks/useMaterialsCatalog.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useMaterialsCatalog() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active')
      .eq('active', true)
      .order('description')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setItems(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { items, loading, error }
}
```

- [ ] **Step 2: Create the CatalogList page**

Create `src/pages/CatalogList.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { useMaterialsCatalog } from '../hooks/useMaterialsCatalog'

export default function CatalogList() {
  const { items, loading, error } = useMaterialsCatalog()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load catalog: {error.message}</p>

  return (
    <div>
      <h1>Materials & Services</h1>
      <Link className="btn-primary" to="/catalog/new">Add Item</Link>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Type</th>
            <th>Price</th>
            <th>Purchase Cost</th>
            <th>Tax Incl.?</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.item_number || '—'}</td>
              <td><Link to={`/catalog/${item.id}`}>{item.description}</Link></td>
              <td>{item.item_type}</td>
              <td>${item.price}</td>
              <td>{item.purchase_cost != null ? `$${item.purchase_cost}` : '—'}</td>
              <td>{item.price_includes_tax ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Add the nav link**

In `src/components/AppShell.jsx`, add the Catalog link, hidden for technicians. Replace the `<nav className="app-nav-links">` block with:

```jsx
<nav className="app-nav-links">
  <Link to="/">Dashboard</Link>
  <Link to="/clients">Clients</Link>
  <Link to="/jobs">Jobs</Link>
  {profile?.role !== 'technician' && <Link to="/catalog">Catalog</Link>}
</nav>
```

- [ ] **Step 4: Wire the route**

In `src/App.jsx`, add the import and route:

```jsx
import CatalogList from './pages/CatalogList'
```
```jsx
<Route path="/catalog" element={<CatalogList />} />
```

- [ ] **Step 5: Verify**

Run `npm run dev`.
- Sign in as admin or office: "Catalog" appears in the nav. Click it — empty table (no items yet) with column headers and an "Add Item" button.
- Sign in as the technician account: no "Catalog" link in the nav at all.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMaterialsCatalog.js src/pages/CatalogList.jsx src/components/AppShell.jsx src/App.jsx
git commit -m "feat: add materials catalog list screen"
```

---

### Task 3: Catalog create and edit screens

**Files:**
- Create: `src/components/CatalogForm.jsx`
- Create: `src/pages/CatalogNew.jsx`
- Create: `src/pages/CatalogDetail.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `materials_catalog` table (Task 1).
- Produces: `<CatalogForm initialValues onSubmit submitLabel />` — same controlled-form pattern as `ClientForm`/`JobForm`.

- [ ] **Step 1: Create the shared catalog form**

Create `src/components/CatalogForm.jsx`:

```jsx
import { useState } from 'react'

export default function CatalogForm({ initialValues, onSubmit, submitLabel }) {
  const [values, setValues] = useState({
    item_number: initialValues?.item_number ?? '',
    description: initialValues?.description ?? '',
    item_type: initialValues?.item_type ?? 'material',
    price: initialValues?.price ?? '',
    purchase_cost: initialValues?.purchase_cost ?? '',
    tax_rate: initialValues?.tax_rate ?? '10.00',
    price_includes_tax: initialValues?.price_includes_tax ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function updateField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await onSubmit({
      item_number: values.item_number || null,
      description: values.description,
      item_type: values.item_type,
      price: Number(values.price),
      purchase_cost: values.purchase_cost === '' ? null : Number(values.purchase_cost),
      tax_rate: Number(values.tax_rate),
      price_includes_tax: values.price_includes_tax,
    })
    setSaving(false)
    if (error) setError(error.message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Item Number
        <input value={values.item_number} onChange={(e) => updateField('item_number', e.target.value)} />
      </label>
      <label>
        Description
        <input
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
          required
        />
      </label>
      <label>
        Type
        <select value={values.item_type} onChange={(e) => updateField('item_type', e.target.value)}>
          <option value="material">Material</option>
          <option value="service">Service</option>
        </select>
      </label>
      <label>
        Price
        <input
          type="number"
          step="0.01"
          value={values.price}
          onChange={(e) => updateField('price', e.target.value)}
          required
        />
      </label>
      <label>
        Purchase Cost
        <input
          type="number"
          step="0.01"
          value={values.purchase_cost}
          onChange={(e) => updateField('purchase_cost', e.target.value)}
        />
      </label>
      <label>
        Tax Rate (%)
        <input
          type="number"
          step="0.01"
          value={values.tax_rate}
          onChange={(e) => updateField('tax_rate', e.target.value)}
          required
        />
      </label>
      <label>
        Price Includes Tax
        <select
          value={values.price_includes_tax ? 'true' : 'false'}
          onChange={(e) => updateField('price_includes_tax', e.target.value === 'true')}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Create the catalog item creation page**

Create `src/pages/CatalogNew.jsx`:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import CatalogForm from '../components/CatalogForm'

export default function CatalogNew() {
  const navigate = useNavigate()

  async function handleCreate(values) {
    const { data, error } = await supabase
      .from('materials_catalog')
      .insert(values)
      .select('id')
      .single()

    if (!error) navigate(`/catalog/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Catalog Item</h1>
      <CatalogForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Item" />
    </div>
  )
}
```

- [ ] **Step 3: Create the catalog item detail page**

Create `src/pages/CatalogDetail.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import CatalogForm from '../components/CatalogForm'

export default function CatalogDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setItem(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load item: {error.message}</p>
  if (!item) return <p>Item not found.</p>

  async function handleUpdate(values) {
    const { error } = await supabase.from('materials_catalog').update(values).eq('id', id)
    if (!error) {
      setItem({ ...item, ...values })
      setEditing(false)
    }
    return { error }
  }

  return (
    <div>
      <h1>{item.description}</h1>
      {editing ? (
        <CatalogForm initialValues={item} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Item Number: {item.item_number || '—'}</p>
          <p>Type: {item.item_type}</p>
          <p>Price: ${item.price}</p>
          <p>Purchase Cost: {item.purchase_cost != null ? `$${item.purchase_cost}` : '—'}</p>
          <p>Tax Rate: {item.tax_rate}%</p>
          <p>Price Includes Tax: {item.price_includes_tax ? 'Yes' : 'No'}</p>
          <button className="btn-primary" onClick={() => setEditing(true)}>
            Edit Item
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the routes**

In `src/App.jsx`, add the imports and routes:

```jsx
import CatalogNew from './pages/CatalogNew'
import CatalogDetail from './pages/CatalogDetail'
```
```jsx
<Route path="/catalog/new" element={<CatalogNew />} />
<Route path="/catalog/:id" element={<CatalogDetail />} />
```

- [ ] **Step 5: Verify**

Run `npm run dev`.
1. Sign in as admin. Go to Catalog → Add Item. Enter item number "RF-100", description "Colorbond Roof Sheet", type Material, price 45.00, purchase cost 28.00, leave tax rate at 10.00, price includes tax No. Submit — lands on the detail page showing all fields correctly.
2. Go back to the Catalog list — confirm the new item appears with the description linked, item number, type, price, purchase cost, and "No" for tax-inclusive.
3. Open the item, click "Edit Item", change price to 50.00 and price-includes-tax to Yes, save — confirm both changes persist after the page reloads.
4. Sign out, sign in as office — confirm the same item is visible and editable.
5. Sign out, sign in as the technician account — confirm there's no way to reach `/catalog` via the nav, and that manually navigating to the URL shows an empty/blocked result (RLS enforcement, no data leak).

- [ ] **Step 6: Commit**

```bash
git add src/components/CatalogForm.jsx src/pages/CatalogNew.jsx src/pages/CatalogDetail.jsx src/App.jsx
git commit -m "feat: add materials catalog create and edit screens"
```

---

## Self-Review

**Spec coverage:** Table + RLS (Task 1) covers the full data model and access-control sections of the spec. List screen (Task 2) and create/edit screens (Task 3) cover the full UI section. The `job_costs`-left-as-is decision required no task (no code change). All explicitly-deferred items (bundles, job billing integration, inactive-item filter, computed tax display) are correctly absent from every task.

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.

**Type/name consistency:** `useMaterialsCatalog()` (Task 2) and the direct fetch in `CatalogDetail` (Task 3) select the identical column list, so `CatalogForm`'s `initialValues` shape matches what both callers provide. `CatalogForm`'s `onSubmit` payload shape (`item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax`) matches exactly what `CatalogNew.handleCreate` inserts and `CatalogDetail.handleUpdate` updates — no extra/missing fields.
