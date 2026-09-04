# JobDetail Redesign Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `JobDetail` into a left-sidebar tab layout (Details / Job Contact / Billing / Invoicing) with a persistent right-side activity panel, add a new job-specific Contact override that never touches the linked client's real record, and convert Email/SMS from always-visible inline sections into header-triggered modals.

**Architecture:** A new `job_contacts` table (RLS'd so technicians can view but not edit, and office can delete — a deliberate one-off broader-than-usual office policy since this is a single optional override row, not a permanent record) backs a new `JobContactSection` tab. `JobDetail.jsx` gains local `activeTab` state (no new routes — nothing else in this app has sub-navigation, and tabs don't need to be independently linkable) and a first-ever shared `Modal` component (no new dependency) that `CommunicationSection` mounts inside, unchanged internally. `DiarySection` relocates into a persistent right-side panel as-is — no schema or behavior change — so Phase 2 (a separate plan) can extend that same panel with email/sms/booking-history without a second layout change.

**Tech Stack:** React + Vite, Supabase (Postgres RLS), no automated JS test framework exists in this repo — verification follows this project's established pattern of live RLS checks run manually in the Supabase SQL Editor, plus manual browser verification for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-03-jobdetail-redesign-phase1-design.md`

## Global Constraints

- Job status pipeline (`Quote → Work Order → Scheduled → Completed`) is unchanged — do not touch `public.job_status` or any status-transition logic.
- Job Category and PO Number fields are explicitly deferred — do not add them.
- `ClientSiteInfoSection` is unchanged and keeps editing `clients.phone`/`clients.email`/`jobs.site_address` directly — the new Job Contact feature is a separate, additional contact, never a replacement or fallback for it.
- `job_contacts` must never cause a write to `public.clients` — editing/clearing a job contact only ever touches `public.job_contacts`.
- Tab navigation is component-local React state (`activeTab`), not new routes.
- The Invoicing tab is omitted entirely for technicians (not rendered, not just hidden by CSS) — matches today's `isStaff` gate on `InvoiceSection`.
- `job_contacts` RLS: admin `for all`; office select/insert/update **and delete**; technician select-only via `technician_owns_job()`. This delete grant for office is a deliberate exception confirmed in design review — do not extend this reasoning to any other table without a fresh decision.
- `CommunicationSection` gets no internal logic changes — only its mounting context changes (inside `Modal` instead of directly in the page).
- No new npm dependencies for the `Modal` component or anywhere else in this plan.
- This project has no Supabase CLI/service-role access configured in this environment — every SQL file must be run by the human via the Supabase Dashboard SQL Editor, not executed directly by the agent.
- No route guards exist anywhere in this app — do not introduce one for anything in this plan.

---

### Task 1: `job_contacts` table + RLS

**Files:**
- Create: `supabase/schema/015_job_contacts.sql`
- Create: `supabase/policies/018_job_contacts_policies.sql`

**Interfaces:**
- Produces: table `public.job_contacts(job_id uuid primary key, first_name text, last_name text, email text, phone text, mobile text, updated_by uuid, updated_at timestamptz)`, consumed by Task 3 (`useJobContact`).

- [x] **Step 1: Write the schema file**

```sql
create table public.job_contacts (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.job_contacts is 'A job-specific contact person (e.g. on-site tenant or foreman), separate from and independent of the linked client''s own contact info in public.clients. Editing this never updates public.clients. At most one row per job -- job_id is the primary key, so "no override set" is a missing row, not a row of nulls.';
```

- [x] **Step 2: Write the RLS policy file**

```sql
alter table public.job_contacts enable row level security;

create policy "job_contacts_admin_all" on public.job_contacts
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_contacts_office_select" on public.job_contacts
  for select
  using (public.current_app_role() = 'office');

create policy "job_contacts_office_insert" on public.job_contacts
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_update" on public.job_contacts
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_delete" on public.job_contacts
  for delete
  using (public.current_app_role() = 'office');

-- Technicians can view the job contact for jobs assigned to them --
-- same technician_owns_job() pattern as job_diary_technician_select --
-- but cannot create, edit, or clear it.
create policy "job_contacts_technician_select" on public.job_contacts
  for select
  using (
    public.current_app_role() = 'technician'
    and public.technician_owns_job(job_contacts.job_id)
  );
```

- [x] **Step 3: Run both files against the live Supabase project**

Ask the user to open the Supabase Dashboard SQL Editor and run the contents of `supabase/schema/015_job_contacts.sql` followed by `supabase/policies/018_job_contacts_policies.sql`, then confirm both ran with no errors.

- [x] **Step 4: Look up the three test-account UUIDs**

