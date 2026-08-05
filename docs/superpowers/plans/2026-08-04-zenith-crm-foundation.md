# Zenith CRM Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the local foundation (React app + Supabase schema/RLS/storage files) for a roofing job-management app, ready for the user to create a real Supabase project and deploy the SQL.

**Architecture:** A Vite + React frontend talks to Supabase (Postgres + Auth + Storage) via `@supabase/supabase-js`. All access control is enforced in the database with Row Level Security (RLS) policies keyed off a `role` column on a `public.users` profile table, not in frontend code — so a technician can't see hidden data just by inspecting network requests. SQL is organized as ordered, hand-run files (not the Supabase CLI migration system) because the user is doing manual dashboard setup, not `supabase db push`.

**Tech Stack:** React 18 (Vite), `@supabase/supabase-js`, Supabase Postgres/Auth/Storage. No Docker available locally, so local Supabase (`supabase start`) can't be used — SQL is verified by careful review here and functionally verified later against the real cloud project (Task 9).

## Global Constraints

- Do not deploy anything publicly or use real client data (per user instruction) — this plan is local file creation only, until the user explicitly runs SQL in their own Supabase project.
- Every access-control decision must trace back to one of these confirmed rules:
  - `admin`: full read/write/delete on everything.
  - `office`: read/write (no delete) on `clients`, `jobs`, `job_costs`, `job_diary`, `communications`. Cannot manage staff accounts.
  - `technician`: read-only on jobs assigned to them (never `quoted_price`), read-only on the client tied to those jobs, insert-only (no edit/delete) on diary entries + photos for their assigned jobs, **no access at all** to `job_costs` (confirmed: costs are admin/office only, technicians don't submit or view costs).
  - Staff accounts are created by `admin` only — no public self-signup.
- `communications` table is a deliberately minimal placeholder (`id`, `job_id`, timestamps) — real columns get designed in week 2 against the actual Outlook integration.
- **Flagged security decision (needs your sign-off before Task 5):** Postgres RLS is row-level, not column-level — it can hide whole rows but not "this column within a visible row." Since `quoted_price` must be hidden from technicians on rows they otherwise can see, the plan gives technicians **no direct SELECT policy on the `jobs` table at all**, and instead exposes a `get_my_jobs()` database function that returns their assigned jobs with `quoted_price` left out of the result columns entirely. This is the only approach that's enforced by the database itself (a technician calling the raw API directly, bypassing the frontend, still can't get the price) rather than relying on the frontend simply not displaying it.

---

## File Structure

```
zenith-crm/
  src/
    lib/
      supabaseClient.js       # Supabase client, reads env vars
    pages/
      Login.jsx                # Email/password login form
    App.jsx                    # Session check -> Login or placeholder dashboard
    main.jsx                   # Vite entry point (from scaffold)
  supabase/
    schema/
      001_users.sql
      002_clients.sql
      003_jobs.sql
      004_job_costs.sql
      005_job_diary.sql
      006_communications.sql
    policies/
      001_helper_function.sql
      002_users_policies.sql
      003_clients_policies.sql
      004_jobs_policies.sql
      005_job_costs_policies.sql
      006_job_diary_policies.sql
      007_communications_policies.sql
    storage/
      001_buckets_and_policies.sql
  .env.example
```

---

### Task 1: Scaffold the React app

**Files:**
- Create: `zenith-crm/` (via Vite scaffold — creates `package.json`, `src/main.jsx`, `src/App.jsx`, etc.)

**Interfaces:**
- Produces: a runnable Vite dev server on `npm run dev`, a git repo at `zenith-crm/` for subsequent commits.

- [ ] **Step 1: Scaffold with Vite**

Run from `D:\Claude Project`:
```bash
npm create vite@latest zenith-crm -- --template react
```

- [ ] **Step 2: Install dependencies**

```bash
cd "D:\Claude Project\zenith-crm"
npm install
```

- [ ] **Step 3: Verify it runs**

```bash
npm run dev
```
Expected: terminal prints a local URL (e.g. `http://localhost:5173`); loading it in a browser shows the default Vite+React starter page. Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 4: Initialize git and commit**

```bash
git init
git add .
git commit -m "chore: scaffold zenith-crm with Vite + React"
```

---

### Task 2: Supabase client + env scaffolding

