# Day 3-4: Core Screens Design

**Goal:** Build the first real working screens on top of the Day 1-2 foundation (schema, RLS, auth) — a role-aware dashboard, client list/detail, and job list/detail — styled with Zenith's brand.

**Context:** Day 1-2 (schema, RLS policies for all 6 tables, storage buckets, login page + session-aware shell) is complete and verified live against Supabase. This spec covers the next layer: actual CRM screens that read/write through the existing, tested RLS policies. No new RLS policies are introduced by this spec — every screen maps to a query already covered by existing security rules.

**Prerequisite (already done):** the original `job_status` enum (`Quote, Scheduled, In Progress, Completed, Invoiced`) didn't match the client's real workflow and has been corrected live and in the repo (commit `3758b07`) to:
- `job_status`: `Quote → Work Order → Scheduled → Completed`
- New `job_type` enum (`Tile Roofing`, `Metal Roofing`, `Roof Replacement`) — a required column on `jobs`, independent of status
- New `invoiced boolean not null default false` column on `jobs` — a placeholder for a future, separate invoicing feature (not built in this phase); the future feature will query `status = 'Completed' and invoiced = false`
- `get_my_jobs()` updated to include `job_type` and continues to exclude `quoted_price` and `invoiced` from what technicians can see

## Brand styling

- Background/header: navy `#06143B`
- Accent (buttons, active nav, status highlights): orange `#FAA21B`
- Text on navy: white `#FFFFFF`
- Logo: `src/assets/zenith-logo.png` (Zenith "Z" mark, navy background baked in — suitable for the top nav bar)
- These replace the default Vite purple theme currently in `src/index.css`.
- Layout priority: clarity over cleverness — plain tables, plain forms, no dense/clever UI patterns, since the primary users may not be especially tech-savvy.

## Architecture

**Routing:** `react-router` (new dependency), with routes:
- `/` — Dashboard
- `/clients`, `/clients/:id`
- `/jobs`, `/jobs/:id`

All routes render inside a shared `<AppShell>` (navy top nav: logo, current user's name + role, sign-out button) which replaces today's bare `<h1>Zenith CRM</h1>` placeholder in `App.jsx`. A route guard redirects to the login page whenever there's no active session, replacing the current manual `if (!session) return <Login />` check.

**Data access pattern:** one hook per entity —
- `useClients()` — `supabase.from('clients').select(...)`. Same query for every role; RLS determines which rows come back (admin/office get all, technicians get only clients tied to their assigned jobs).
- `useJobs()` — branches on the signed-in user's role: technicians call `supabase.rpc('get_my_jobs')`; admin/office call `supabase.from('jobs').select(...)` (which includes `quoted_price`).
- This role branch is purely about *which query to send* — it is not a security boundary. If a technician's client ever called the admin/office query path, RLS would simply return zero rows (there's no SELECT policy for technicians on `jobs` at all). The real enforcement is entirely in Postgres, as already built and tested.

## Screens

### Dashboard (`/`)
- Admin/office: 4 stat cards, one per status (Quote, Work Order, Scheduled, Completed), each showing a count of jobs in that status. Non-interactive (no click-through to filtered list in this pass).
- Technicians: same 4-card layout, counts computed client-side from their `get_my_jobs()` results, scoped to their own jobs only.

### Client list (`/clients`) + detail (`/clients/:id`)
- **List:** plain table — name, phone, email. Admin/office see every client; technicians see only clients tied to a job assigned to them (enforced by the existing `clients_technician_select` RLS policy, not by frontend filtering). Admin/office get an "Add client" button. No search/filter in this pass — a plain sortable table is enough for the current data volume.
- **Detail:** client info block. Admin/office can edit inline; technicians see it read-only. Below that, a "Job history" section listing that client's jobs, reusing the job list row component filtered by `client_id`.

### Job list (`/jobs`) + detail (`/jobs/:id`)
- **List:** table with client name, job type, status, assigned technician. Admin/office additionally see quoted price and get an "Add job" button. A status filter dropdown (4 values) sits above the table. Technicians see only their own jobs (via `get_my_jobs()`), no price column, no add button.
- **Create/edit form (admin/office only):** client (dropdown of existing clients — no inline client creation in this pass), job type (dropdown, required, 3 values), status (dropdown, 4 values), assigned technician (dropdown, editable anytime regardless of current status — supports reassignment if someone calls in sick), description, quoted price. No `invoiced` control — that field exists in the schema for a future phase but isn't surfaced in this UI.
- **Detail view:** job info block (edit form for admin/office as above; read-only, price-free block for technicians). Below that, a diary section: chronological list of entries (text + photos) and an "add entry" form (text box + file input) for whoever can see the job. Write access is enforced by existing `job_diary` RLS — technicians can only insert on jobs assigned to them; admin/office can insert on any job. Technicians cannot edit the job record itself (status, assignment, etc.) — only add diary entries; this matches the fact that there is no RLS update policy for technicians on `jobs` at all, so no new policy is needed to enforce this.

Photo uploads go to the existing `diary-photos` storage bucket, under the path `<job_id>/<filename>` — this exact convention is required by the already-tested storage RLS policies (`diary_photos_technician_insert`/`_select`, which extract the job id from the first path segment via `storage.foldername(name)[1]`). After upload, the resulting storage path is appended to that `job_diary` row's `photo_paths` array.

## Explicitly out of scope for this phase

- **Invoicing page/feature** — a separate future page (ServiceM8-style), not built here. Only the `invoiced` flag exists in the schema to make that addition a simple future migration.
- **`job_costs` UI** (materials/receipts) — deferred to a later phase. Job detail does not show a costs section yet, even though the table and RLS already exist.
- **Search boxes** on client or job lists — only the job status filter is included this pass.
- **Dashboard stat cards are not clickable** — no filtered-list drill-down yet.
- **Inline "create new client" from the job creation form** — client must already exist, picked from a dropdown.
- **Technician-initiated status changes** — status stays admin/office-only; technicians signal progress only through diary entries.

## Verification

Every screen's data access maps directly to an already-live, already-tested RLS policy or the already-tested `get_my_jobs()` function — no new SQL is introduced by this spec beyond what's already committed in the job-status correction. Manual verification for this phase means: confirm each screen renders the right rows/columns per role by signing in as each of the three test accounts (admin, office, technician) and checking against the rules above — same manual-verification approach used for Day 1-2 (Task 9).
