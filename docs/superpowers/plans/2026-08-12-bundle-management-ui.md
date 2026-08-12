# Bundle Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the bundle management screens (`/bundles`, `/bundles/new`, `/bundles/:id`) — list, create, edit, and archive a reusable job-type template and its line items — as specified in `docs/superpowers/specs/2026-08-12-bundle-management-ui-design.md`.

**Architecture:** Follows the exact `Catalog*` file/hook/form pattern (`useBundles` hook, `BundleList`/`BundleNew`/`BundleDetail` pages, `BundleForm` shared component) already established for `materials_catalog`. The one new piece with no precedent in this codebase is the line-item editor: an in-memory editable array (add/remove rows, live per-row and running totals) reconciled against `bundle_items` on save via sequential insert/update/delete calls, since no transaction/RPC pattern exists anywhere else in this app either.

**Tech Stack:** React 19 + Vite, `react-router-dom`, `@supabase/supabase-js` (all existing, no new dependencies — no form library, no table library, no state management library added).

## Global Constraints

- `bundles`/`bundle_items` schema and RLS already exist and are verified live — no schema changes in this plan.
- `materials_catalog.purchase_cost` is entered GST-inclusive already. Bundle line-item cost formula: `cost_inc_gst = purchase_cost` (no `tax_rate` applied on top), `price_inc_gst = cost_inc_gst × (1 + markup_pct / 100)`, `total_inc_gst = price_inc_gst × qty`.
- If a `materials_catalog` row's `purchase_cost` is `null`, treat it as `0` for these calculations (matches the existing display convention of showing `—` for a null purchase cost elsewhere in the app).
- Bundle list shows **both** active and archived bundles, with a status column — this is a deliberate difference from `useMaterialsCatalog`, which filters to `active = true` only. Do not copy that filter onto `useBundles`.
- No `sort_order` on `bundle_items` — line items display in insertion order (`created_at`). No reordering UI in this plan.
- The materials picker in the line-item editor only offers `materials_catalog` rows where `active = true`.
- Archive is one-way in this plan: a button sets `active = false` with a confirm step. No unarchive UI.
- "Total Markup" in the line-item editor footer shows **both** the dollar amount (`Total Price − Total Cost`) and a blended percentage (`(Total Markup $ / Total Cost) × 100`, guarded against divide-by-zero when Total Cost is `0`).
- Bundle/line-item saves are sequential Supabase calls, not a transaction — a partial failure mid-save is a known, accepted limitation (matches the rest of this app; no screen anywhere wraps multi-step writes in a transaction).
- Nav link hidden for `profile?.role === 'technician'`; no client-side route guard beyond that — RLS is the actual enforcement, same as every other screen in this app.
- This project has no automated JS test framework. Every task's "verify" step is a manual check (`npm run dev` + sign in as the admin/office/technician test accounts), matching the pattern used throughout every prior phase.

---

### Task 1: Bundle list screen