**Files:**
- Create: `zenith-crm/src/lib/supabaseClient.js`
- Create: `zenith-crm/.env.example`
- Modify: `zenith-crm/.gitignore` (ensure `.env` is ignored — Vite's default already ignores `.env*`, verify it)

**Interfaces:**
- Produces: `supabase` client instance, imported as `import { supabase } from '../lib/supabaseClient'`.

- [ ] **Step 1: Install the Supabase JS library**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Create the client file**

`zenith-crm/src/lib/supabaseClient.js`:
```js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

- [ ] **Step 3: Create the env example file**

`zenith-crm/.env.example`:
```
VITE_SUPABASE_URL=your-project-url-here
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

- [ ] **Step 4: Confirm `.env` is gitignored**

Check `zenith-crm/.gitignore` contains a `.env*` or `.env` entry (Vite's default template already includes `.env*.local` — add a plain `.env` line if it's missing) so real API keys never get committed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.js .env.example .gitignore package.json package-lock.json
git commit -m "feat: add Supabase client scaffolding"
```

---

### Task 3: Core database schema (6 tables)

**Files:**
- Create: `zenith-crm/supabase/schema/001_users.sql`
- Create: `zenith-crm/supabase/schema/002_clients.sql`
- Create: `zenith-crm/supabase/schema/003_jobs.sql`
- Create: `zenith-crm/supabase/schema/004_job_costs.sql`
- Create: `zenith-crm/supabase/schema/005_job_diary.sql`
- Create: `zenith-crm/supabase/schema/006_communications.sql`

**Interfaces:**
- Produces: table names/columns that Task 4-7 policies and the RPC function reference directly — keep column names exactly as below.

- [ ] **Step 1: `001_users.sql`** — staff profile table, one row per Supabase Auth user

```sql
-- Staff profile table, linked 1:1 to Supabase Auth users.
-- Custom fields (role, name, phone) can't live on auth.users directly,
-- so we mirror the account here. The `role` column is what every RLS
-- policy in this app checks.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('admin', 'office', 'technician')),
  phone text,
  created_at timestamptz not null default now()
);

comment on table public.users is 'Staff accounts (admin/office/technician). One row per auth.users row.';
```

- [ ] **Step 2: `002_clients.sql`**

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is 'Customers the roofing company works for.';
```

- [ ] **Step 3: `003_jobs.sql`**

```sql
create type public.job_status as enum ('Quote', 'Scheduled', 'In Progress', 'Completed', 'Invoiced');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  status public.job_status not null default 'Quote',
  assigned_to uuid references public.users(id),
  description text,
  quoted_price numeric(10, 2),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobs is 'A roofing job for a client, tracked from quote through invoicing.';
```

- [ ] **Step 4: `004_job_costs.sql`**

```sql
create table public.job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  vendor text,
  amount numeric(10, 2) not null,
  cost_date date not null default current_date,
  description text,
  receipt_image_path text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.job_costs is 'Material/receipt costs logged against a job. Admin/office only — technicians have no access.';
```

- [ ] **Step 5: `005_job_diary.sql`**

```sql
create table public.job_diary (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  entry_text text not null,
  photo_paths text[] not null default '{}',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.job_diary is 'Timestamped notes/photos logged against a job by whoever is on site.';
```

- [ ] **Step 6: `006_communications.sql`**

```sql
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.communications is 'Placeholder for week-2 Outlook integration. Real columns designed then.';
```

- [ ] **Step 7: Review checklist (no local Postgres available, so verify by eye)**

Confirm for each file: table name matches the File Structure list, every foreign key points at a column that exists in an earlier-numbered file (load order matters — 001 before 002 before 003, etc.), and every column name here matches what Tasks 4-7 reference below. Real syntax verification happens in Task 9 when these files run against the actual Supabase project.

- [ ] **Step 8: Commit**

```bash
git add supabase/schema
git commit -m "feat: add core database schema (users, clients, jobs, job_costs, job_diary, communications)"
```

---

### Task 4: Enable RLS + policies for `users` and `clients`

**Files:**
- Create: `zenith-crm/supabase/policies/001_helper_function.sql`
- Create: `zenith-crm/supabase/policies/002_users_policies.sql`
- Create: `zenith-crm/supabase/policies/003_clients_policies.sql`

**Interfaces:**
- Consumes: `public.users(id, role)`, `public.clients(id)`, `public.jobs(client_id, assigned_to)` from Task 3.
- Produces: `public.current_app_role()` — used by every policy file in Tasks 4-8. Returns the calling user's role as text, or `null` if they have no `public.users` row.

- [ ] **Step 1: `001_helper_function.sql`**

```sql
-- Looks up the calling user's role. SECURITY DEFINER so it can read
-- public.users even though users' own RLS policy (below) wouldn't
-- otherwise let every table's policies query it directly.
-- Named current_app_role (not current_role) to avoid clashing with
-- Postgres's own built-in CURRENT_ROLE.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;
```

