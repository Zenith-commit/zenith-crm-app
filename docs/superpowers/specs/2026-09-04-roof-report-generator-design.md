# Roof Report Generator — Design Spec

**Date:** 2026-09-04
**Status:** Approved

## Background

Item 4 on the client's post-pilot feedback list, held back pending design/content input from Abigail — that input has now arrived as a working mockup and a real, already-tested Node.js script (`generate_report.js`) that renders a branded `.docx` roof inspection report from a JSON payload matching `report_schema.md`.

This is the first feature in this project requiring genuine server-side compute. Every prior "write-capable" feature (`apply_bundle_to_job()`, `create_invoice()`) stayed inside a Postgres `SECURITY [INVOKER|DEFINER]` function under RLS — none of them ran actual application code outside the database. `generate_report.js` uses `fs.readFileSync`/`process.argv`/`fs.writeFileSync` and the `docx`/`image-size` npm packages — it cannot run in the browser and has no Postgres equivalent. This spec covers running it as a Supabase Edge Function (Deno runtime), reusing its document-building logic essentially unchanged and rewriting only its I/O boundary.

This was investigated before this spec (see chat history 2026-09-04): repo confirmed to have none of the client's files already; `docx`/`image-size` confirmed to work via Deno's `npm:` specifiers since both are pure-JS/buffer-based with no native bindings or real filesystem dependency in their core APIs; Edge Function resource limits independently verified against Supabase's own docs (256MB memory, 2s CPU time excluding async I/O, 150s/400s wall-clock free/paid); the AI-extraction step from the client's original idea confirmed unnecessary since the mockup form is fully structured and maps 1:1 onto `report_schema.md`.

## Scope