Ask the user to run this in the SQL Editor and report back the three ids:

```sql
select id, role from public.users where role in ('admin', 'office', 'technician');
```

- [x] **Step 5: Run the live RLS verification block**

Substitute the real UUIDs from Step 4 in place of `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>` below, then ask the user to run the whole block (it runs inside an explicit transaction with fixed test UUIDs for the scratch client/job rows it creates, and rolls back at the end, so no test rows are left behind):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
begin
  insert into public.clients (id, name) values
    ('99999999-9999-9999-9999-999999999901', 'RLS Test Client');
  insert into public.jobs (id, client_id, assigned_to) values
    ('99999999-9999-9999-9999-999999999911', '99999999-9999-9999-9999-999999999901', '<TECH_ID>');
  insert into public.jobs (id, client_id) values
    ('99999999-9999-9999-9999-999999999912', '99999999-9999-9999-9999-999999999901');

  insert into public.job_contacts (job_id, first_name) values
    ('99999999-9999-9999-9999-999999999911', 'Admin Set');
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') = 0 then
    raise exception 'admin should see the job_contacts row it just inserted';
  end if;

  update public.job_contacts set first_name = 'Admin Updated'
    where job_id = '99999999-9999-9999-9999-999999999911';

  delete from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911';
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') <> 0 then
    raise exception 'admin delete should have removed the row';
  end if;

  -- leave one row in place for office/technician to read
  insert into public.job_contacts (job_id, first_name, last_name, phone) values
    ('99999999-9999-9999-9999-999999999911', 'Site', 'Foreman', '0400000000');
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
begin
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') = 0 then
    raise exception 'office should be able to select the job_contacts row';
  end if;

  update public.job_contacts set mobile = '0411111111'
    where job_id = '99999999-9999-9999-9999-999999999911';

  delete from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911';
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') <> 0 then
    raise exception 'office delete should have cleared the job contact';
  end if;

  -- reinsert so the technician block below has a row to read
  insert into public.job_contacts (job_id, first_name) values
    ('99999999-9999-9999-9999-999999999911', 'Office Reinserted');
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
declare
  v_name text;
begin
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') = 0 then
    raise exception 'technician should see the job contact for their own assigned job';
  end if;

  if (select count(*) from public.job_contacts) <> 1 then
    raise exception 'technician should see exactly one job_contacts row (their assigned job only)';
  end if;

  -- RLS silently filters an update with no matching USING clause to zero
  -- rows affected (not an error) -- verify by checking the value didn't change.
  update public.job_contacts set first_name = 'Tampered'
    where job_id = '99999999-9999-9999-9999-999999999911';
  select first_name into v_name from public.job_contacts
    where job_id = '99999999-9999-9999-9999-999999999911';
  if v_name = 'Tampered' then
    raise exception 'technician should not be able to update a job_contacts row';
  end if;

  delete from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911';
  if (select count(*) from public.job_contacts where job_id = '99999999-9999-9999-9999-999999999911') = 0 then
    raise exception 'technician should not be able to delete a job_contacts row';
  end if;

  begin
    insert into public.job_contacts (job_id, first_name) values
      ('99999999-9999-9999-9999-999999999912', 'Not Mine');
    raise exception 'technician should not be able to insert a job_contacts row';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'All job_contacts RLS checks passed.';
end $$;

rollback;
```

Expected: the block completes with a `NOTICE: All job_contacts RLS checks passed.` and no unexpected `ERROR`. If any `raise exception` fires, stop and fix the corresponding policy before continuing.

- [x] **Step 6: Commit**

```bash
git add supabase/schema/015_job_contacts.sql supabase/policies/018_job_contacts_policies.sql
git commit -m "feat: add job_contacts table and RLS policies"
```

---

### Task 2: Shared `Modal` component

**Files:**
- Create: `src/components/Modal.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: `Modal({ onClose, children })` — a default export React component. Renders a backdrop + centered panel with a close (`×`) button in the top-right corner; calls `onClose()` on backdrop click, `×` click, or `Escape` keydown. Consumed by Task 4.

- [x] **Step 1: Write `Modal.jsx`**

```jsx
import { useEffect } from 'react'

export default function Modal({ onClose, children }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  )
}
```

- [x] **Step 2: Add modal styles to `src/index.css`**

