# Repeat-Client Address Auto-Populate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff pick a repeat client's site address from a dropdown of their known addresses instead of retyping it, and jump straight to job creation with a client pre-selected from their detail page.

**Architecture:** No schema/RLS changes. `JobForm` (already shared between job creation and editing) gains a derived, deduped address list per selected client, computed from `clients.address` (already loaded) plus that client's distinct `jobs.site_address` history (new query). `ClientDetail` gets a staff-only "New Job" link carrying `client_id` as a query param into `/jobs/new`, read by `JobNew`.

**Tech Stack:** React + Vite, Supabase. No automated JS test framework in this repo — verification is manual browser testing plus `npm run lint`/`npm run build` as a baseline check, same as the Feedback feature.

**Spec:** `docs/superpowers/specs/2026-09-02-repeat-client-address-design.md`

## Global Constraints

- No new tables, columns, or RLS policies — confirmed in the spec that `jobs.site_address` and `clients.address` are already fully covered by existing admin/office policies, and technicians have zero insert/select on `jobs` regardless of route.
- Address list = distinct non-empty `jobs.site_address` for the selected client, plus `clients.address` if set, deduped by exact string match, sorted alphabetically.
- Selection rule (apply in this order): (1) if `initialValues.site_address` matches an entry, pre-select it; (2) else if the list has exactly one entry, auto-select it; (3) else select "Add new address", pre-filling the free-text fallback from `initialValues.site_address` if present, blank otherwise. If the list is empty, skip the dropdown entirely and show a plain text input, as today.
- `ClientSiteInfoSection` on `JobDetail` is explicitly untouched.
- Accepted limitations (not to be "fixed" as part of this plan): exact-string-match dedup only; a plain `<select>` doesn't scale to clients with many distinct addresses.

---

### Task 1: Address-history picker in `JobForm`

**Files:**
- Modify: `src/components/JobForm.jsx`

**Interfaces:**
- Consumes: `useClients()` (already imported) for `clients[].address`; new inline Supabase query against `jobs` for `site_address` history.
- Produces: nothing consumed by Task 2 — these are independent slices of the same spec.

- [ ] **Step 1: Add the address-list state and derivation effect**

In `src/components/JobForm.jsx`, add two new pieces of state right after the existing `values`/`saving`/`error` state declarations:

```js
  const [knownAddresses, setKnownAddresses] = useState([])
  const [addressChoice, setAddressChoice] = useState('__new__')
```

Add a new effect, placed after the existing technicians-loading effect:

```js
  useEffect(() => {
    if (!values.client_id) {
      setKnownAddresses([])
      setAddressChoice('__new__')
      return
    }

    let cancelled = false
    supabase
      .from('jobs')
      .select('site_address')
      .eq('client_id', values.client_id)
      .not('site_address', 'is', null)
      .neq('site_address', '')
      .then(({ data }) => {
        if (cancelled) return
        const client = clients.find((c) => c.id === values.client_id)
        const combined = new Set((data ?? []).map((row) => row.site_address))
        if (client?.address) combined.add(client.address)
        const sorted = [...combined].sort()
        setKnownAddresses(sorted)

        if (initialValues?.site_address && sorted.includes(initialValues.site_address)) {
          setAddressChoice(initialValues.site_address)
          updateField('site_address', initialValues.site_address)
        } else if (sorted.length === 1) {
          setAddressChoice(sorted[0])
          updateField('site_address', sorted[0])
        } else {
          setAddressChoice('__new__')
          updateField('site_address', initialValues?.site_address ?? '')
        }
      })

    return () => {
      cancelled = true
    }
  }, [values.client_id, clients, initialValues])
```

- [ ] **Step 2: Replace the Site Address field's markup**

Replace this existing block:

```jsx
      <label>
        Site Address
        <input
          value={values.site_address}
          onChange={(e) => updateField('site_address', e.target.value)}
        />
      </label>
```

With:

```jsx
      <label>
        Site Address
        {knownAddresses.length === 0 ? (
          <input
            value={values.site_address}
            onChange={(e) => updateField('site_address', e.target.value)}
          />
        ) : (
          <select
            value={addressChoice}
            onChange={(e) => {
              const choice = e.target.value
              setAddressChoice(choice)
              updateField('site_address', choice === '__new__' ? '' : choice)
            }}
          >
            {knownAddresses.map((address) => (
              <option key={address} value={address}>{address}</option>
            ))}
            <option value="__new__">Add new address</option>
          </select>
        )}
      </label>
      {addressChoice === '__new__' && knownAddresses.length > 0 && (
        <label>
          New Address
          <input
            value={values.site_address}
            onChange={(e) => updateField('site_address', e.target.value)}
          />
        </label>
      )}
```

- [ ] **Step 3: Confirm lint and build are clean**

Run: `npm run lint && npm run build`
Expected: both complete with no errors (a "chunks larger than 500kB" warning from `build` is pre-existing and unrelated).

- [ ] **Step 4: Manually verify in the browser**

Start the dev server (`npm run dev`) and, signed in as admin or office, check each case from the spec's testing plan:
- A client with zero prior jobs and no `clients.address`: plain text input shown, no dropdown
- A client with exactly one distinct known address: the `<select>` still renders (since `knownAddresses.length` is 1, not 0), pre-selected to that one entry automatically — confirm `values.site_address` is already set to it without clicking anything
- A client with two or more distinct addresses: `<select>` defaults to "Add new address" with the fallback text input blank; picking an existing option hides the fallback input and sets the value directly
- Edit an existing job whose `site_address` matches one of its client's known addresses: that option is pre-selected on opening the edit form
- Edit an existing job whose `site_address` matches none of its client's known addresses: "Add new address" is pre-selected with the fallback input showing the existing value, not blank
- Switching the Client dropdown to a different client while the form is open re-runs the derivation for the new client (list and selection update accordingly)

- [ ] **Step 5: Commit**

```bash
git add src/components/JobForm.jsx
git commit -m "feat: add address-history picker to JobForm"
```

---

### Task 2: "New Job" shortcut from Client Detail

**Files:**
- Modify: `src/pages/JobNew.jsx`
- Modify: `src/pages/ClientDetail.jsx`

**Interfaces:**
- Consumes: `JobForm`'s existing `initialValues?.client_id` handling (already present, unchanged by Task 1).
- Produces: nothing consumed elsewhere — final task for this feature.

- [ ] **Step 1: Read `client_id` from the query string in `JobNew.jsx`**

Replace:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import JobForm from '../components/JobForm'

export default function JobNew() {
  const navigate = useNavigate()
```

With:

```jsx
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import JobForm from '../components/JobForm'

export default function JobNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const clientId = searchParams.get('client_id')
```

And replace the `initialValues={null}` prop:

```jsx
      <JobForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Job" />
```

With:

```jsx
      <JobForm
        initialValues={clientId ? { client_id: clientId } : null}
        onSubmit={handleCreate}
        submitLabel="Create Job"
      />
```

- [ ] **Step 2: Add the "New Job" link to `ClientDetail.jsx`**

Add `Link` to the existing react-router-dom import:

```js
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
```

Add the link next to the existing "Edit Client" button, inside the same non-editing branch:

```jsx
          {isStaff && (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Client
            </button>
          )}
          {isStaff && (
            <Link className="btn-primary" to={`/jobs/new?client_id=${id}`}>
              New Job
            </Link>
          )}
```

- [ ] **Step 3: Confirm lint and build are clean**

Run: `npm run lint && npm run build`
Expected: both complete with no errors.

- [ ] **Step 4: Manually verify in the browser**

Signed in as admin or office, open an existing client's detail page and confirm the "New Job" button is present and navigates to `/jobs/new?client_id=<that client's id>` with the Client dropdown pre-selected to them (and still freely changeable to a different client). Sign in as technician and confirm the button does not appear on `ClientDetail`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/JobNew.jsx src/pages/ClientDetail.jsx
git commit -m "feat: add New Job shortcut from Client Detail"
```