- [ ] **Step 2: `002_users_policies.sql`**

```sql
alter table public.users enable row level security;

-- Admin: full access
create policy "users_admin_all" on public.users
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- Everyone can read their own row (the app needs this to know its own role/name after login)
create policy "users_select_own" on public.users
  for select
  using (id = auth.uid());

-- Office can view the staff list (needed to assign jobs to a technician)
create policy "users_office_select_all" on public.users
  for select
  using (public.current_app_role() = 'office');

-- No insert/update/delete policy for office or technician: accounts
-- are created by admin only (via the Supabase dashboard for now).
```

- [ ] **Step 3: `003_clients_policies.sql`**

```sql
alter table public.clients enable row level security;

create policy "clients_admin_all" on public.clients
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "clients_office_select" on public.clients
  for select
  using (public.current_app_role() = 'office');

create policy "clients_office_insert" on public.clients
  for insert
  with check (public.current_app_role() = 'office');

create policy "clients_office_update" on public.clients
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Technicians can see only clients tied to a job assigned to them
create policy "clients_technician_select" on public.clients
  for select
  using (
    public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.client_id = clients.id
        and jobs.assigned_to = auth.uid()
    )
  );

-- No office delete policy (office cannot delete data, per spec).
-- No technician insert/update/delete (read-only for technicians).
```

- [ ] **Step 4: Review checklist**

