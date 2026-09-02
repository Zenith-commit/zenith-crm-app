# Bundle/Quote UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable materials picker (replacing two plain `<select>` dropdowns), a "Duplicate Bundle" action, and a "Duplicate line item" action on both the bundle template editor and the job billing view.

**Architecture:** No schema/RLS changes. One new shared component (`MaterialPicker`) replaces two existing plain `<select>` controls. "Duplicate Bundle" reuses `BundleForm`'s already-existing `initialValues.items` support via React Router state. "Duplicate line item" is an in-memory clone in the bundle editor and a real `job_line_items` insert in job billing.

**Tech Stack:** React + Vite, Supabase. No automated JS test framework in this repo — verification is manual browser testing plus `npm run lint`/`npm run build` as a baseline check, same as the prior two features this session.

**Spec:** `docs/superpowers/specs/2026-09-02-bundle-quote-ux-design.md`

## Global Constraints

- No new dependency — `MaterialPicker` is built with plain React state, matching this app's existing no-extra-libraries convention.
- `MaterialPicker` selection uses `onMouseDown` with `e.preventDefault()` on each result (not `onClick`), so the option's mousedown fires and closes the list deliberately before the input's `onBlur` would otherwise race it.
- Real overlay CSS for `MaterialPicker`'s results list from the start (`position: relative` wrapper, `position: absolute` list) — not deferred to a follow-up fix.
- All three actions (Duplicate Bundle, Duplicate line item in both surfaces) are staff-only, matching the existing Edit/Remove/Archive/Delete precedent already on these same screens — no new guard needed beyond following the pattern already there.
- Two decisions here were confirmed via direct answer in-session, not independently re-checked with the client (see spec): duplicating a bundle copies `item_number` verbatim; a duplicated job billing line item stays in the same bundle group as the original.
- `price_inc_gst`/`total_inc_gst` on `job_line_items` are stored generated columns — never included in an insert payload.

---

### Task 1: `MaterialPicker` component, wired into the bundle editor

**Files:**
- Create: `src/components/MaterialPicker.jsx`
- Modify: `src/index.css`
- Modify: `src/components/BundleLineItemsEditor.jsx`

**Interfaces:**
- Produces: `MaterialPicker({ materials, onSelect, selectedLabel, placeholder })` — a controlled-display combobox. `materials` is the array already loaded by the caller (no fetching inside this component). `onSelect(material)` fires with the full material object on selection. `selectedLabel` is what the input shows when unfocused and empty-query; pass `""` for "always resets after use" callers, or the current selection's display text for "persists until changed" callers. Consumed by Task 2 (`AddOneOffLineItemForm`) as well as this task.

- [ ] **Step 1: Write `MaterialPicker.jsx`**

```jsx
import { useState } from 'react'

export default function MaterialPicker({ materials, onSelect, selectedLabel, placeholder }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = query
    ? materials.filter((material) => {
        const q = query.toLowerCase()
        return (
          material.description.toLowerCase().includes(q) ||
          (material.item_number ?? '').toLowerCase().includes(q)
        )
      })
    : materials

  function handleSelect(material) {
    onSelect(material)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="material-picker">
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="material-picker-results">
          {filtered.length === 0 ? (
            <li className="material-picker-empty">No matches</li>
          ) : (
            filtered.map((material) => (
              <li key={material.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(material)
                  }}
                >
                  {material.item_number ? `${material.item_number} — ` : ''}
                  {material.description}
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

- [ ] **Step 2: Add overlay CSS**

In `src/index.css`, add (anywhere after the existing `.notification-dropdown, .feedback-dropdown` rule is fine):

```css
.material-picker {
  position: relative;
  display: inline-block;
  width: 100%;
  max-width: 400px;
}

.material-picker-results {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  width: 100%;
  max-height: 240px;
  overflow-y: auto;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.material-picker-results li {
  border-bottom: 1px solid var(--border);
}

.material-picker-results li:last-child {
  border-bottom: none;
}

.material-picker-results button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
}

.material-picker-results button:hover {
  background: var(--border);
}

.material-picker-empty {
  padding: 6px 10px;
  color: var(--text);
}
```

- [ ] **Step 3: Wire `MaterialPicker` into `BundleLineItemsEditor.jsx`**

Replace the entire file with:

```jsx
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'
import MaterialPicker from './MaterialPicker'

let nextKey = 0
function newKey() {
  nextKey += 1
  return `new-${nextKey}`
}