Append to the end of the file:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal-panel {
  position: relative;
  background: var(--white);
  border-radius: 8px;
  max-width: 560px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 24px;
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: var(--navy);
}
```

- [x] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors. `Modal` has no consumer yet, so there's nothing to click-test interactively until Task 4 wires it up — full interactive verification (backdrop click, `×`, Escape) happens there.

- [x] **Step 4: Commit**

```bash
git add src/components/Modal.jsx src/index.css
git commit -m "feat: add shared Modal component"
```

---

### Task 3: JobDetail tab shell + Job Contact tab

**Files:**
- Create: `src/hooks/useJobContact.js`
- Create: `src/components/JobContactSection.jsx`
- Modify: `src/pages/JobDetail.jsx` (full rewrite of the return/body — see Step 3)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `public.job_contacts` (Task 1); `supabase` client from `src/lib/supabaseClient.js`.
- Produces: `useJobContact(jobId)` returning `{ contact, loading, error, save({ first_name, last_name, email, phone, mobile }), clear() }`, where `save`/`clear` each return `{ error }` (`null` on success). `contact` is `null` when no row exists. Not consumed by any other task in this plan, but keep this exact shape — Phase 2 may reuse it.

- [x] **Step 1: Write `useJobContact.js`**

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobContact(jobId) {
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_contacts')
      .select('job_id, first_name, last_name, email, phone, mobile, updated_at')
      .eq('job_id', jobId)
      .maybeSingle()

    if (error) setError(error)
    else setContact(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function save({ first_name, last_name, email, phone, mobile }) {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('job_contacts').upsert({
      job_id: jobId,
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || null,
      phone: phone || null,
      mobile: mobile || null,
      updated_by: user.id,
    })

    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function clear() {
    const { error } = await supabase.from('job_contacts').delete().eq('job_id', jobId)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { contact, loading, error, save, clear }
}
```

- [x] **Step 2: Write `JobContactSection.jsx`**

```jsx
import { useState } from 'react'
import { useJobContact } from '../hooks/useJobContact'

export default function JobContactSection({ jobId, isStaff }) {
  const { contact, loading, error, save, clear } = useJobContact(jobId)
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [mobile, setMobile] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  function startEdit() {
    setFirstName(contact?.first_name ?? '')
    setLastName(contact?.last_name ?? '')
    setEmail(contact?.email ?? '')
    setPhone(contact?.phone ?? '')
    setMobile(contact?.mobile ?? '')
    setFormError(null)
    setEditing(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const { error } = await save({ first_name: firstName, last_name: lastName, email, phone, mobile })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setEditing(false)
  }

  async function handleClear() {
    if (!window.confirm('Clear this job contact?')) return
    const { error } = await clear()
    if (error) setFormError(error.message)
  }

  if (loading) return <p>Loading job contact...</p>
  if (error) return <p role="alert">Could not load job contact: {error.message}</p>

  if (isStaff && editing) {
    return (
      <section>
        <h2>Job Contact</h2>
        <form onSubmit={handleSave}>
          <label>
            First name
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label>
            Last name
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Mobile
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </label>
          {formError && <p role="alert">{formError}</p>}
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </section>
    )
  }

  return (
    <section>
      <h2>Job Contact</h2>
      {contact ? (
        <>
          <p>Name: {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}</p>
          <p>Email: {contact.email || '—'}</p>
          <p>Phone: {contact.phone || '—'}</p>
          <p>Mobile: {contact.mobile || '—'}</p>
        </>
      ) : (
        <p>No job contact set.</p>
      )}
      {isStaff && (
        <>
          <button className="btn-primary" onClick={startEdit}>
            {contact ? 'Edit Job Contact' : 'Add Job Contact'}
          </button>
          {contact && (
            <button type="button" onClick={handleClear}>
              Clear
            </button>
          )}
        </>
      )}
    </section>
  )
}
```

- [x] **Step 3: Rewrite `JobDetail.jsx`'s body into a tab shell**

Replace the full contents of `src/pages/JobDetail.jsx` with:

