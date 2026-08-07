# Day 3-4 Core Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard, client list/detail, and job list/detail screens on top of the existing Day 1-2 foundation, styled with Zenith's brand, with every screen's data access enforced by the RLS policies already live and tested in the Supabase project.

**Architecture:** React Router adds real URLs and a shared `<AppShell>` layout (navy top nav, logo, sign-out) wrapping all authenticated routes. One hook per entity (`useClients`, `useJobs`, `useJob`, `useJobDiary`) centralizes data fetching; `useJobs`/`useJob` branch internally on the caller's role to decide *which* Supabase query to run (`get_my_jobs()` RPC for technicians, direct table select for admin/office) — this branch is a convenience for picking the right query, not a security boundary, since Postgres RLS is what actually blocks unauthorized rows either way.

**Tech Stack:** React 19 + Vite (existing), `react-router-dom` (new dependency, this plan), `@supabase/supabase-js` (existing). No new backend/schema changes — this plan only reads/writes through tables and functions already created and RLS-tested as of commit `3758b07`.

## Global Constraints

- Brand colors: navy `#06143B` (background/header), orange `#FAA21B` (accent/buttons), white `#FFFFFF` (text on navy). No dark-mode variant — the brand identity stays fixed regardless of system theme.
- Job status values (exactly, in this order): `Quote`, `Work Order`, `Scheduled`, `Completed`.
- Job type values (exactly): `Tile Roofing`, `Metal Roofing`, `Roof Replacement`.
- `invoiced` is a schema-only field in this plan — no UI control for it anywhere (deferred to a future invoicing feature).
- Technicians never see `quoted_price` or `invoiced` in any screen. They do see `job_type`.
- No new RLS policies, no changes to `supabase/policies/*.sql` or `supabase/storage/*.sql` in this plan — every query below maps to an existing, already-tested policy or function.
- Diary photo uploads must use the path convention `<job_id>/<filename>` in the `diary-photos` bucket — required by the existing `diary_photos_technician_insert`/`_select` policies.
- This project has no automated JS test framework (no vitest/jest configured) and Day 1-2 established manual verification as the pattern (run `npm run dev`, sign in as each of the three test accounts, confirm behavior). This plan follows the same pattern — each task's "test" step is a manual role-by-role check, not an automated test suite.
- Test accounts already exist live: one admin, one office, one technician (see project memory for how to find their credentials — this plan doesn't recreate them).

---

### Task 1: Brand styling + routing dependency

**Files:**
- Modify: `src/index.css`
- Delete: `src/App.css` (unused — not imported anywhere in `src/`, leftover from the Vite scaffold)
- Modify: `package.json`, `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: CSS custom properties (`--navy`, `--orange`, `--white`, `--border`) and utility classes (`.app-shell`, `.app-nav`, `.app-nav-logo`, `.app-nav-links`, `.app-nav-user`, `.app-main`, `.btn-primary`, `.stat-cards`, `.stat-card`) that every later task's components rely on for styling. `react-router-dom` becomes available for import.

- [ ] **Step 1: Install react-router-dom**

```bash
npm install react-router-dom
```

- [ ] **Step 2: Delete the unused scaffold stylesheet**

Delete `src/App.css`. Confirm nothing imports it: `grep -r "App.css" src/` should return no results (already confirmed empty before writing this plan).

- [ ] **Step 3: Replace `src/index.css` with the brand theme**

Replace the entire file contents with:

```css
:root {
  --navy: #06143b;
  --orange: #faa21b;
  --white: #ffffff;
  --text: #1a1a1a;
  --border: #d8dce6;
  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;

  font: 16px/145% var(--sans);
  color: var(--text);
  background: var(--white);
}

body {
  margin: 0;
}

#root {
  min-height: 100vh;
}

button {
  font: inherit;
}

table {
  border-collapse: collapse;
  width: 100%;
}

th,
td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--navy);
}

form label {
  display: block;
  margin-bottom: 12px;
  font-weight: 600;
}

form input,
form select,
form textarea {
  display: block;
  width: 100%;
  max-width: 400px;
  padding: 6px 8px;
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-weight: normal;
}

.btn-primary {
  display: inline-block;
  background: var(--orange);
  color: var(--navy);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}

.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 24px;
  background: var(--navy);
  color: var(--white);
}

.app-nav-logo {
  height: 40px;
}

.app-nav-links {
  display: flex;
  gap: 16px;
  flex: 1;
}