**Files:**
- Create: `src/hooks/useBundles.js`
- Create: `src/pages/BundleList.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `bundles` table (already live).
- Produces: `useBundles()` returning `{ bundles, loading, error }`, where each `bundles[i]` is `{ id, item_number, name, active }`.

- [ ] **Step 1: Create the useBundles hook**

Create `src/hooks/useBundles.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useBundles() {
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('bundles')
      .select('id, item_number, name, active')
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

Note: deliberately no `.eq('active', true)` filter — the list shows both active and archived bundles (see Global Constraints).

- [ ] **Step 2: Create the BundleList page**

Create `src/pages/BundleList.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { useBundles } from '../hooks/useBundles'

export default function BundleList() {
  const { bundles, loading, error } = useBundles()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundles: {error.message}</p>

  return (
    <div>
      <h1>Bundles</h1>
      <Link className="btn-primary" to="/bundles/new">Add Bundle</Link>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Item #</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bundles.map((bundle) => (
            <tr key={bundle.id}>
              <td><Link to={`/bundles/${bundle.id}`}>{bundle.name}</Link></td>
              <td>{bundle.item_number || '—'}</td>
              <td>{bundle.active ? 'Active' : 'Archived'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Add the nav link**

In `src/components/AppShell.jsx`, the current nav block is:

```jsx
<nav className="app-nav-links">
  <Link to="/">Dashboard</Link>
  <Link to="/clients">Clients</Link>
  <Link to="/jobs">Jobs</Link>
  {profile?.role !== 'technician' && <Link to="/catalog">Catalog</Link>}
</nav>
```

Replace it with:

```jsx
<nav className="app-nav-links">
  <Link to="/">Dashboard</Link>
  <Link to="/clients">Clients</Link>
  <Link to="/jobs">Jobs</Link>
  {profile?.role !== 'technician' && <Link to="/catalog">Catalog</Link>}
  {profile?.role !== 'technician' && <Link to="/bundles">Bundles</Link>}
</nav>
```

- [ ] **Step 4: Wire the route**

In `src/App.jsx`, add the import:

```jsx
import BundleList from './pages/BundleList'
```

And add the route (inside the existing `<Route element={<AppShell />}>` block, after the `/catalog/:id` route):

```jsx
<Route path="/bundles" element={<BundleList />} />
```

- [ ] **Step 5: Verify**

Run `npm run dev`.
- Sign in as admin or office: "Bundles" appears in the nav, after "Catalog". Click it — empty table (no bundles yet) with Name/Item #/Status headers and an "Add Bundle" button.
- Sign in as the technician account: no "Bundles" link in the nav at all.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBundles.js src/pages/BundleList.jsx src/components/AppShell.jsx src/App.jsx
git commit -m "feat: add bundle list screen"
```

---

### Task 2: Line-item editor, shared bundle form, and create flow

**Files:**
- Create: `src/lib/bundleCalc.js`
- Create: `src/hooks/useActiveMaterials.js`
- Create: `src/components/BundleLineItemsEditor.jsx`
- Create: `src/components/BundleForm.jsx`
- Create: `src/pages/BundleNew.jsx`
- Create: `src/pages/BundleDetail.jsx` (read-only view in this task; edit mode + archive added in Task 3)
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `bundles`, `bundle_items`, `materials_catalog` tables.
- Produces:
  - `calcPriceIncGst(costIncGst, markupPct)`, `calcTotalIncGst(costIncGst, markupPct, qty)`, `calcBundleTotals(items)` — reused by Task 3.
  - `useActiveMaterials()` returning `{ materials, loading, error }`, each `materials[i]` is `{ id, item_number, description, purchase_cost }`.
  - Line-item row shape used throughout: `{ _key, id, materials_catalog_id, item_number, description, purchase_cost, default_qty, default_markup_pct }` — `id` is `null` for a row not yet saved, the real `bundle_items.id` otherwise. `_key` is always a stable non-null value for React's `key` prop.
  - `<BundleLineItemsEditor items onItemsChange />` — controlled, `onItemsChange(nextItems)` called with a new array on every add/remove/field edit. Reused by `BundleForm` in Task 3's edit mode.
  - `<BundleForm initialValues onSubmit submitLabel />` — `initialValues` is `null` for create or `{ name, item_number, description, items }` for edit. `onSubmit` receives `{ name, item_number, description, items }` and must return `{ error }`.

- [ ] **Step 1: Create the shared calculation helpers**

Create `src/lib/bundleCalc.js`:

```js
export function calcPriceIncGst(costIncGst, markupPct) {
  return costIncGst * (1 + markupPct / 100)
}

export function calcTotalIncGst(costIncGst, markupPct, qty) {
  return calcPriceIncGst(costIncGst, markupPct) * qty
}

export function calcBundleTotals(items) {
  const totalCost = items.reduce((sum, item) => sum + (item.purchase_cost ?? 0) * item.default_qty, 0)
  const totalPrice = items.reduce(
    (sum, item) =>
      sum + calcTotalIncGst(item.purchase_cost ?? 0, item.default_markup_pct, item.default_qty),
    0
  )
  const totalMarkupDollar = totalPrice - totalCost
  const totalMarkupPct = totalCost === 0 ? 0 : (totalMarkupDollar / totalCost) * 100
  return { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct }
}
```

- [ ] **Step 2: Create the useActiveMaterials hook**

Create `src/hooks/useActiveMaterials.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useActiveMaterials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, purchase_cost')
      .eq('active', true)
      .order('description')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setMaterials(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { materials, loading, error }
}
```

- [ ] **Step 3: Create the line-item editor**

Create `src/components/BundleLineItemsEditor.jsx`:

```jsx
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

let nextKey = 0
function newKey() {
  nextKey += 1
  return `new-${nextKey}`
}

export default function BundleLineItemsEditor({ items, onItemsChange }) {
  const { materials, loading, error } = useActiveMaterials()

  function handleAddLine(e) {
    const materialId = e.target.value
    if (!materialId) return
    const material = materials.find((m) => m.id === materialId)
    if (!material) return
    onItemsChange([
      ...items,
      {
        _key: newKey(),
        id: null,
        materials_catalog_id: material.id,
        item_number: material.item_number,
        description: material.description,
        purchase_cost: material.purchase_cost,
        default_qty: 0,
        default_markup_pct: 0,
      },
    ])
    e.target.value = ''
  }

  function handleRemoveLine(key) {
    onItemsChange(items.filter((item) => item._key !== key))
  }

  function handleFieldChange(key, field, value) {
    onItemsChange(items.map((item) => (item._key === key ? { ...item, [field]: value } : item)))
  }

  if (loading) return <p>Loading materials...</p>
  if (error) return <p role="alert">Could not load materials: {error.message}</p>

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Markup %</th>
            <th>Price (inc. GST)</th>
            <th>Total (inc. GST)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const costIncGst = item.purchase_cost ?? 0
            const priceIncGst = calcPriceIncGst(costIncGst, item.default_markup_pct)
            const totalIncGst = calcTotalIncGst(costIncGst, item.default_markup_pct, item.default_qty)
            return (
              <tr key={item._key}>
                <td>{item.item_number || '—'}</td>
                <td>{item.description}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.default_qty}
                    onChange={(e) => handleFieldChange(item._key, 'default_qty', Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.default_markup_pct}
                    onChange={(e) =>
                      handleFieldChange(item._key, 'default_markup_pct', Number(e.target.value))
                    }
                  />
                </td>
                <td>${priceIncGst.toFixed(2)}</td>
                <td>${totalIncGst.toFixed(2)}</td>
                <td>
                  <button type="button" onClick={() => handleRemoveLine(item._key)}>
                    Remove
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">Totals</td>
            <td colSpan="2">
              Cost: ${totalCost.toFixed(2)} · Markup: ${totalMarkupDollar.toFixed(2)} (
              {totalMarkupPct.toFixed(1)}%) · Price: ${totalPrice.toFixed(2)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <label>
        Add line
        <select defaultValue="" onChange={handleAddLine}>
          <option value="" disabled>
            Select a material...
          </option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.item_number ? `${material.item_number} — ` : ''}
              {material.description}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Create the shared bundle form**

Create `src/components/BundleForm.jsx`:

```jsx
import { useState } from 'react'
import BundleLineItemsEditor from './BundleLineItemsEditor'

export default function BundleForm({ initialValues, onSubmit, submitLabel }) {
  const [values, setValues] = useState({
    name: initialValues?.name ?? '',
    item_number: initialValues?.item_number ?? '',
    description: initialValues?.description ?? '',
  })
  const [items, setItems] = useState(initialValues?.items ?? [])
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
      name: values.name,
      item_number: values.item_number || null,
      description: values.description || null,
      items,
    })
    setSaving(false)
    if (error) setError(error.message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Name
        <input value={values.name} onChange={(e) => updateField('name', e.target.value)} required />
      </label>
      <label>
        Item Number
        <input value={values.item_number} onChange={(e) => updateField('item_number', e.target.value)} />
      </label>
      <label>
        Description
        <input value={values.description} onChange={(e) => updateField('description', e.target.value)} />
      </label>
      <h2>Line Items</h2>
      <BundleLineItemsEditor items={items} onItemsChange={setItems} />
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
```

- [ ] **Step 5: Create the bundle creation page**

Create `src/pages/BundleNew.jsx`:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'

export default function BundleNew() {
  const navigate = useNavigate()

  async function handleCreate({ name, item_number, description, items }) {
    const { data: bundle, error: bundleError } = await supabase
      .from('bundles')
      .insert({ name, item_number, description })
      .select('id')
      .single()

    if (bundleError) return { error: bundleError }

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('bundle_items').insert(
        items.map((item) => ({
          bundle_id: bundle.id,
          materials_catalog_id: item.materials_catalog_id,
          default_qty: item.default_qty,
          default_markup_pct: item.default_markup_pct,
        }))
      )
      if (itemsError) return { error: itemsError }
    }

    navigate(`/bundles/${bundle.id}`)
    return { error: null }
  }

  return (
    <div>
      <h1>New Bundle</h1>
      <BundleForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Bundle" />
    </div>
  )
}
```

- [ ] **Step 6: Create the bundle detail page (read-only for this task)**

Create `src/pages/BundleDetail.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

export default function BundleDetail() {
  const { id } = useParams()
  const [bundle, setBundle] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('bundles').select('id, item_number, name, description, active').eq('id', id).single(),
      supabase
        .from('bundle_items')
        .select(
          'id, default_qty, default_markup_pct, materials_catalog:materials_catalog_id (id, item_number, description, purchase_cost)'
        )
        .eq('bundle_id', id)
        .order('created_at'),
    ]).then(([bundleResult, itemsResult]) => {
      if (cancelled) return
      if (bundleResult.error) {
        setError(bundleResult.error)
        setLoading(false)
        return
      }
      if (itemsResult.error) {
        setError(itemsResult.error)
        setLoading(false)
        return
      }
      setBundle(bundleResult.data)
      setItems(
        itemsResult.data.map((row) => ({
          _key: row.id,
          id: row.id,
          materials_catalog_id: row.materials_catalog.id,
          item_number: row.materials_catalog.item_number,
          description: row.materials_catalog.description,
          purchase_cost: row.materials_catalog.purchase_cost,
          default_qty: row.default_qty,
          default_markup_pct: row.default_markup_pct,
        }))
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundle: {error.message}</p>
  if (!bundle) return <p>Bundle not found.</p>

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <h1>{bundle.name}</h1>
      <p>Item Number: {bundle.item_number || '—'}</p>
      <p>Description: {bundle.description || '—'}</p>
      <p>Status: {bundle.active ? 'Active' : 'Archived'}</p>
      <h2>Line Items</h2>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Markup %</th>
            <th>Price (inc. GST)</th>
            <th>Total (inc. GST)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const costIncGst = item.purchase_cost ?? 0
            const priceIncGst = calcPriceIncGst(costIncGst, item.default_markup_pct)
            const totalIncGst = calcTotalIncGst(costIncGst, item.default_markup_pct, item.default_qty)
            return (
              <tr key={item._key}>
                <td>{item.item_number || '—'}</td>
                <td>{item.description}</td>
                <td>{item.default_qty}</td>
                <td>{item.default_markup_pct}</td>
                <td>${priceIncGst.toFixed(2)}</td>
                <td>${totalIncGst.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">Totals</td>
            <td colSpan="2">
              Cost: ${totalCost.toFixed(2)} · Markup: ${totalMarkupDollar.toFixed(2)} (
              {totalMarkupPct.toFixed(1)}%) · Price: ${totalPrice.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
```

- [ ] **Step 7: Wire the routes**

In `src/App.jsx`, add the imports:

```jsx
import BundleNew from './pages/BundleNew'
import BundleDetail from './pages/BundleDetail'
```

And the routes (after the `/bundles` route added in Task 1):

```jsx
<Route path="/bundles/new" element={<BundleNew />} />
<Route path="/bundles/:id" element={<BundleDetail />} />
```

- [ ] **Step 8: Verify**

Run `npm run dev`.
1. Sign in as admin. Go to Bundles → Add Bundle. Enter name "Concrete Roof Restoration", item number "CRR-01", description "Standard concrete tile restoration package".
2. In the "Add line" dropdown, confirm only active materials appear (if you have an archived `materials_catalog` row from earlier testing, confirm it's absent). Add two different materials. Set qty and markup % on each — confirm the Price and Total columns update live as you type, and the footer's Total Cost / Total Markup ($ and %) / Total Price recompute live too.
3. Submit. Confirm you land on `/bundles/:id` showing the name, item number, description, "Active" status, and both line items with the same numbers you saw in the editor.
4. Go back to the Bundles list — confirm the new bundle appears with its name linked and "Active" status.

- [ ] **Step 9: Commit**

```bash
git add src/lib/bundleCalc.js src/hooks/useActiveMaterials.js src/components/BundleLineItemsEditor.jsx src/components/BundleForm.jsx src/pages/BundleNew.jsx src/pages/BundleDetail.jsx src/App.jsx
git commit -m "feat: add bundle creation flow with line-item editor"
```

---

### Task 3: Edit mode, save reconciliation, and archive

**Files:**
- Modify: `src/pages/BundleDetail.jsx`

**Interfaces:**
- Consumes: `BundleForm` (Task 2), `calcPriceIncGst`/`calcTotalIncGst`/`calcBundleTotals` (Task 2).
- Produces: full edit + archive capability on `/bundles/:id`. No new exports consumed elsewhere.

- [ ] **Step 1: Replace BundleDetail with the edit + archive version**

Replace the full contents of `src/pages/BundleDetail.jsx` with:

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

export default function BundleDetail() {
  const { id } = useParams()
  const [bundle, setBundle] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('bundles').select('id, item_number, name, description, active').eq('id', id).single(),
      supabase
        .from('bundle_items')
        .select(
          'id, default_qty, default_markup_pct, materials_catalog:materials_catalog_id (id, item_number, description, purchase_cost)'
        )
        .eq('bundle_id', id)
        .order('created_at'),
    ]).then(([bundleResult, itemsResult]) => {
      if (cancelled) return
      if (bundleResult.error) {
        setError(bundleResult.error)
        setLoading(false)
        return
      }
      if (itemsResult.error) {
        setError(itemsResult.error)
        setLoading(false)
        return
      }
      setBundle(bundleResult.data)
      setItems(
        itemsResult.data.map((row) => ({
          _key: row.id,
          id: row.id,
          materials_catalog_id: row.materials_catalog.id,
          item_number: row.materials_catalog.item_number,
          description: row.materials_catalog.description,
          purchase_cost: row.materials_catalog.purchase_cost,
          default_qty: row.default_qty,
          default_markup_pct: row.default_markup_pct,
        }))
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundle: {error.message}</p>
  if (!bundle) return <p>Bundle not found.</p>

  async function handleUpdate({ name, item_number, description, items: submittedItems }) {
    const { error: bundleError } = await supabase
      .from('bundles')
      .update({ name, item_number, description })
      .eq('id', id)
    if (bundleError) return { error: bundleError }

    const originalIds = new Set(items.filter((item) => item.id).map((item) => item.id))
    const submittedIds = new Set(submittedItems.filter((item) => item.id).map((item) => item.id))

    const toDelete = [...originalIds].filter((itemId) => !submittedIds.has(itemId))
    const toInsert = submittedItems.filter((item) => !item.id)
    const toUpdate = submittedItems.filter((item) => {
      if (!item.id) return false
      const original = items.find((orig) => orig.id === item.id)
      return (
        original &&
        (original.default_qty !== item.default_qty ||
          original.default_markup_pct !== item.default_markup_pct)
      )
    })

    if (toDelete.length > 0) {
      const { error } = await supabase.from('bundle_items').delete().in('id', toDelete)
      if (error) return { error }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('bundle_items').insert(
        toInsert.map((item) => ({
          bundle_id: id,
          materials_catalog_id: item.materials_catalog_id,
          default_qty: item.default_qty,
          default_markup_pct: item.default_markup_pct,
        }))
      )
      if (error) return { error }
    }

    for (const item of toUpdate) {
      const { error } = await supabase
        .from('bundle_items')
        .update({ default_qty: item.default_qty, default_markup_pct: item.default_markup_pct })
        .eq('id', item.id)
      if (error) return { error }
    }

    setBundle((prev) => ({ ...prev, name, item_number, description }))
    setItems(submittedItems)
    setEditing(false)
    return { error: null }
  }

  async function handleArchive() {
    if (
      !window.confirm('Archive this bundle? It will no longer be offered when applying a bundle to a job.')
    ) {
      return
    }
    setArchiving(true)
    const { error } = await supabase.from('bundles').update({ active: false }).eq('id', id)
    setArchiving(false)
    if (!error) setBundle((prev) => ({ ...prev, active: false }))
  }

  if (editing) {
    return (
      <div>
        <h1>Edit {bundle.name}</h1>
        <BundleForm initialValues={{ ...bundle, items }} onSubmit={handleUpdate} submitLabel="Save Changes" />
      </div>
    )
  }

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <h1>{bundle.name}</h1>
      <p>Item Number: {bundle.item_number || '—'}</p>
      <p>Description: {bundle.description || '—'}</p>
      <p>Status: {bundle.active ? 'Active' : 'Archived'}</p>
      <button className="btn-primary" onClick={() => setEditing(true)}>
        Edit Bundle
      </button>
      {bundle.active && (
        <button onClick={handleArchive} disabled={archiving}>
          {archiving ? 'Archiving...' : 'Archive'}
        </button>
      )}
      <h2>Line Items</h2>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Markup %</th>
            <th>Price (inc. GST)</th>
            <th>Total (inc. GST)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const costIncGst = item.purchase_cost ?? 0
            const priceIncGst = calcPriceIncGst(costIncGst, item.default_markup_pct)
            const totalIncGst = calcTotalIncGst(costIncGst, item.default_markup_pct, item.default_qty)
            return (
              <tr key={item._key}>
                <td>{item.item_number || '—'}</td>
                <td>{item.description}</td>
                <td>{item.default_qty}</td>
                <td>{item.default_markup_pct}</td>
                <td>${priceIncGst.toFixed(2)}</td>
                <td>${totalIncGst.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">Totals</td>
            <td colSpan="2">
              Cost: ${totalCost.toFixed(2)} · Markup: ${totalMarkupDollar.toFixed(2)} (
              {totalMarkupPct.toFixed(1)}%) · Price: ${totalPrice.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Verify — edit reconciliation**

Run `npm run dev`, sign in as admin, open the bundle created in Task 2.
1. Click "Edit Bundle". Change the qty on one existing line, remove a second existing line, and add a brand-new third line via the picker. Click "Save Changes".
2. Confirm the read view immediately shows the updated qty, the removed line gone, and the new line present with correct calculated price/total.
3. **Reload the browser page** (not just re-render) to force a fresh fetch from the database. Confirm all three changes persisted — this is the real test of the insert/update/delete reconciliation logic, not just optimistic local state.

- [ ] **Step 3: Verify — archive**

1. Still signed in as admin, on the same bundle's detail page, click "Archive" and confirm the browser confirm dialog. Confirm the "Status" line flips to "Archived" and the Archive button disappears.
2. Go to the Bundles list — confirm this bundle now shows "Archived" in the Status column (and is still visible in the list, not hidden).

- [ ] **Step 4: Verify — office and technician**

1. Sign out, sign in as office. Open a bundle, edit a line item's qty, save, confirm it persists on reload — office has the same full access as admin (RLS already verified live at the DB layer; this is a UI sanity pass).
2. Sign out, sign in as the technician account. Confirm there's no "Bundles" nav link. Manually navigate to an existing bundle's `/bundles/<id>` URL directly — confirm it shows "Could not load bundle" or "Bundle not found" rather than leaking any bundle or line-item data (RLS returns zero rows/an error for a role with no policy, same behavior already confirmed for `/catalog/:id` in the materials catalog phase).

- [ ] **Step 5: Commit**

```bash
git add src/pages/BundleDetail.jsx
git commit -m "feat: add bundle editing and archive actions"
```

---

## Self-Review

**Spec coverage:** `/bundles` list with status column (Task 1) covers the List UI section. Line-item editor with active-only materials picker, live per-row and running totals including the $ + % Total Markup (Task 2) covers the Line-item editor section. Sequential insert/update/delete reconciliation on save (Task 3) covers the Save/reconcile logic section, including the explicitly-named partial-failure limitation (documented in Global Constraints, not silently hidden). Archive action with confirm (Task 3) covers the Archive section. Access control (nav hiding + RLS-only enforcement) is covered in Task 1 and re-verified in Task 3. Out-of-scope items (apply-to-job, job detail billing section, `job_line_items`/`job_applied_bundles` changes, sort_order/reordering UI, unarchive UI) correctly have no corresponding task.

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code; every verify step has concrete actions and expected results, not "add appropriate error handling"-style hand-waving.

**Type/name consistency:** Line-item row shape (`_key, id, materials_catalog_id, item_number, description, purchase_cost, default_qty, default_markup_pct`) is identical across `BundleLineItemsEditor` (Task 2), the `BundleDetail` read fetch (Task 2 and Task 3), and the `BundleNew`/`handleUpdate` insert payloads (Task 2/3) — the insert/update payloads correctly select only the DB columns (`bundle_id, materials_catalog_id, default_qty, default_markup_pct`) and drop the UI-only `_key`/`item_number`/`description`/`purchase_cost` fields. `BundleForm`'s `onSubmit` payload shape (`name, item_number, description, items`) matches exactly what `BundleNew.handleCreate` and `BundleDetail.handleUpdate` (Task 3) both consume. `calcPriceIncGst`/`calcTotalIncGst`/`calcBundleTotals` (Task 2) are imported with identical signatures in `BundleLineItemsEditor` and both versions of `BundleDetail` — no drift between the editor's live totals and the read view's totals.