```jsx
import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJob } from '../hooks/useJob'
import JobForm from '../components/JobForm'
import { formatJobNumber } from '../lib/jobConstants'
import ClientSiteInfoSection from '../components/ClientSiteInfoSection'
import JobContactSection from '../components/JobContactSection'
import DiarySection from '../components/DiarySection'
import BillingSection from '../components/BillingSection'
import InvoiceSection from '../components/InvoiceSection'
import CommunicationSection from '../components/CommunicationSection'

const STAFF_TABS = ['Details', 'Job Contact', 'Billing', 'Invoicing']
const TECHNICIAN_TABS = ['Details', 'Job Contact', 'Billing']

export default function JobDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const { job, loading, error, reload } = useJob(id, profile?.role)
  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState('Details')

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load job: {error.message}</p>
  if (!job) return <p>Job not found.</p>

  const isStaff = profile?.role !== 'technician'
  const tabs = isStaff ? STAFF_TABS : TECHNICIAN_TABS

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
      <h1>{formatJobNumber(job.job_number)} — {job.clientName}</h1>
      <div className="job-detail-body">
        <div className="job-detail-main">
          <nav className="job-detail-tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === activeTab ? 'job-detail-tab active' : 'job-detail-tab'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="job-detail-tab-content">
            {activeTab === 'Details' && (
              <>
                {isStaff && editing ? (
                  <JobForm initialValues={job} onSubmit={handleUpdate} submitLabel="Save Changes" />
                ) : (
                  <div>
                    <p>Status: {job.status}</p>
                    {isStaff && <p>Assigned To: {job.assignedName}</p>}
                    <p>Description: {job.description}</p>
                    {isStaff && (
                      <button className="btn-primary" onClick={() => setEditing(true)}>
                        Edit Job
                      </button>
                    )}
                  </div>
                )}
                <ClientSiteInfoSection job={job} isStaff={isStaff} onSaved={reload} />
              </>
            )}
            {activeTab === 'Job Contact' && <JobContactSection jobId={job.id} isStaff={isStaff} />}
            {activeTab === 'Billing' && <BillingSection jobId={job.id} role={profile?.role} />}
            {activeTab === 'Invoicing' && isStaff && (
              <InvoiceSection
                job={job}
                client={{ name: job.clientName, address: job.clientAddress }}
                role={profile?.role}
              />
            )}
          </div>
        </div>
        <aside className="job-activity-panel">
          <DiarySection jobId={job.id} />
        </aside>
      </div>
      {isStaff && (
        <CommunicationSection
          jobId={job.id}
          type="email"
          recipientDefault={job.clientEmail}
          role={profile?.role}
        />
      )}
      <CommunicationSection
        jobId={job.id}
        type="sms"
        recipientDefault={job.clientPhone}
        role={profile?.role}
      />
    </div>
  )
}
```

Note: Email/SMS are left rendered inline here exactly as before — Task 4 converts them to modals. This task only adds the tab shell, the Job Contact tab, and relocates `DiarySection` into the right panel.

- [x] **Step 4: Add tab/panel styles to `src/index.css`**

Append to the end of the file:

```css
.job-detail-body {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  margin-top: 16px;
}

.job-detail-main {
  display: flex;
  flex: 2;
  min-width: 0;
  gap: 24px;
}

.job-detail-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
}

.job-detail-tab {
  text-align: left;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  color: var(--navy);
}

.job-detail-tab:hover {
  background: var(--border);
}

.job-detail-tab.active {
  background: var(--navy);
  color: var(--white);
}

.job-detail-tab-content {
  flex: 1;
  min-width: 0;
}

.job-activity-panel {
  flex: 1;
  min-width: 280px;
  max-width: 360px;
  border-left: 1px solid var(--border);
  padding-left: 24px;
}
```

- [x] **Step 5: Manually verify in the browser**

Start the dev server (`npm run dev`). For each of the three test accounts (admin, office, technician):
- Open an existing job's detail page. Confirm the tab bar shows Details/Job Contact/Billing/Invoicing for admin and office, and Details/Job Contact/Billing (no Invoicing) for technician.
- Click each tab and confirm the correct content renders, and that switching tabs doesn't reload the page.
- Confirm the right-side panel shows the Diary list + compose form, and behaves identically to before (add an entry with a photo, confirm it appears).
- On the Job Contact tab: as admin/office, add a job contact (all five fields), save, reload the page, confirm it persisted. Edit it, confirm the update persists. Click Clear, confirm the row disappears and "No job contact set." shows. As technician (on a job assigned to them), confirm the same contact set by staff is visible read-only, with no Edit/Clear buttons.
- Confirm Email/SMS sections still render inline at the bottom of the page exactly as before (unchanged by this task).
- Confirm editing the Job Contact never modifies the linked client's `phone`/`email` — spot-check the `clients` row in the Supabase Table Editor before and after.

- [x] **Step 6: Commit**

```bash
git add src/hooks/useJobContact.js src/components/JobContactSection.jsx src/pages/JobDetail.jsx src/index.css
git commit -m "feat: add JobDetail tab shell, right-side activity panel, and Job Contact tab"
```

---

### Task 4: Email/SMS → header-triggered modals