.app-nav-links a {
  color: var(--white);
  text-decoration: none;
  font-weight: 600;
}

.app-nav-links a:hover {
  color: var(--orange);
}

.app-nav-user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-nav-user button {
  background: var(--orange);
  color: var(--navy);
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}

.app-main {
  flex: 1;
  padding: 24px;
}

.stat-cards {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.stat-card {
  background: var(--navy);
  color: var(--white);
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 140px;
}

.stat-card .count {
  font-size: 32px;
  font-weight: 700;
  color: var(--orange);
}
```

- [ ] **Step 4: Track the logo asset**

`src/assets/zenith-logo.png` already exists on disk (from an earlier session) but is untracked. It will be added to git in this task's commit.

- [ ] **Step 5: Verify**

Run:
```bash
npm run dev
```
Expected: dev server starts with no errors. Open the printed local URL — the page will still show the old placeholder content (this task only changes styles, not markup), but the background should now be white with the new font, and there should be no console errors about missing `App.css`. Stop the server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/index.css package.json package-lock.json src/assets/zenith-logo.png
git rm src/App.css
git commit -m "feat: apply Zenith brand styling and add react-router dependency"
```

---

### Task 2: Routing shell, session hook, and auth guard

**Files:**
- Create: `src/hooks/useSession.js`
- Create: `src/components/AppShell.jsx`
- Modify: `src/main.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.js`; `Login` from `src/pages/Login.jsx` (unchanged).
- Produces: `useSession()` returning `{ session, profile, loading }` where `profile` is `{ full_name, role } | null`. `<AppShell />` — the root layout route element; renders `<Login />` when there's no session, otherwise a nav bar plus `<Outlet context={{ profile }} />`. Every later page reads the signed-in user's role via `useOutletContext()` returning `{ profile }`.

- [ ] **Step 1: Extract session/profile logic into a hook**

Create `src/hooks/useSession.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useSession() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    supabase
      .from('users')
      .select('full_name, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  return { session, profile, loading }
}
```

This is the exact logic currently inline in `src/App.jsx`, moved so both `AppShell` and any future component can use it.

- [ ] **Step 2: Create the app shell**

Create `src/components/AppShell.jsx`:

```jsx
import { Link, Outlet } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { supabase } from '../lib/supabaseClient'
import Login from '../pages/Login'
import logo from '../assets/zenith-logo.png'

export default function AppShell() {
  const { session, profile, loading } = useSession()

  if (loading) return <p>Loading...</p>
  if (!session) return <Login />

  return (
    <div className="app-shell">
      <header className="app-nav">
        <img src={logo} alt="Zenith" className="app-nav-logo" />
        <nav className="app-nav-links">
          <Link to="/">Dashboard</Link>
          <Link to="/clients">Clients</Link>
          <Link to="/jobs">Jobs</Link>
        </nav>
        <div className="app-nav-user">
          {profile ? (
            <span>{profile.full_name} ({profile.role})</span>
          ) : (
            <span>Signed in</span>
          )}
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="app-main">
        <Outlet context={{ profile }} />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Wrap the app in a router**

Modify `src/main.jsx` to:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 4: Replace App.jsx with the route tree**

Replace the entire contents of `src/App.jsx` with:

```jsx
import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p>Dashboard coming soon</p>} />
        <Route path="*" element={<p>Page not found (yet)</p>} />
      </Route>
    </Routes>
  )
}
```

(The `/` placeholder is replaced with the real `Dashboard` component in Task 3; `/clients` and `/jobs` routes are added in Tasks 4 and 5. The `path="*"` catch-all is required here, not optional: `AppShell` is a pathless layout route, and React Router only renders a layout route when at least one of its children also matches — with only `/` wired up, navigating anywhere else matches nothing in the whole tree, so `<Routes>` renders nothing at all, including the layout. The catch-all guarantees some child always matches, keeping the nav mounted, and it doubles as a real 404 handler once every screen exists.)

- [ ] **Step 5: Verify**

Run `npm run dev` and open the app in a browser:
- Signed out: the login form renders (as before).
- Sign in as any test account: the navy nav bar appears with the Zenith logo, "Dashboard / Clients / Jobs" links, your name + role, and a sign-out button. The main area shows "Dashboard coming soon".
- Click "Clients" or "Jobs": the nav stays, main area shows "Page not found (yet)" — expected, those routes don't exist yet until Tasks 4/5.
- Click "Sign out": you're returned to the login form.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSession.js src/components/AppShell.jsx src/main.jsx src/App.jsx
git commit -m "feat: add routing shell with AppShell nav and session hook"
```