Confirm every policy references `public.current_app_role()` (not a typo'd name), and that `clients_technician_select`'s subquery column names (`jobs.client_id`, `jobs.assigned_to`) match Task 3's `003_jobs.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/policies/001_helper_function.sql supabase/policies/002_users_policies.sql supabase/policies/003_clients_policies.sql
git commit -m "feat: add RLS policies for users and clients"
```

---

### Task 5: RLS for `jobs` + the technician-safe `get_my_jobs()` function

**Files:**
- Create: `zenith-crm/supabase/policies/004_jobs_policies.sql`

**Interfaces:**
- Consumes: `public.jobs` columns from Task 3, `public.current_app_role()` from Task 4.
- Produces: `public.get_my_jobs()` — callable from the frontend as `supabase.rpc('get_my_jobs')`. Returns rows shaped `{ id, client_id, status, description, created_at, updated_at }` — deliberately no `quoted_price`.

**This is the flagged security-relevant task — read the Global Constraints note above before running it if anything there is unclear.**

- [ ] **Step 1: `004_jobs_policies.sql`**

```sql
alter table public.jobs enable row level security;

create policy "jobs_admin_all" on public.jobs
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "jobs_office_select" on public.jobs
  for select
  using (public.current_app_role() = 'office');

create policy "jobs_office_insert" on public.jobs
  for insert
  with check (public.current_app_role() = 'office');

create policy "jobs_office_update" on public.jobs
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Deliberately no SELECT policy for technicians on this table.
-- RLS can hide rows but not individual columns, and quoted_price
-- must stay hidden from technicians. Instead, technicians read their
-- jobs through get_my_jobs() below, which is SECURITY DEFINER (so it
-- can bypass the missing SELECT policy) and explicitly leaves
-- quoted_price out of its return columns.
create or replace function public.get_my_jobs()
returns table (
  id uuid,
  client_id uuid,
  status public.job_status,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, client_id, status, description, created_at, updated_at
  from public.jobs
  where assigned_to = auth.uid();
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs without quoted_price.';
```

- [ ] **Step 2: Review checklist**

Confirm `get_my_jobs()`'s return columns exactly match a subset of `003_jobs.sql`'s columns (same names, same order isn't required but names must match), and that `quoted_price` does not appear anywhere in the function.

- [ ] **Step 3: Commit**

```bash
git add supabase/policies/004_jobs_policies.sql
git commit -m "feat: add jobs RLS + technician-safe get_my_jobs() function"
```

---

### Task 6: RLS for `job_costs` and `job_diary`

**Files:**
- Create: `zenith-crm/supabase/policies/005_job_costs_policies.sql`
- Create: `zenith-crm/supabase/policies/006_job_diary_policies.sql`

**Interfaces:**
- Consumes: `public.job_costs`, `public.job_diary`, `public.jobs(assigned_to)` from Task 3, `public.current_app_role()` from Task 4.

- [ ] **Step 1: `005_job_costs_policies.sql`**

```sql
alter table public.job_costs enable row level security;

create policy "job_costs_admin_all" on public.job_costs
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_costs_office_select" on public.job_costs
  for select
  using (public.current_app_role() = 'office');

create policy "job_costs_office_insert" on public.job_costs
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_costs_office_update" on public.job_costs
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, confirming the "fully hidden" decision.
```

- [ ] **Step 2: `006_job_diary_policies.sql`**

```sql
alter table public.job_diary enable row level security;

create policy "job_diary_admin_all" on public.job_diary
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_diary_office_select" on public.job_diary
  for select
  using (public.current_app_role() = 'office');

create policy "job_diary_office_insert" on public.job_diary
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_diary_office_update" on public.job_diary
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Technicians can see diary entries on jobs assigned to them...
create policy "job_diary_technician_select" on public.job_diary
  for select
  using (
    public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.id = job_diary.job_id
        and jobs.assigned_to = auth.uid()
    )
  );

-- ...and can add new entries to those jobs, but the entry must be
-- attributed to themselves. No update/delete policy for technicians:
-- once submitted, an entry is a permanent part of the job's audit
-- trail (matches the "insert-only" pattern used for costs).
create policy "job_diary_technician_insert" on public.job_diary
  for insert
  with check (
    public.current_app_role() = 'technician'
    and created_by = auth.uid()
    and exists (
      select 1 from public.jobs
      where jobs.id = job_diary.job_id
        and jobs.assigned_to = auth.uid()
    )
  );
```

**Assumption flagged for your review:** technicians can't edit or delete a diary entry once submitted (same append-only reasoning as costs). If you'd rather they be able to fix their own typos, tell me and I'll add an update policy scoped to `created_by = auth.uid()`.

- [ ] **Step 3: Review checklist**

Confirm both files' `exists (...)` subqueries reference `jobs.id = job_diary.job_id` / `jobs.assigned_to`, matching Task 3 column names.

- [ ] **Step 4: Commit**

```bash
git add supabase/policies/005_job_costs_policies.sql supabase/policies/006_job_diary_policies.sql
git commit -m "feat: add RLS for job_costs (admin/office only) and job_diary (technician insert-only)"
```

---

### Task 7: RLS for `communications` + storage buckets

**Files:**
- Create: `zenith-crm/supabase/policies/007_communications_policies.sql`
- Create: `zenith-crm/supabase/storage/001_buckets_and_policies.sql`

**Interfaces:**
- Consumes: `public.communications` from Task 3, `public.jobs(assigned_to)`, `public.current_app_role()`.
- Produces: two private storage buckets (`receipts`, `diary-photos`) that `receipt_image_path` and `photo_paths` values are expected to point into. Path convention: `<job_id>/<filename>`.

- [ ] **Step 1: `007_communications_policies.sql`**

```sql
alter table public.communications enable row level security;

create policy "communications_admin_all" on public.communications
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "communications_office_select" on public.communications
  for select
  using (public.current_app_role() = 'office');

create policy "communications_office_insert" on public.communications
  for insert
  with check (public.current_app_role() = 'office');

create policy "communications_office_update" on public.communications
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No technician policy: nothing to show them yet, and this table's
-- real shape (and who should see it) gets decided in week 2.
```

- [ ] **Step 2: `001_buckets_and_policies.sql`**

```sql
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('diary-photos', 'diary-photos', false)
on conflict (id) do nothing;

-- Receipts: admin + office only, matching job_costs access.
create policy "receipts_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'receipts'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'receipts'
    and public.current_app_role() in ('admin', 'office')
  );

-- Diary photos: admin/office full access.
create policy "diary_photos_admin_office_all" on storage.objects
  for all
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  )
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() in ('admin', 'office')
  );

-- Diary photos: technicians can upload/view files for their own
-- assigned jobs. Files must be uploaded under a path starting with
-- "<job_id>/..." -- storage.foldername(name) splits the path and
-- [1] is the first folder segment, i.e. the job id.
create policy "diary_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.id::text = (storage.foldername(name))[1]
        and jobs.assigned_to = auth.uid()
    )
  );

create policy "diary_photos_technician_select" on storage.objects
  for select
  using (
    bucket_id = 'diary-photos'
    and public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.id::text = (storage.foldername(name))[1]
        and jobs.assigned_to = auth.uid()
    )
  );
