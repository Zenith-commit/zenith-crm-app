# Repeat-Client Address Auto-Populate — Design Spec

**Date:** 2026-09-02
**Status:** Approved

## Background

Second item (of the client's 10-item post-pilot feedback list) triaged as a Phase A "quick win." Investigation first (see conversation, not repeated here) established this is a mixed picture, not a clean "already works" or "needs building":

- Client phone/email already never need re-entry for a repeat client — they live only on `clients` and are read live via the `client_id` join wherever a job displays them (`ClientSiteInfoSection` on `JobDetail`). No new work needed there.
- `site_address` is **not** auto-filled anywhere in job creation today. `JobForm`/`JobNew` starts it completely blank regardless of client history — no lookup, no pre-fill. The only existing assist, "Copy from Client Address" on `ClientSiteInfoSection`, lives on the post-creation `JobDetail` edit view and pulls only from `clients.address`, never from a previous job's actual site.
- There is also no "New Job" shortcut from `ClientDetail` — job creation always starts from a blank client dropdown on `/jobs/new`.

This spec covers the two pieces of real new work: an address-history picker in `JobForm`, and a "New Job" button on `ClientDetail` that pre-selects the client.

## Relationship to existing screens

`JobForm.jsx` is shared between `JobNew` (create) and `JobDetail`'s edit mode — the address picker is built into `JobForm` itself so both get it identically, per your answer that consistency matters more than scoping it to creation only. `ClientSiteInfoSection` (the separate inline site-address editor on `JobDetail`, outside `JobForm`) is explicitly untouched — it already has its own simpler "Copy from Client Address" affordance and wasn't part of this ask.

## Scope

In scope:
- Replace `JobForm`'s plain `site_address` text input with a `<select>` of that client's known addresses plus a fixed "Add new address" option, falling back to a text input when "Add new address" is chosen (or when the client has no known addresses at all)
- Address list = distinct, non-empty `jobs.site_address` values for that client, plus `clients.address`, deduped, sorted alphabetically
- Default-selection logic: auto-select when the combined list has exactly one distinct address (unambiguous); default to "Add new address" (blank) when there's more than one, requiring an active choice — deliberate, to avoid a technician being silently dispatched to the wrong property
- Edit-mode fallback: pre-select whichever option exactly matches the job's current `site_address`; if none match, default to "Add new address" pre-filled with the current value (never silently blank an existing address)
- "New Job" button on `ClientDetail`, staff-only, linking to `/jobs/new?client_id=<id>`
- `JobNew` reads that query param and passes `initialValues={{ client_id }}` into `JobForm` — the client dropdown arrives pre-selected but stays fully editable

Out of scope (explicitly deferred / not touched):
- `ClientSiteInfoSection`'s own site-address editing on `JobDetail` — untouched, keeps its existing "Copy from Client Address" button as-is
- Any schema or RLS change — none needed (see below)
- Deduping/merging near-identical addresses (e.g. minor formatting differences) — exact string match only, same as everywhere else in this app

## Data model

No new tables or columns. This reads existing data only:
- `clients.address` (already fetched by `useClients()`, no new query needed)
- `jobs.site_address` for the selected client (new query, scoped to that client)

## Access (RLS)

No changes. `jobs.site_address` and `clients.address` are already fully readable/writable by admin/office through existing policies (`jobs_admin_all`/`jobs_office_select`/`jobs_office_update`, `clients_admin_all`/similar). Technicians have zero select or insert policy on `jobs` regardless of route — `JobForm` is only ever reached through staff-gated UI (`isStaff` checks on `JobList`'s "Add Job" link and `JobDetail`'s "Edit Job" button, plus the new `ClientDetail` "New Job" button), and even a technician navigating directly to `/jobs/new` would hit a real RLS insert failure, not a silent bypass — consistent with this app's established no-route-guard convention.

## Frontend

**`JobForm.jsx`:**
- New effect: whenever `values.client_id` changes, query `jobs` for that client's distinct non-empty `site_address` values, combine with the client's `address` (looked up from the already-loaded `clients` list passed in via `useClients()`), dedupe, sort alphabetically.
- Render a `<select>` for site address: the combined list as options, plus a fixed `"__new__"` sentinel option labeled "Add new address" at the end.
- When `"__new__"` is selected, show a text `<input>` below it for free-text entry (this is the only state in which `site_address` is manually typed — otherwise it's exactly the selected option's value).
- Selection is decided by one ordered rule, applied both on initial load and whenever `client_id` changes: (1) if `initialValues.site_address` is set and exactly matches one of the combined list's entries, pre-select it; (2) else if the combined list has exactly one entry, auto-select it; (3) else select `"__new__"`, with the text input pre-filled from `initialValues.site_address` if present, blank otherwise. If the combined list is empty (no history and no `clients.address`), skip the dropdown entirely and render the plain text input as today. Note rules (1) and (2) never actually conflict — a job's own current `site_address` is always itself a member of that client's distinct-address list by construction, so an edit-mode job with a single known address matches both rules identically.

**`ClientDetail.jsx`:** add a staff-only `<Link className="btn-primary" to={`/jobs/new?client_id=${id}`}>New Job</Link>`, placed near the existing "Edit Client" button.

**`JobNew.jsx`:** read `client_id` from `useSearchParams()` and pass `initialValues={{ client_id }}` to `JobForm` instead of `null` when present.

## Testing / verification plan

No RLS/DB changes to verify live. Manual browser verification instead, covering:
- A client with zero prior jobs and no `clients.address` set: `JobForm`'s site address renders as today's plain text input (no dropdown)
- A client with exactly one distinct known address (whether from one prior job, or only `clients.address` with no job history): site address auto-selects that value on client selection
- A client with two or more distinct addresses: dropdown defaults to "Add new address" (blank), and picking an existing option correctly sets the value with no text input shown
- Editing an existing job whose `site_address` matches one of the client's known addresses: that option is pre-selected on load
- Editing an existing job whose `site_address` matches none of the client's known addresses (a one-off/legacy value): "Add new address" is pre-selected with the existing value intact in the text input, not blanked
- `ClientDetail`'s new "New Job" button navigates to `/jobs/new?client_id=<id>` with that client pre-selected in the dropdown, and confirm the dropdown is still freely changeable to a different client
- Confirm the button is hidden for technician role on `ClientDetail`, matching every other staff-only affordance on that page