---

### Task 3: Dashboard screen

**Files:**
- Create: `src/lib/jobConstants.js`
- Create: `src/hooks/useJobs.js`
- Create: `src/pages/Dashboard.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `useOutletContext()` → `{ profile }` (Task 2).
- Produces: `JOB_STATUSES` (array of 4 strings), `JOB_TYPES` (array of 3 strings) from `jobConstants.js` — used by every later job-related screen. `useJobs(role)` returning `{ jobs, loading, error }`, where each `jobs[i]` has: `id, status, job_type, description, client_id, clientName, assignedName, quotedPrice, created_at, updated_at, assigned_to`. For technicians, `assignedName` and `quotedPrice` are always `null`.

- [ ] **Step 1: Create the shared job constants**

Create `src/lib/jobConstants.js`:

```js
export const JOB_STATUSES = ['Quote', 'Work Order', 'Scheduled', 'Completed']
export const JOB_TYPES = ['Tile Roofing', 'Metal Roofing', 'Roof Replacement']
```

- [ ] **Step 2: Create the useJobs hook**

Create `src/hooks/useJobs.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobs(role) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!role) return

    let cancelled = false
    setLoading(true)

    async function load() {
      if (role === 'technician') {
        const [{ data: jobRows, error: jobsError }, { data: clientRows, error: clientsError }] =
          await Promise.all([
            supabase.rpc('get_my_jobs'),
            supabase.from('clients').select('id, name'),
          ])

        if (cancelled) return
        if (jobsError || clientsError) {
          setError(jobsError ?? clientsError)
          setLoading(false)
          return
        }

        const clientNames = Object.fromEntries(clientRows.map((c) => [c.id, c.name]))
        setJobs(
          jobRows.map((job) => ({
            ...job,
            clientName: clientNames[job.client_id] ?? 'Unknown client',
            assignedName: null,
            quotedPrice: null,
          }))
        )
        setLoading(false)
        return
      }

      const { data, error: jobsError } = await supabase
        .from('jobs')
        .select(
          'id, status, job_type, description, quoted_price, client_id, assigned_to, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name)'
        )
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (jobsError) {
        setError(jobsError)
        setLoading(false)
        return
      }

      setJobs(
        data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
          assignedName: job.assigned?.full_name ?? 'Unassigned',
          quotedPrice: job.quoted_price,
        }))
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [role])

  return { jobs, loading, error }
}
```

**Troubleshooting note:** the `assigned:users!jobs_assigned_to_fkey(full_name)` embed relies on Postgres's default foreign-key naming (`<table>_<column>_fkey`). If this errors with something like "could not find relationship," confirm the actual constraint name by running `select conname from pg_constraint where conrelid = 'public.jobs'::regclass;` in the SQL Editor and adjust the embed name to match.

- [ ] **Step 3: Create the Dashboard page**

Create `src/pages/Dashboard.jsx`:

```jsx
import { useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { JOB_STATUSES } from '../lib/jobConstants'

export default function Dashboard() {
  const { profile } = useOutletContext()
  const { jobs, loading, error } = useJobs(profile?.role)

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load jobs: {error.message}</p>

  const counts = Object.fromEntries(
    JOB_STATUSES.map((status) => [status, jobs.filter((job) => job.status === status).length])
  )

  return (
    <div>
      <h1>{profile?.role === 'technician' ? 'My Jobs' : 'Dashboard'}</h1>
      <div className="stat-cards">
        {JOB_STATUSES.map((status) => (
          <div className="stat-card" key={status}>
            <div className="count">{counts[status]}</div>
            <div>{status}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the route**

In `src/App.jsx`, replace the placeholder root route with the real Dashboard:

```jsx
import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 5: Verify**

Run `npm run dev`. Sign in as admin, office, and technician in turn (use separate private/incognito windows or sign out between each). For each: confirm 4 stat cards render (Quote, Work Order, Scheduled, Completed) with no console errors. All counts will show 0 right now — the `jobs` table was wiped by the status-model migration and Task 6 is what adds job creation. That's expected; this step only confirms the cards render correctly per role, not that the counts are non-zero. Full count verification happens after Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobConstants.js src/hooks/useJobs.js src/pages/Dashboard.jsx src/App.jsx
git commit -m "feat: add role-aware dashboard with job status counts"
```

---

### Task 4: Client list screen

**Files:**
- Create: `src/hooks/useClients.js`
- Create: `src/pages/ClientList.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Produces: `useClients()` returning `{ clients, loading, error }`, where each `clients[i]` is `{ id, name, phone, email, address, notes, created_at }`.

- [ ] **Step 1: Create the useClients hook**

Create `src/hooks/useClients.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('clients')
      .select('id, name, phone, email, address, notes, created_at')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setClients(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { clients, loading, error }
}
```

- [ ] **Step 2: Create the ClientList page**

Create `src/pages/ClientList.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { useClients } from '../hooks/useClients'

export default function ClientList() {
  const { clients, loading, error } = useClients()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load clients: {error.message}</p>

  return (
    <div>
      <h1>Clients</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td><Link to={`/clients/${client.id}`}>{client.name}</Link></td>
              <td>{client.phone}</td>
              <td>{client.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

(The "Add client" button is added in Task 7, alongside the create form it links to.)

- [ ] **Step 3: Wire the route**

In `src/App.jsx`, add the import and route:

```jsx
import ClientList from './pages/ClientList'
```
```jsx
<Route path="/clients" element={<ClientList />} />
```

- [ ] **Step 4: Verify**

Run `npm run dev`.
- Sign in as admin or office: the Clients page shows the one existing seeded client from Task 9 (name/phone/email).
- Sign in as the technician account: the Clients page is **empty**. This is expected and correct, not a bug — the technician's previously-assigned job was deleted by the status-model migration (Task 9's cascade), so `technician_has_job_for_client()` currently has no job to match against. This resolves itself in Task 6 once a new job is created and assigned to them.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useClients.js src/pages/ClientList.jsx src/App.jsx
git commit -m "feat: add client list screen"
```

---

### Task 5: Job list screen

**Files:**
- Create: `src/components/JobRow.jsx`
- Create: `src/pages/JobList.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `useJobs(role)` (Task 3), `JOB_STATUSES` (Task 3).
- Produces: `<JobRow job={job} role={role} />` — a `<tr>` reused by both `JobList` and `ClientDetail`'s (Task 7) job history table. Renders 3 columns (Client, Job Type, Status) for technicians, 5 columns (+ Assigned To, + Quoted Price) for admin/office.

- [ ] **Step 1: Create the reusable job row**

Create `src/components/JobRow.jsx`:

```jsx
import { Link } from 'react-router-dom'

export default function JobRow({ job, role }) {
  const isStaff = role !== 'technician'

  return (
    <tr>
      <td><Link to={`/jobs/${job.id}`}>{job.clientName}</Link></td>
      <td>{job.job_type}</td>
      <td>{job.status}</td>
      {isStaff && <td>{job.assignedName}</td>}
      {isStaff && <td>{job.quotedPrice != null ? `$${job.quotedPrice}` : '—'}</td>}
    </tr>
  )
}
```

- [ ] **Step 2: Create the JobList page**

Create `src/pages/JobList.jsx`:

```jsx
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { JOB_STATUSES } from '../lib/jobConstants'
import JobRow from '../components/JobRow'

export default function JobList() {
  const { profile } = useOutletContext()
  const { jobs, loading, error } = useJobs(profile?.role)
  const [statusFilter, setStatusFilter] = useState('')

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load jobs: {error.message}</p>

  const isStaff = profile?.role !== 'technician'
  const visibleJobs = statusFilter ? jobs.filter((job) => job.status === statusFilter) : jobs

  return (
    <div>
      <h1>Jobs</h1>
      <label>
        Filter by status
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Job Type</th>
            <th>Status</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Quoted Price</th>}
          </tr>
        </thead>
        <tbody>
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} role={profile?.role} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

(The "Add job" button is added in Task 6, alongside the create form it links to.)

- [ ] **Step 3: Wire the route**

In `src/App.jsx`, add the import and route:

```jsx
import JobList from './pages/JobList'
```
```jsx
<Route path="/jobs" element={<JobList />} />
```

- [ ] **Step 4: Verify**

Run `npm run dev`. Sign in as admin/office: Jobs page shows the 5-column table header (empty body, no jobs yet) and a working status filter dropdown. Sign in as technician: 3-column header, empty body. No console errors. Full row/filtering verification happens after Task 6 creates real job data.

- [ ] **Step 5: Commit**

```bash
git add src/components/JobRow.jsx src/pages/JobList.jsx src/App.jsx
git commit -m "feat: add job list screen with status filter"
```

---

### Task 6: Job create, detail, and diary

**Files:**
- Create: `src/components/JobForm.jsx`
- Create: `src/pages/JobNew.jsx`
- Create: `src/hooks/useJob.js`
- Create: `src/hooks/useJobDiary.js`
- Create: `src/components/DiarySection.jsx`
- Create: `src/pages/JobDetail.jsx`
- Modify: `src/pages/JobList.jsx` (add "Add Job" button)
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `useClients()` (Task 4), `JOB_STATUSES`/`JOB_TYPES` (Task 3), `<DiarySection jobId />` renders standalone.
- Produces: `useJob(jobId, role)` returning `{ job, loading, error, reload }`, where `job` has the same shape as one `useJobs()` row plus `invoiced` (admin/office only — `null` for technicians). `useJobDiary(jobId)` returning `{ entries, loading, error, addEntry }`, where `addEntry({ entryText, photoFiles })` uploads photos to the `diary-photos` bucket and inserts a `job_diary` row, returning `{ error }`.

- [ ] **Step 1: Create the shared job form**

Create `src/components/JobForm.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClients } from '../hooks/useClients'
import { JOB_STATUSES, JOB_TYPES } from '../lib/jobConstants'

export default function JobForm({ initialValues, onSubmit, submitLabel }) {
  const { clients } = useClients()
  const [technicians, setTechnicians] = useState([])
  const [values, setValues] = useState({
    client_id: initialValues?.client_id ?? '',
    job_type: initialValues?.job_type ?? '',
    status: initialValues?.status ?? 'Quote',
    assigned_to: initialValues?.assigned_to ?? '',
    description: initialValues?.description ?? '',
    quoted_price: initialValues?.quoted_price ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name')
      .eq('role', 'technician')
      .order('full_name')
      .then(({ data }) => setTechnicians(data ?? []))
  }, [])

  function updateField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await onSubmit({
      client_id: values.client_id,
      job_type: values.job_type,
      status: values.status,
      assigned_to: values.assigned_to || null,
      description: values.description,
      quoted_price: values.quoted_price === '' ? null : Number(values.quoted_price),
    })
    setSaving(false)
    if (error) setError(error.message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Client
        <select
          value={values.client_id}
          onChange={(e) => updateField('client_id', e.target.value)}
          required
        >
          <option value="">Select a client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </label>
      <label>
        Job Type
        <select
          value={values.job_type}
          onChange={(e) => updateField('job_type', e.target.value)}
          required
        >
          <option value="">Select a job type</option>
          {JOB_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={values.status} onChange={(e) => updateField('status', e.target.value)}>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        Assigned Technician
        <select
          value={values.assigned_to}
          onChange={(e) => updateField('assigned_to', e.target.value)}
        >
          <option value="">Unassigned</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>{tech.full_name}</option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </label>
      <label>
        Quoted Price
        <input
          type="number"
          step="0.01"
          value={values.quoted_price}
          onChange={(e) => updateField('quoted_price', e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Create the job creation page**

Create `src/pages/JobNew.jsx`:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import JobForm from '../components/JobForm'

export default function JobNew() {
  const navigate = useNavigate()

  async function handleCreate(values) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('jobs')
      .insert({ ...values, created_by: user.id })
      .select('id')
      .single()

    if (!error) navigate(`/jobs/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Job</h1>
      <JobForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Job" />
    </div>
  )
}
```

- [ ] **Step 3: Create the useJob hook**

Create `src/hooks/useJob.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJob(jobId, role) {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (role === 'technician') {
      const { data: jobRows, error: jobsError } = await supabase.rpc('get_my_jobs')
      const found = jobRows?.find((row) => row.id === jobId)

      if (jobsError || !found) {
        setError(jobsError ?? new Error('Job not found'))
        setJob(null)
        setLoading(false)
        return
      }

      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('id', found.client_id)
        .single()

      setJob({
        ...found,
        clientName: client?.name ?? 'Unknown client',
        assignedName: null,
        quotedPrice: null,
        invoiced: null,
      })
      setLoading(false)
      return
    }

    const { data, error: jobError } = await supabase
      .from('jobs')
      .select(
        'id, status, job_type, description, quoted_price, invoiced, client_id, assigned_to, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name)'
      )
      .eq('id', jobId)
      .single()

    if (jobError) {
      setError(jobError)
      setJob(null)
    } else {
      setJob({
        ...data,
        clientName: data.clients?.name ?? 'Unknown client',
        assignedName: data.assigned?.full_name ?? 'Unassigned',
        quotedPrice: data.quoted_price,
      })
    }
    setLoading(false)
  }, [jobId, role])

  useEffect(() => {
    if (!role) return
    reload()
  }, [reload, role])

  return { job, loading, error, reload }
}
```

- [ ] **Step 4: Create the useJobDiary hook**

Create `src/hooks/useJobDiary.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobDiary(jobId) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_diary')
      .select('id, entry_text, photo_paths, created_at, created_by')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (error) setError(error)
    else setEntries(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function addEntry({ entryText, photoFiles }) {
    const { data: { user } } = await supabase.auth.getUser()
    const photoPaths = []

    for (const file of photoFiles) {
      const path = `${jobId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('diary-photos')
        .upload(path, file)
      if (uploadError) return { error: uploadError }
      photoPaths.push(path)
    }

    const { error: insertError } = await supabase.from('job_diary').insert({
      job_id: jobId,
      entry_text: entryText,
      photo_paths: photoPaths,
      created_by: user.id,
    })

    if (insertError) return { error: insertError }
    await reload()
    return { error: null }
  }

  return { entries, loading, error, addEntry }
}
```

- [ ] **Step 5: Create the diary section component**

Create `src/components/DiarySection.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useJobDiary } from '../hooks/useJobDiary'

export default function DiarySection({ jobId }) {
  const { entries, loading, error, addEntry } = useJobDiary(jobId)
  const [entryText, setEntryText] = useState('')
  const [photoFiles, setPhotoFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [photoUrls, setPhotoUrls] = useState({})

  useEffect(() => {
    const allPaths = entries.flatMap((entry) => entry.photo_paths)
    const missingPaths = allPaths.filter((path) => !photoUrls[path])
    if (missingPaths.length === 0) return

    let cancelled = false
    Promise.all(
      missingPaths.map((path) =>
        supabase.storage
          .from('diary-photos')
          .createSignedUrl(path, 3600)
          .then(({ data }) => [path, data?.signedUrl])
      )
    ).then((pairs) => {
      if (cancelled) return
      setPhotoUrls((prev) => ({
        ...prev,
        ...Object.fromEntries(pairs.filter(([, url]) => url)),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [entries, photoUrls])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const { error } = await addEntry({ entryText, photoFiles })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setEntryText('')
    setPhotoFiles([])
  }

  return (
    <section>
      <h2>Diary</h2>
      {loading && <p>Loading diary...</p>}
      {error && <p role="alert">Could not load diary: {error.message}</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <p>{new Date(entry.created_at).toLocaleString()}</p>
            <p>{entry.entry_text}</p>
            {entry.photo_paths.map((path) =>
              photoUrls[path] ? (
                <img
                  key={path}
                  src={photoUrls[path]}
                  alt="Diary attachment"
                  style={{ maxWidth: 200, display: 'block' }}
                />
              ) : (
                <p key={path}>Loading photo...</p>
              )
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label>
          New entry
          <textarea value={entryText} onChange={(e) => setEntryText(e.target.value)} required />
        </label>
        <label>
          Photos
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotoFiles(Array.from(e.target.files))}
          />
        </label>
        {formError && <p role="alert">{formError}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Add Entry'}
        </button>
      </form>
    </section>
  )
}
```

- [ ] **Step 6: Create the job detail page**

Create `src/pages/JobDetail.jsx`:

```jsx
import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJob } from '../hooks/useJob'
import JobForm from '../components/JobForm'
import DiarySection from '../components/DiarySection'

export default function JobDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const { job, loading, error, reload } = useJob(id, profile?.role)
  const [editing, setEditing] = useState(false)

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load job: {error.message}</p>
  if (!job) return <p>Job not found.</p>

  const isStaff = profile?.role !== 'technician'

  async function handleUpdate(values) {
    const { error } = await supabase.from('jobs').update(values).eq('id', job.id)
    if (!error) {
      setEditing(false)
      await reload()
    }
    return { error }
  }

  return (
    <div>
      <h1>{job.clientName} — {job.job_type}</h1>
      {isStaff && editing ? (
        <JobForm initialValues={job} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Status: {job.status}</p>
          <p>Job Type: {job.job_type}</p>
          {isStaff && <p>Assigned To: {job.assignedName}</p>}
          {isStaff && (
            <p>Quoted Price: {job.quotedPrice != null ? `$${job.quotedPrice}` : '—'}</p>
          )}
          <p>Description: {job.description}</p>
          {isStaff && (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Job
            </button>
          )}
        </div>
      )}
      <DiarySection jobId={job.id} />
    </div>
  )
}
```

- [ ] **Step 7: Add the "Add Job" button to the job list**

In `src/pages/JobList.jsx`, add `Link` usage for the create button. Update the top of the file:

```jsx
import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { JOB_STATUSES } from '../lib/jobConstants'
import JobRow from '../components/JobRow'
```

And insert the button right after the `<h1>Jobs</h1>` line:

```jsx
<h1>Jobs</h1>
{isStaff && <Link className="btn-primary" to="/jobs/new">Add Job</Link>}
```

- [ ] **Step 8: Wire the routes**

In `src/App.jsx`, add the imports and routes:

```jsx
import JobNew from './pages/JobNew'
import JobDetail from './pages/JobDetail'
```
```jsx
<Route path="/jobs/new" element={<JobNew />} />
<Route path="/jobs/:id" element={<JobDetail />} />
```

- [ ] **Step 9: Verify**

Run `npm run dev`.
1. Sign in as admin. Go to Jobs → Add Job. Pick the existing client, job type "Tile Roofing", status "Quote", assign to the technician test account, add a description and price. Submit — you should land on the new job's detail page showing all fields correctly, with an "Edit Job" button.
2. Go to Dashboard — the "Quote" count should now be 1.
3. On the job detail page, click "Edit Job", change status to "Work Order", save — confirm it persists after reload.
4. Sign out, sign in as the technician. Go to Jobs — the job appears with 3 columns (no price/assigned columns). Open its detail page — confirm no price/edit button is shown. Add a diary entry with a text note and one photo — confirm it appears in the list with the photo rendering below the text.
5. Sign out, sign in as admin again. Open the same job — confirm the technician's diary entry (text + photo) is visible.

- [ ] **Step 10: Commit**

```bash
git add src/components/JobForm.jsx src/pages/JobNew.jsx src/hooks/useJob.js src/hooks/useJobDiary.js src/components/DiarySection.jsx src/pages/JobDetail.jsx src/pages/JobList.jsx src/App.jsx
git commit -m "feat: add job creation, detail, edit, and diary screens"
```

---

### Task 7: Client create and detail (with job history)

**Files:**
- Create: `src/components/ClientForm.jsx`
- Create: `src/pages/ClientNew.jsx`
- Create: `src/pages/ClientDetail.jsx`
- Modify: `src/pages/ClientList.jsx` (add "Add Client" button)
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `useJobs(role)` (Task 3), `<JobRow job role />` (Task 5).

- [ ] **Step 1: Create the shared client form**

Create `src/components/ClientForm.jsx`:

```jsx
import { useState } from 'react'

export default function ClientForm({ initialValues, onSubmit, submitLabel }) {
  const [values, setValues] = useState({
    name: initialValues?.name ?? '',
    phone: initialValues?.phone ?? '',
    email: initialValues?.email ?? '',
    address: initialValues?.address ?? '',
    notes: initialValues?.notes ?? '',
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
    const { error } = await onSubmit(values)
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
        Phone
        <input value={values.phone} onChange={(e) => updateField('phone', e.target.value)} />
      </label>
      <label>
        Email
        <input
          type="email"
          value={values.email}
          onChange={(e) => updateField('email', e.target.value)}
        />
      </label>
      <label>
        Address
        <input value={values.address} onChange={(e) => updateField('address', e.target.value)} />
      </label>
      <label>
        Notes
        <textarea value={values.notes} onChange={(e) => updateField('notes', e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Create the client creation page**

Create `src/pages/ClientNew.jsx`:

```jsx
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import ClientForm from '../components/ClientForm'

export default function ClientNew() {
  const navigate = useNavigate()

  async function handleCreate(values) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...values, created_by: user.id })
      .select('id')
      .single()

    if (!error) navigate(`/clients/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Client</h1>
      <ClientForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Client" />
    </div>
  )
}
```

- [ ] **Step 3: Create the client detail page**

Create `src/pages/ClientDetail.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJobs } from '../hooks/useJobs'
import ClientForm from '../components/ClientForm'
import JobRow from '../components/JobRow'

export default function ClientDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const { jobs } = useJobs(profile?.role)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('clients')
      .select('id, name, phone, email, address, notes')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setClient(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load client: {error.message}</p>
  if (!client) return <p>Client not found.</p>

  const isStaff = profile?.role !== 'technician'
  const clientJobs = jobs.filter((job) => job.client_id === id)

  async function handleUpdate(values) {
    const { error } = await supabase.from('clients').update(values).eq('id', id)
    if (!error) {
      setClient({ ...client, ...values })
      setEditing(false)
    }
    return { error }
  }

  return (
    <div>
      <h1>{client.name}</h1>
      {isStaff && editing ? (
        <ClientForm initialValues={client} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Phone: {client.phone}</p>
          <p>Email: {client.email}</p>
          <p>Address: {client.address}</p>
          <p>Notes: {client.notes}</p>
          {isStaff && (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Client
            </button>
          )}
        </div>
      )}
      <h2>Job History</h2>
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Job Type</th>
            <th>Status</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Quoted Price</th>}
          </tr>
        </thead>
        <tbody>
          {clientJobs.map((job) => (
            <JobRow key={job.id} job={job} role={profile?.role} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Add the "Add Client" button to the client list**

In `src/pages/ClientList.jsx`, update the top of the file and add the button:

```jsx
import { Link, useOutletContext } from 'react-router-dom'
import { useClients } from '../hooks/useClients'

export default function ClientList() {
  const { profile } = useOutletContext()
  const { clients, loading, error } = useClients()
  const isStaff = profile?.role !== 'technician'

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load clients: {error.message}</p>

  return (
    <div>
      <h1>Clients</h1>
      {isStaff && <Link className="btn-primary" to="/clients/new">Add Client</Link>}
      <table>
```

(Keep the rest of the file — the `<thead>`/`<tbody>` table body — unchanged.)

- [ ] **Step 5: Wire the routes**

In `src/App.jsx`, add the imports and routes:

```jsx
import ClientNew from './pages/ClientNew'
import ClientDetail from './pages/ClientDetail'
```
```jsx
<Route path="/clients/new" element={<ClientNew />} />
<Route path="/clients/:id" element={<ClientDetail />} />
```

- [ ] **Step 6: Verify**

Run `npm run dev`.
1. Sign in as admin. Go to Clients → Add Client, fill out the form, submit — you land on the new client's detail page. Click "Edit Client", change the phone number, save — confirm it persists.
2. On this client's detail page, confirm the "Job History" table is empty (no jobs for this client yet).
3. Go to the client created back in Task 9 (the one with the job from Task 6) — confirm its "Job History" table shows that job, with the 5-column admin view (including price).
4. Sign out, sign in as the technician. Go to Clients — confirm exactly one client is visible (the one tied to their assigned job from Task 6). Open its detail page — confirm it's read-only (no Edit button) and the Job History table shows their job with only 3 columns (no price).

- [ ] **Step 7: Commit**

```bash
git add src/components/ClientForm.jsx src/pages/ClientNew.jsx src/pages/ClientDetail.jsx src/pages/ClientList.jsx src/App.jsx
git commit -m "feat: add client creation, detail, edit screens with job history"
```

---

## Self-Review

**Spec coverage:** Dashboard (role-aware stat cards) — Task 3. Client list + detail with job history, create/edit for staff, read-only for technicians — Tasks 4, 7. Job list + detail with diary, create/edit for staff, technician diary-only access — Tasks 5, 6. Brand styling (navy/orange/white, logo) — Task 1. Routing + shared shell — Task 2. Corrected job status/type/invoiced model — already live, referenced as a prerequisite. All "explicitly out of scope" items from the spec (invoicing page, job_costs UI, search boxes, clickable dashboard cards, inline client creation, technician status changes) are correctly absent from every task above.

**Placeholder scan:** no TBD/TODO/"add appropriate handling" markers; every step has real, complete code.

**Type/name consistency:** `useJobs(role)` (Task 3) and `useJob(jobId, role)` (Task 6) return jobs shaped identically (`clientName`, `assignedName`, `quotedPrice`, `job_type`, `status`) so `JobRow` (Task 5) works unmodified in both `JobList` (Task 5) and `ClientDetail` (Task 7). `JOB_STATUSES`/`JOB_TYPES` (Task 3) are the single source of truth used by `Dashboard`, `JobList`'s filter, and `JobForm`'s dropdowns — no status/type string is hand-typed a second time anywhere else. `useOutletContext()` → `{ profile }` (Task 2) is the consistent way every page reads the current role.