```

- [ ] **Step 3: Review checklist**

Confirm the bucket names (`receipts`, `diary-photos`) match what the frontend will later use, and that the path convention (`<job_id>/<filename>`) is noted somewhere the frontend code will follow it (Task 8 doesn't upload files yet, so this is just documented for week 2).

- [ ] **Step 4: Commit**

```bash
git add supabase/policies/007_communications_policies.sql supabase/storage/001_buckets_and_policies.sql
git commit -m "feat: add communications RLS and storage buckets/policies for receipts and diary photos"
```

---

### Task 8: Auth UI (login + session-aware placeholder dashboard)

**Files:**
- Create: `zenith-crm/src/pages/Login.jsx`
- Modify: `zenith-crm/src/App.jsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.js` (Task 2).
- Produces: renders `<Login />` when signed out, a placeholder dashboard (name + role) when signed in.

- [ ] **Step 1: Create the login page**

`zenith-crm/src/pages/Login.jsx`:
```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Zenith CRM — Sign in</h1>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Wire session state into `App.jsx`**

`zenith-crm/src/App.jsx`:
```jsx
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'

export default function App() {
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

  if (loading) return <p>Loading...</p>
  if (!session) return <Login />

  return (
    <div>
      <h1>Zenith CRM</h1>
      {profile ? (
        <p>
          Signed in as {profile.full_name} ({profile.role})
        </p>
      ) : (
        <p>Signed in, but no staff profile found for this account yet.</p>
      )}
      <button onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}
```

- [ ] **Step 3: Verify it runs**

```bash
npm run dev
```
Expected: the login form renders (real sign-in won't work until Task 9's Supabase project exists — that's expected here, this step just confirms the app compiles and renders without errors).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Login.jsx src/App.jsx
git commit -m "feat: add login page and session-aware app shell"
```

---

### Task 9: Create the real Supabase project and verify RLS end-to-end

This task is a guided walkthrough done together (dashboard actions are yours; I'll tell you exactly what to click and what to paste). Nothing here is code the user writes solo.

- [x] **Step 1:** Create a free Supabase account and a new project in the dashboard (I'll walk you through this when we get here).
- [x] **Step 2:** Copy the Project URL and `anon` public API key into a real `zenith-crm/.env` file (never committed — Task 2 already gitignored it).
- [x] **Step 3:** Run each file in `supabase/schema/`, then `supabase/policies/`, then `supabase/storage/`, in numeric order, in the Supabase SQL Editor.
- [x] **Step 4:** Create one test account per role (admin/office/technician) via Supabase Auth, then insert a matching row into `public.users` for each with the right `role`.
- [x] **Step 5:** Manually verify the rules hold: sign in as technician and confirm `get_my_jobs()` returns jobs without `quoted_price`, confirm a direct `select * from jobs` as technician returns nothing, confirm `job_costs` is empty/inaccessible to technician, confirm office can't delete a client.

**Verified 2026-08-05** via SQL Editor role impersonation (`select set_config('request.jwt.claims', json_build_object('sub', '<user-id>')::text, true); set local role authenticated;` ahead of each test query). All rules above held for admin, office, and technician, plus the storage policies (technician can upload/select `diary-photos` objects only under their own assigned job's path; a path for an unassigned/nonexistent job correctly raises an RLS violation on insert).

**Gotcha found and fixed during verification:** the `technician_owns_job()` / `technician_has_job_for_client()` RLS fix (commit `c9abcde`, written during Task 6/7 debugging) had been committed to the repo but **never actually re-run against the live Supabase project** — the live database still had the original broken policies (`clients_technician_select`, `job_diary_technician_select`/`_insert`, both `diary_photos_technician_*` storage policies), which silently returned 0 rows for technicians on data they should have been able to see. Diagnosed by comparing live policy definitions (`select policyname, qual, with_check from pg_policies where tablename = '...'`) against the repo's already-fixed SQL, then re-applying the three helper functions and five affected policies live. Lesson: a git commit to `supabase/policies/*.sql` does not itself change the live database — any policy fix must be explicitly re-run in the SQL Editor, and `pg_policies` is the fast way to confirm what's actually live matches what's committed.

---

## Self-Review

**Spec coverage:** users/clients/jobs/job_costs/job_diary/communications tables (Task 3); RLS for admin full access, office no-delete, technician restricted (Tasks 4-7); auth with role assignment (Task 8 + 9); Supabase dashboard walkthrough (Task 9); flagged security tradeoff on column hiding (Global Constraints + Task 5) — all present.

**Placeholder scan:** no TBD/TODO markers; `communications` intentionally minimal per your explicit answer, not an oversight.

**Type/name consistency:** `current_app_role()` used identically across Tasks 4-7; `get_my_jobs()` return columns cross-checked against `003_jobs.sql` in Task 5; storage path convention (`<job_id>/<filename>`) stated once in Task 7 and not contradicted elsewhere.