export default function BundleLineItemsEditor({ items, onItemsChange }) {
  const { materials, loading, error } = useActiveMaterials()

  function handleAddLine(material) {
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
        <MaterialPicker
          materials={materials}
          onSelect={handleAddLine}
          selectedLabel=""
          placeholder="Search materials..."
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Confirm lint and build are clean**

Run: `npm run lint && npm run build`
Expected: both complete with no errors.

- [ ] **Step 5: Manually verify in the browser**

Start the dev server (`npm run dev`) and open the bundle editor (New Bundle or an existing bundle's Edit mode). Confirm: focusing the "Add line" field shows the full materials list; typing narrows it by both description and item number; clicking a result (not just pressing Enter) adds the line and the field resets to blank; the results list closes on blur without losing a click-in-progress.

- [ ] **Step 6: Commit**

```bash
git add src/components/MaterialPicker.jsx src/index.css src/components/BundleLineItemsEditor.jsx
git commit -m "feat: add searchable MaterialPicker, wire into bundle editor"
```

---

### Task 2: Wire `MaterialPicker` into the one-off job line item form

**Files:**
- Modify: `src/components/AddOneOffLineItemForm.jsx`

**Interfaces:**
- Consumes: `MaterialPicker` from Task 1.

- [ ] **Step 1: Replace the file's material-selection state and markup**

Replace the entire file with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst } from '../lib/bundleCalc'
import MaterialPicker from './MaterialPicker'

export default function AddOneOffLineItemForm({ jobId, onAdded }) {
  const { materials } = useActiveMaterials()
  const [selectedMaterial, setSelectedMaterial] = useState(null)
  const [qty, setQty] = useState(1)
  const [markupPct, setMarkupPct] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
    setSelectedMaterial(null)
    setQty(1)
    setMarkupPct(0)
    await onAdded()
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Add One-off Item</h3>
      <label>
        Material
        <MaterialPicker
          materials={materials}
          onSelect={setSelectedMaterial}
          selectedLabel={selectedMaterial?.description ?? ''}
          placeholder="Search materials..."
        />
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

- [ ] **Step 2: Confirm lint and build are clean**

Run: `npm run lint && npm run build`

- [ ] **Step 3: Manually verify in the browser**

On a job's Billing section, confirm the "Add One-off Item" form's Material field behaves the same as Task 1's (search by description/item number, click to select), and that the selected material's name persists visibly in the field until changed — unlike the bundle editor's reset-to-blank behavior. Confirm qty/markup preview and "Add Item" submission still work end to end.

- [ ] **Step 4: Commit**

```bash
git add src/components/AddOneOffLineItemForm.jsx
git commit -m "feat: use MaterialPicker in the one-off job line item form"
```

---

### Task 3: "Duplicate Bundle"

**Files:**
- Modify: `src/pages/BundleDetail.jsx`
- Modify: `src/pages/BundleNew.jsx`

**Interfaces:**
- Consumes: `BundleForm`'s existing (unmodified) `initialValues.items` support.

- [ ] **Step 1: Add the duplicate handler and button to `BundleDetail.jsx`**

Add this function inside the component, near the other handlers (e.g. after `handleDelete`):

```js
  function handleDuplicate() {
    navigate('/bundles/new', {
      state: {
        name: `Copy of ${bundle.name}`,
        item_number: bundle.item_number,
        description: bundle.description,
        items: items.map((item) => ({
          _key: item.id,
          id: null,
          materials_catalog_id: item.materials_catalog_id,
          item_number: item.item_number,
          description: item.description,
          purchase_cost: item.purchase_cost,
          default_qty: item.default_qty,
          default_markup_pct: item.default_markup_pct,
        })),
      },
    })
  }
```

Add the button right after the existing "Edit Bundle" button:

```jsx
      <button className="btn-primary" onClick={() => setEditing(true)}>
        Edit Bundle
      </button>
      <button onClick={handleDuplicate}>Duplicate</button>
```

- [ ] **Step 2: Read the router state in `BundleNew.jsx`**

Replace:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'

export default function BundleNew() {
  const navigate = useNavigate()
```

With:

```jsx
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'

export default function BundleNew() {
  const navigate = useNavigate()
  const location = useLocation()
```

And replace:

```jsx
      <BundleForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Bundle" />
```

With:

```jsx
      <BundleForm initialValues={location.state ?? null} onSubmit={handleCreate} submitLabel="Create Bundle" />
```

- [ ] **Step 3: Confirm lint and build are clean**

Run: `npm run lint && npm run build`

- [ ] **Step 4: Manually verify in the browser**

From an existing bundle's detail page (try both an active and an archived bundle), click "Duplicate" and confirm: lands on `/bundles/new` with the name pre-filled as "Copy of {original name}", the same item number and description, and every line item present with matching qty/markup. Confirm nothing is created in the database until "Create Bundle" is actually clicked, and that the result is `active: true` regardless of the source bundle's status.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BundleDetail.jsx src/pages/BundleNew.jsx
git commit -m "feat: add Duplicate Bundle action"
```

---

### Task 4: "Duplicate line item" — bundle editor

**Files:**
- Modify: `src/components/BundleLineItemsEditor.jsx`

**Interfaces:**
- Builds on Task 1's version of this file.

- [ ] **Step 1: Add the duplicate handler**

Add this function after the existing `handleRemoveLine`:

```js
  function handleDuplicateLine(key) {
    const index = items.findIndex((item) => item._key === key)
    if (index === -1) return
    const clone = { ...items[index], _key: newKey(), id: null }
    const next = [...items]
    next.splice(index + 1, 0, clone)
    onItemsChange(next)
  }
```

- [ ] **Step 2: Add the button to the row's actions cell**

Replace:

```jsx
                <td>
                  <button type="button" onClick={() => handleRemoveLine(item._key)}>
                    Remove
                  </button>
                </td>
```

With:

```jsx
                <td>
                  <button type="button" onClick={() => handleDuplicateLine(item._key)}>
                    Duplicate
                  </button>
                  <button type="button" onClick={() => handleRemoveLine(item._key)}>
                    Remove
                  </button>
                </td>
```

- [ ] **Step 3: Confirm lint and build are clean**

Run: `npm run lint && npm run build`

- [ ] **Step 4: Manually verify in the browser**

In the bundle editor, click "Duplicate" on an existing line and confirm a clone appears directly after it (same material/qty/markup), independently editable, and that removing or editing the clone doesn't affect the original. Confirm nothing persists until the bundle form itself is saved.

- [ ] **Step 5: Commit**

```bash
git add src/components/BundleLineItemsEditor.jsx
git commit -m "feat: add Duplicate line item to the bundle editor"
```

---

### Task 5: "Duplicate line item" — job billing

**Files:**
- Modify: `src/hooks/useJobBilling.js`
- Modify: `src/components/BillingGroup.jsx`

**Interfaces:**
- Consumes: extended `job_line_items` columns from `useJobBilling`.

- [ ] **Step 1: Extend the staff-role query in `useJobBilling.js`**

Replace:

```js
      supabase
        .from('job_line_items')
        .select('id, item_name_snapshot, qty, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id')
        .eq('job_id', jobId)
        .order('created_at'),
```

With:

```js
      supabase
        .from('job_line_items')
        .select(
          'id, job_id, materials_catalog_id, item_code_snapshot, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id'
        )
        .eq('job_id', jobId)
        .order('created_at'),
```

- [ ] **Step 2: Add the duplicate handler and button to `BillingGroup.jsx`**

Add this function after the existing `handleRemoveItem`:

```js
  async function handleDuplicateItem(item) {
    const { error } = await supabase.from('job_line_items').insert({
      job_id: item.job_id,
      materials_catalog_id: item.materials_catalog_id,
      item_code_snapshot: item.item_code_snapshot,
      item_name_snapshot: item.item_name_snapshot,
      qty: item.qty,
      cost_inc_gst_snapshot: item.cost_inc_gst_snapshot,
      markup_pct: item.markup_pct,
      applied_bundle_id: id,
    })
    if (!error) await onChanged()
  }
```

Replace the row's staff-only actions cell:

```jsx
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
```

With:

```jsx
                {isStaff && (
                  <td>
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDuplicateItem(item)}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => handleRemoveItem(item.id)}>
                      Remove
                    </button>
                  </td>
                )}
```

- [ ] **Step 3: Confirm lint and build are clean**

Run: `npm run lint && npm run build`

- [ ] **Step 4: Manually verify in the browser**

On a job with at least one applied bundle and at least one one-off item, as admin or office: click "Duplicate" on a line item that belongs to a bundle group and confirm the new row appears inside that same collapsible group (not in "Other Items"); click "Duplicate" on an item in "Other Items" and confirm the new row also lands in "Other Items". Confirm the job total updates correctly. Sign in as technician and confirm no "Duplicate" button appears and the technician's billing view (via `get_my_job_applied_bundles`/`get_my_job_line_items`) is otherwise unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useJobBilling.js src/components/BillingGroup.jsx
git commit -m "feat: add Duplicate line item to job billing"
```