**Files:**
- Modify: `src/pages/JobDetail.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `Modal` from Task 2 (`Modal({ onClose, children })`); `CommunicationSection` unchanged.

- [x] **Step 1: Add the modal trigger buttons and replace the inline `CommunicationSection` mounts**

In `src/pages/JobDetail.jsx`, add the import:

```js
import Modal from '../components/Modal'
```

Add `openModal` state alongside the existing `activeTab` state:

```js
const [activeTab, setActiveTab] = useState('Details')
const [openModal, setOpenModal] = useState(null) // null | 'email' | 'sms'
```

Replace the `<h1>...</h1>` line and everything from `{isStaff && (<CommunicationSection type="email" .../>)}` through the closing `<CommunicationSection type="sms" .../>` (the two inline communication blocks at the end of the returned JSX) with:

```jsx
      <h1>{formatJobNumber(job.job_number)} — {job.clientName}</h1>
      <div className="job-detail-actions">
        {isStaff && (
          <button type="button" className="btn-primary" onClick={() => setOpenModal('email')}>
            Email
          </button>
        )}
        <button type="button" className="btn-primary" onClick={() => setOpenModal('sms')}>
          SMS
        </button>
      </div>
```

directly after the `<h1>`, and at the very end of the component's returned JSX (replacing the old inline `CommunicationSection` blocks), just before the final `</div>`:

```jsx
      {openModal === 'email' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="email"
            recipientDefault={job.clientEmail}
            role={profile?.role}
          />
        </Modal>
      )}
      {openModal === 'sms' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="sms"
            recipientDefault={job.clientPhone}
            role={profile?.role}
          />
        </Modal>
      )}
```

The full component body after this change:

```jsx
  return (
    <div>
      <h1>{formatJobNumber(job.job_number)} — {job.clientName}</h1>
      <div className="job-detail-actions">
        {isStaff && (
          <button type="button" className="btn-primary" onClick={() => setOpenModal('email')}>
            Email
          </button>
        )}
        <button type="button" className="btn-primary" onClick={() => setOpenModal('sms')}>
          SMS
        </button>
      </div>
      <div className="job-detail-body">
        <div className="job-detail-main">
          <nav className="job-detail-tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === activeTab ? 'job-detail-tab active' : 'job-detail-tab'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="job-detail-tab-content">
            {activeTab === 'Details' && (
              <>
                {isStaff && editing ? (
                  <JobForm initialValues={job} onSubmit={handleUpdate} submitLabel="Save Changes" />
                ) : (
                  <div>
                    <p>Status: {job.status}</p>
                    {isStaff && <p>Assigned To: {job.assignedName}</p>}
                    <p>Description: {job.description}</p>
                    {isStaff && (
                      <button className="btn-primary" onClick={() => setEditing(true)}>
                        Edit Job
                      </button>
                    )}
                  </div>
                )}
                <ClientSiteInfoSection job={job} isStaff={isStaff} onSaved={reload} />
              </>
            )}
            {activeTab === 'Job Contact' && <JobContactSection jobId={job.id} isStaff={isStaff} />}
            {activeTab === 'Billing' && <BillingSection jobId={job.id} role={profile?.role} />}
            {activeTab === 'Invoicing' && isStaff && (
              <InvoiceSection
                job={job}
                client={{ name: job.clientName, address: job.clientAddress }}
                role={profile?.role}
              />
            )}
          </div>
        </div>
        <aside className="job-activity-panel">
          <DiarySection jobId={job.id} />
        </aside>
      </div>
      {openModal === 'email' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="email"
            recipientDefault={job.clientEmail}
            role={profile?.role}
          />
        </Modal>
      )}
      {openModal === 'sms' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="sms"
            recipientDefault={job.clientPhone}
            role={profile?.role}
          />
        </Modal>
      )}
    </div>
  )
}
```

- [x] **Step 2: Add action-bar styles to `src/index.css`**

Append to the end of the file:

```css
.job-detail-actions {
  display: flex;
  gap: 8px;
  margin: 8px 0 16px;
}
```

- [x] **Step 3: Manually verify in the browser**

For each of the three test accounts:
- Confirm an "Email" button appears only for admin/office, and an "SMS" button appears for all three roles, both directly under the job number heading.
- Click SMS: confirm a modal opens centered with a dimmed backdrop, containing the same send form / message history as before. Send a message and confirm it appears in the list without closing the modal.
- Close the modal three ways and confirm each works: clicking the `×`, pressing `Escape`, and clicking the backdrop outside the panel. Confirm clicking *inside* the panel does not close it.
- As admin/office, repeat the same checks for the Email modal, including "Simulate Incoming Reply".
- Confirm the rest of the page (tabs, right-side Diary panel) is unaffected by opening/closing a modal.

- [x] **Step 4: Commit**

```bash
git add src/pages/JobDetail.jsx src/index.css
git commit -m "feat: convert Email/SMS into header-triggered modals"
```
