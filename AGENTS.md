# Zenith CRM

Job management app for **Zenith Roof Restorations and Replacements Pty Ltd**, an Australian roofing company. Modeled loosely on ServiceM8, plus custom features the client asked for.

- Frontend: Vite + React SPA (React Router `BrowserRouter`)
- Backend: Supabase (Postgres, Auth, Storage, one Edge Function: `generate-roof-report`)
- Access control: Row-Level Security keyed off `role` on `public.users`
- Repo: `Zenith-commit/zenith-crm` (private, under Zenith's business GitHub account)

## Live environment: read before pushing or running SQL

- **Pushing to `main` deploys the live Vercel site.** There is no manual deploy step.
- **There is one Supabase project.** Local dev, testing, and the live site all share it, so any SQL you run touches live data.
- Env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) live in Vercel project settings, not the repo. `vercel.json` rewrites every path to `index.html` so deep links work.

## Roles

`admin`, `office`, `technician`.

- **admin / office**: full access to clients, jobs, catalog, bundles, job line items (including cost/price/markup), diary, and communications.
- **technician**: sees only jobs where they have a **confirmed** `schedule_entries` row (checked by `technician_owns_job()`). Can read job details and the diary. On job line items they get **qty and item name only**. Cost, markup, and price are hidden at the query/RLS level (through RPCs like `get_my_job_line_items()`), never only in the UI.
- Test accounts for all three roles exist on the live project. Use those instead of creating new ones.

Job status pipeline: `Quote → Work Order → Scheduled → Completed`.

## Conventions

- **Soft-archive**: catalog-style tables (`materials_catalog`, `bundles`, …) use an `active` flag instead of deleting rows.
- **RLS shape**: `admin` gets one `for all` policy. `office` gets explicit select/insert/update policies with no delete, unless deleting a row destroys no real history (child rows edited routinely, or optional/folder-style rows: `bundle_items`, `job_contacts`, `queues`, `schedule_entries`). `technician` gets zero access unless the feature says otherwise.
- **Atomic writes** go in a Postgres function that runs `security invoker`, so RLS still applies (`apply_bundle_to_job`, `create_invoice`, `create_schedule_entry`, …).
- **Changing a function's return columns** requires drop + recreate, not `create or replace` (as with `get_my_jobs()`).
- **Schema changes**: record live DDL in `supabase/migrations/YYYY-MM-DD_name.sql`, and update the fresh-install files in `supabase/schema/` and `supabase/policies/` to match. They have drifted before.
- `item_number` fields are optional and not unique (a display label, not a key).
- **Mocked integrations**: email/SMS (and later Xero) are deliberate demos for a future developer. Build the UX and leave out real providers or credentials.
- **UI primitives** (`Modal`, `MaterialPicker`) are hand-built. Add a dependency only when the user approves it.
- Pages have no route guards. RLS is the gate, so a blocked role just sees an empty list.

## Gotchas that keep recurring

- **Current user id in a write function**: take a `userId` prop sourced from `AppShell`'s outlet context (`{ profile, session }`). Calling `supabase.auth.getUser()` inside a hook races session init and throws on fresh page loads.
- **No stuck spinners**: every async function whose caller expects `{ error }` catches its own errors and returns them.
- **Embedded joins across RLS tables** (e.g. to `users`) silently return `null` for technicians. Test the technician path, and use a scoped RPC like `get_sender_name()` when needed.
- **Dates**: build `scheduled_date` and other local dates with local arithmetic (`src/lib/scheduleUtils.js`). `toISOString()` converts to UTC and shows Australian staff the wrong day.
- **Storage**: Supabase blocks raw SQL deletes on storage tables. Use the Storage API, the app UI, or the dashboard.

## Verifying work

- **RLS**: verify live as each role (always including technician) before calling a table done, using `DO $$ … RAISE EXCEPTION $$` impersonation blocks. Reviewing the policy text alone isn't enough.
- **Browser-only behavior** (CORS, `supabase.functions.invoke()` response parsing, drag-and-drop) needs a real browser test. `curl` passes where the browser fails.
- `npm run lint` and `npm run build` must both be clean.

## Working style

- Verify what actually exists (files, commits, completed migrations) before assuming or building on top of it.
- Confirm schema/RLS design with the human before implementing, especially anything touching role-based access.
- Report what was created and the results of live verification before moving to the next table/feature.
- When a feature is finished, add its entry to `docs/build-log.md` and update `docs/roadmap.md`.

## Where to look

- `docs/build-log.md`: every built feature with its decisions and the bugs found. Read a feature's entry before changing it.
- `docs/roadmap.md`: client feedback list, deferred items, known issues, and the security handoff checklist. Read it when choosing the next task or answering status questions.
- `docs/schema-relationships.md`: plain-English map of how the tables connect.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: design and plan for each feature.
- `GLOSSARY.md`: domain terms.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for Zenith-commit/zenith-crm (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