In scope:
- New "Roof Report" tab on `JobDetail`, staff-only (admin/office — matches `InvoiceSection`'s existing `isStaff` gate exactly; technicians get zero access, tab not rendered at all).
- A form matching the mockup: Client/Strata/Real Estate Name, Work Order/Plan#, Property Address, Roof Type (dropdown), Date of Inspection, Roof Age, Inspector Assigned (free text), Roof Pitch, Urgent Repairs (one Observation box, one Recommendation box), Preventive Repairs (same shape), multi-photo upload, Generate button.
- Client-side photo downscaling before upload (≈1600px longest edge, JPEG quality ≈0.8) — approved specifically to control Edge Function memory risk (see "Execution architecture" below).
- A new Edge Function (`generate-roof-report`) that assembles the `.docx` using the real `generate_report.js` logic, rewritten only at its I/O boundary.
- Multiple reports per job, sequence-numbered like `invoices` — each generation is a new permanent row + stored document, full history kept, nothing overwritten. (Confirmed 2026-09-04, chosen over the `job_contacts`-style single-row-per-job shape.)
- Persisting the generated `.docx` to Storage so past reports can be re-downloaded without regenerating.

Out of scope, explicitly deferred:
- Any AI/Claude-API text extraction step (confirmed unnecessary — form is already structured).
- Photo captions (mockup has no caption input; schema supports them, synthesized as empty strings at generation time — see "Data model").
- Editing or deleting a generated report after creation (immutable once created, same as `invoice_line_items`; no void/delete this phase, same accepted-limitation pattern as invoicing).
- Job-status gating on report generation (no restriction on which job statuses allow generating a report, same precedent as invoicing).
- Any staff dropdown for Inspector Assigned — confirmed free text, not sourced from `users`.

## Field mapping (form → `report_schema.md`, confirmed 2026-09-04)

Verified against the real `generate_report.js` (specifically its `detailCell(...)` calls and `req(v, fallback)` helper, which `String()`-coerces and substitutes a fallback for anything missing) — every schema field has a direct form counterpart, no orphans either direction:

| Form field | Schema field | Notes |
|---|---|---|
| Client/Strata/Real Estate Name | `client` | Free text. Prefill from `job.clientName` on form open (editable) — this can legitimately differ from the CRM's client record (e.g. addressed to a strata manager), so it's a default, not a locked value. |
| Work Order/Plan# | `work_order` | Free text. |
| Property Address | `property_address` | Free text. Prefill from `job.site_address` on form open (editable), same reasoning as above. |
| Roof Type (dropdown: Tiled Roof / Metal Roof / Asbestos Roof / Others) | `roof_type` | Confirmed 2026-09-04: dropdown uses proper-case values (`"Tiled Roof"`) even though the example JSON uses lowercase (`"Tiled roof"`) — harmless, since the renderer prints the string completely literally with no casing logic of its own. |
| Date of Inspection | `date_of_inspection` | The renderer does zero date parsing — it prints the string exactly as given. Confirmed 2026-09-04: stored as a real Postgres `date`, but the frontend must format it to `DD/MM/YYYY` before building the Edge Function payload, since a native `<input type="date">` emits ISO. |
| Roof Age | `roof_age` | Free text (e.g. "12 years", "Not specified"). |
| Inspector Assigned | `inspector` | Confirmed 2026-09-04: free text, not a staff-select dropdown. |
| Roof Pitch | `roof_pitch` | Free text (e.g. "22°", "Not specified"). |
| Urgent Repairs — Observation box | `urgent_repairs.observations[]` | Confirmed: one textarea, split into array entries by line break on submit (trim + drop empty lines). No bullet characters needed — the renderer's `bulletParagraphs()` adds those itself. |
| Urgent Repairs — Recommendation box | `urgent_repairs.recommendations[]` | Same splitting. Independent array — doesn't need to match the observations array's length (confirmed by `twoColBody()`, which renders two independent bulleted columns). |
| Preventive Repairs — Observation / Recommendation boxes | `preventive_repairs.{observations,recommendations}[]` | Same shape and splitting as Urgent. |
| Multi-photo upload | `photos[].path` (+ `caption`) | Confirmed: no caption input. Verified directly in `photoCell()` that an empty-string caption renders fine (a blank italic line, no error) — so captions are synthesized as `""` at generation time, nothing stored per-photo beyond the path. |

## Data model

```sql
create type public.roof_type_option as enum ('Tiled Roof', 'Metal Roof', 'Asbestos Roof', 'Others');

create table public.roof_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sequence_num integer not null,
  client_name text,
  property_address text,
  date_of_inspection date,
  inspector text,
  work_order text,
  roof_type public.roof_type_option,
  roof_age text,
  roof_pitch text,
  urgent_observations text[] not null default '{}',
  urgent_recommendations text[] not null default '{}',
  preventive_observations text[] not null default '{}',
  preventive_recommendations text[] not null default '{}',
  photo_paths text[] not null default '{}',
  docx_path text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, sequence_num)
);
```

- **Multiple per job, sequence-numbered** (confirmed 2026-09-04) — same shape as `invoices`, not `job_contacts`. `sequence_num` computed the same race-safe way `create_invoice()` does (`coalesce(max(sequence_num), 0) + 1` inside a single atomic insert), via a new `create_roof_report(...)` Postgres function mirroring `create_invoice()` exactly (see "Execution architecture").
- **Immutable once created** — no update policy for anyone (matches `invoice_line_items`, not `invoices`' mutable `paid_amount`). Editing metadata after generation wouldn't regenerate the stored `.docx`, so allowing it would let the row and the document silently disagree — simplest correct behavior is: generate a new report instead of editing an old one, same mental model as invoices already establish in this app.
- **No delete for anyone this phase** — same permanent-once-generated precedent as `invoices`; voiding is a deferred future item, not built here.
- **`photo_paths` is a plain array of Storage paths, no per-photo caption column** — captions don't exist in this phase's UI, so there's nothing to persist. If a caption UI is added later, this is a natural additive schema change, not a breaking one.
- `client_name`/`property_address`/etc. are snapshotted at generation time (not live-joined to `jobs`/`clients`), same snapshot precedent as `invoice_line_items` and `bundle_items` → `job_line_items` — a report reflects the property/inspection details as they were at generation, not whatever `jobs`/`clients` says today.

## Access (RLS)

Confirmed 2026-09-04: **staff-only, same as Invoicing** — technicians get zero access to this feature anywhere (not the tab, not the table, not either bucket).

```sql
alter table public.roof_reports enable row level security;

create policy "roof_reports_admin_all" on public.roof_reports
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "roof_reports_office_select" on public.roof_reports
  for select
  using (public.current_app_role() = 'office');

create policy "roof_reports_office_insert" on public.roof_reports
  for insert
  with check (public.current_app_role() = 'office');

-- No office update, no delete for anyone (see "Data model" above).
-- No technician policy at all -- zero access, not even read.
```

`create_roof_report(...)` is `security invoker` (the default, same as `create_invoice()`) — a technician calling it directly hits a real RLS violation on the insert, not a silent null. This is the RLS layer; see "Execution architecture" below for why the Edge Function needs its *own*, independent role check on top of this, not instead of it.

**Two Storage buckets, deliberately different shapes:**

- **`roof-report-photos`** (input photos, browser-uploaded before Generate is clicked) — same admin/office-insert/select pattern as `diary-photos`/`feedback-photos`, no technician access. Also gets an **office delete policy** — a deliberate exception reasoned the same way as `bundle_items_office_delete`: before Generate is clicked, an uploaded photo is compose-time working data (staff should be able to remove a mis-uploaded photo from the form), not a permanent record — once Generate succeeds and a `roof_reports` row references it, deleting the underlying photo would silently break that row's `photo_paths`, so the frontend must never call delete after a report referencing that path exists (not enforced at the DB level this phase — same accepted-risk shape as every other non-transactional multi-step write in this app).
- **`roof-report-docs`** (output `.docx` files, written only by the Edge Function via the service-role key) — admin/office **select only**. No insert/update/delete policy for the anon key at all — the only writer is the service-role client inside the Edge Function, which bypasses RLS entirely; the explicit absence of an anon-key write policy is defense-in-depth (fail-closed if anything ever tried to write here directly), matching this project's established security-hardening rigor.

## Execution architecture

**New Edge Function: `generate-roof-report`.** This is the first Edge Function in this project — there is no existing "other functions" to share or split from, so the earlier same-function-vs-separate-function question resolves to: **one function**, for a concrete reason, not just simplicity — `docx`'s API isn't streaming. The whole `Document` tree (holding every `ImageRun`'s buffer) has to be built before `Packer.toBuffer()` runs once, so splitting photo-fetching and rendering into two function calls wouldn't lower peak memory in the function that actually calls `Packer.toBuffer()` — each Edge Function invocation gets its own independent 256MB regardless of how many functions exist. Splitting buys nothing here.

**Memory risk and its actual mitigation.** Read directly from `generate_report.js`: `loadPhoto()`'s `MAX_PHOTO_W`/`MAX_PHOTO_H` only computes a *display* transformation for Word (`transformation: { width, height }` on `ImageRun`) — it does not downsample the actual embedded bytes. A full-resolution phone photo (commonly 5-15MB) gets embedded at full size regardless. Against a 256MB hard ceiling, several full-res photos plus `Packer.toBuffer()`'s own JSZip compression overhead is a real risk, not a hypothetical one. **The fix approved 2026-09-04 is client-side, not server-side:** resize every photo via canvas to ≈1600px longest edge, JPEG quality ≈0.8, before it's ever uploaded to `roof-report-photos`. This is also a better fit for what the document actually needs — the renderer only ever displays photos at 300×220px — and it keeps Storage usage and mobile upload time down as a side benefit. No new npm dependency — canvas resizing uses the browser's native Canvas API, consistent with this project's no-new-dependency convention for UI primitives.

**Rewrite boundary, confirmed against the real script — the rendering logic itself barely changes:**
- `process.argv` + `fs.readFileSync(dataPath)` → replaced with the Edge Function's parsed JSON request body (job fields + photo storage paths, assembled by the frontend).
- `LOGO_PATH` / `fs.readFileSync(LOGO_PATH)` → confirmed 2026-09-04: base64-embedded directly in the function's source at build time, rather than relying on untested Edge Function asset-bundling behavior.
- `loadPhoto()`'s `fs.readFileSync(resolved)` on a locally-resolved path → replaced with fetching each photo's bytes from `roof-report-photos` via a service-role Supabase client into a `Buffer`. Everything downstream of that buffer (`imageSize(buf)`, `ImageRun({ data: buf, ... })`) is **completely unchanged** — the script was already buffer-based internally, this is a clean substitution point, not a redesign.
- `Packer.toBuffer(doc).then((buf) => fs.writeFileSync(outPath, buf))` → replaced with: upload `buf` to `roof-report-docs`, insert the `roof_reports` row (via the `create_roof_report(...)` RPC, using a Supabase client scoped to the *caller's* JWT so RLS still applies to that specific write), then return `buf` directly as the HTTP response body (`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`) so the browser triggers an immediate download — same UX as `InvoiceSection`'s existing client-side PDF download, just server-rendered instead of `jsPDF`. The DB row is only written *after* the Storage upload succeeds, so a failed upload never produces a broken/dangling visible report row (an orphaned Storage object with no DB row is the only failure-mode residue, same accepted-risk shape as every other non-transactional multi-step write already in this app).
- Every other function in the script — `label()`, `valueLine()`, `detailCell()`, `sectionHeader()`, `fusedSection()`, `bulletParagraphs()`, `columnTitle()`, `twoColBody()`, `photoGrid()`, the header/footer/title-bar tables, the final `Document` assembly — is pure, portable JS with zero fs/CLI dependency. This is copied into the Edge Function essentially unchanged.

**Security-critical requirement, specific to this being the first Edge Function in the project:** RLS does not automatically protect Edge Function code the way it protects a Postgres function or table — a Postgres function's own DB operations are still gated by RLS (which is why `create_roof_report(...)` is safe on its own), but the Edge Function's *other* privileged operations — fetching photo bytes from `roof-report-photos` and writing to `roof-report-docs` — use the service-role client, which **bypasses RLS entirely**. Nothing stops a technician (or any authenticated user) from calling the Edge Function's HTTP endpoint directly and reaching those service-role operations unless the function's own code checks the caller's role first. **The function must, as its first step, verify the caller's role is `admin` or `office`** by querying `public.users` using a Supabase client scoped to the caller's own JWT (extracted from the incoming request's `Authorization` header) — mirroring the same admin/office check every RLS policy in this app already makes, just reimplemented in application code since this is the one place RLS can't reach automatically. Reject with a real HTTP error (401/403) before doing anything else if this check fails.

**New secret-management surface:** the Edge Function needs `SUPABASE_SERVICE_ROLE_KEY` as a function secret (set via the Supabase dashboard/CLI, never committed to the repo) — the first time this project has needed a service-role key anywhere. Treat with the same care as every other credential in this app.

**Package versions:** `docx` and `image-size` imported via `npm:` specifiers, pinned to explicit versions (not floating). The script's `const { imageSize } = require("image-size")` destructured-named-export style corresponds to `image-size` v2.x (v1.x exported a default function) — pin `image-size@^2.0.0` or later accordingly. `docx`'s exports used (`Document`, `Packer`, `Paragraph`, `TextRun`, `Table`, `TableRow`, `TableCell`, `WidthType`, `ShadingType`, `AlignmentType`, `BorderStyle`, `ImageRun`, `Header`, `Footer`, `VerticalAlign`, `PageNumber`) are stable across a broad recent version range — pin to latest stable and adjust only if an export/behavior mismatch surfaces during implementation.

## Frontend

- **`RoofReportSection`** (new component, mounted as a new staff-only tab in `JobDetail`'s tab array — `STAFF_TABS` gains `'Roof Report'`, `TECHNICIAN_TABS` is untouched). Shows a list of past reports for the job (newest first, `formatRoofReportNumber()`-style sequence display mirroring `formatInvoiceNumber()`'s existing convention, e.g. `Report #0001-A`), each with a Download button (fetches a fresh signed URL for the stored `docx_path`, no regeneration — same recipe `DiarySection`/`FeedbackInbox` already use for signed-URL photo access), plus a `RoofReportForm` for creating a new one.
- **`RoofReportForm`** — the fields listed in "Field mapping" above, Client/Property Address prefilled-but-editable from `job.clientName`/`job.site_address`, Roof Type as a `<select>` with the four proper-case options, Date of Inspection as a native date input (converted to `DD/MM/YYYY` at submit time, not stored/displayed in ISO anywhere in the generated document), Urgent/Preventive Observation and Recommendation as four plain `<textarea>`s (split into arrays on submit: split on newline, trim, drop empty lines), a multi-photo `<input type="file" multiple accept="image/*">` with client-side canvas resize (≈1600px longest edge, JPEG quality ≈0.8) before upload to `roof-report-photos`, live thumbnail previews, and a Generate button that: uploads any pending photos, calls the `generate-roof-report` Edge Function via `supabase.functions.invoke(...)` with the assembled payload, and on success triggers the returned `.docx` blob's download and refreshes the report list.
- A soft (non-blocking) warning if the user attaches an unusually large number of photos, given the memory discussion above — exact threshold to be picked during implementation, not a hard cap (the script itself has none).
- **`useRoofReports(jobId)`** hook — list existing reports, plus the `createReport(formValues)` flow described above.

## Testing / verification plan

Live RLS verification against test accounts for all three roles, following this project's established pattern (`DO` block + `RAISE EXCEPTION`, never combined with real DDL):
- `roof_reports`: admin full CRUD; office select/insert only (no update, no delete); technician zero access (not even select).
- `roof-report-photos` bucket: admin/office insert/select/delete; technician zero access.
- `roof-report-docs` bucket: admin/office select only; confirm an anon-key insert/update/delete attempt is rejected (only the service-role client can write).
- `create_roof_report(...)`: correct sequence numbering across an admin report then an office report on the same job (mirrors `create_invoice()`'s existing verification); technician calling it directly gets a real RLS error, not a null.

**Edge-Function-specific verification, beyond the usual RLS checklist** (since this is the first Edge Function in the project and RLS alone doesn't cover it):
- Call the deployed function directly (e.g. via `curl` with a technician's JWT) and confirm it's rejected by the function's own role check — this is the one access-control path that RLS cannot enforce on its own, so it needs its own explicit test, not just trust in the DB-layer checks above.
- Confirm an unauthenticated call (no JWT / invalid JWT) is rejected.

Frontend, manually verified for admin and office (technician confirmed to have no visible tab and no access at all):
- Generate a report with all fields populated, download it, and open it — confirm every field lands in the right place, `DD/MM/YYYY` date formatting is correct, and photos are embedded correctly scaled.
- Generate a second report on the same job, confirm sequence numbering increments and both remain independently downloadable.
- Confirm a report with zero photos renders the "no photo provided" placeholder (already handled by `photoGrid()`/`photoCell()` unchanged).
- Confirm an empty Urgent or Preventive box renders "None noted at time of inspection." (already handled by `bulletParagraphs()` unchanged).
- **Explicitly test HEIC photo upload** (flagged 2026-09-04 as something to verify, not assume) — some iPhones upload HEIC directly depending on browser/settings, and `image-size`'s HEIC support was not independently confirmed during investigation. If unsupported, decide during implementation whether to convert client-side before upload or reject HEIC files with a clear error, rather than letting a report silently fail or show a broken placeholder.
- Confirm re-downloading a past report returns the exact original document without re-invoking the Edge Function (i.e., it's actually served from `roof-report-docs`, not silently regenerated).
