# Staff Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any staff member (admin/office/technician) submit free-text feedback with optional photos via a persistent nav icon, viewable only by admin in a dedicated inbox page.

**Architecture:** A new `feedback` table + `feedback-photos` storage bucket, both RLS-gated so office and technician can insert only their own self-attributed row (no select at all), while admin retains the standard unrestricted `for all` policy. Two independent frontend surfaces consume this: `FeedbackIcon` (compose-only dropdown, all roles, mounted beside `NotificationBell`) and `FeedbackInbox` (read-only list page, admin-only route).

**Tech Stack:** React + Vite, Supabase (Postgres RLS + Storage), no automated JS test framework exists in this repo — verification follows this project's established pattern of live RLS checks run manually in the Supabase SQL Editor, plus manual browser verification for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-02-staff-feedback-design.md`

## Global Constraints

- No category/type column — `feedback.message` is a single free-text field.
- `submitted_by = auth.uid()` is enforced on every insert policy except admin's (admin keeps the standard unrestricted `for all`, matching every other admin policy in this codebase).
- Office and technician get **no select policy at all** on `feedback` or on the `feedback-photos` bucket — this is a deliberate exception to the usual admin/office pairing, not a gap.
- Storage path convention: `<user_id>/<timestamp>-<sanitized_filename>` (mirrors `diary-photos`' `<job_id>/...` convention).
- No route guards exist anywhere in this app (confirmed: `App.jsx` has none, every page only conditionally hides UI by role and relies on RLS to keep data empty) — do not introduce one for `/feedback`.
- Photo preview in the compose form is 100% client-side (`URL.createObjectURL`/`URL.revokeObjectURL`) — it must never call Supabase storage to render a preview.
- This project has no Supabase CLI/service-role access configured in this environment — every SQL file must be run by the human via the Supabase Dashboard SQL Editor, not executed directly by the agent.

---

### Task 1: `feedback` table + RLS

**Files:**
- Create: `supabase/schema/014_feedback.sql`
- Create: `supabase/policies/017_feedback_policies.sql`

**Interfaces:**
- Produces: table `public.feedback(id uuid, submitted_by uuid, message text, photo_paths text[], created_at timestamptz)`, consumed by Task 3 (`useFeedback` insert) and Task 4 (`useFeedbackInbox` select).

- [ ] **Step 1: Write the schema file**

```sql
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.users(id),
  message text not null,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.feedback is 'Free-text suggestions/feedback submitted by any staff member about the CRM or the company.';
```

- [ ] **Step 2: Write the RLS policy file**

```sql
alter table public.feedback enable row level security;

create policy "feedback_admin_all" on public.feedback
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "feedback_office_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'office'
    and submitted_by = auth.uid()
  );

create policy "feedback_technician_insert" on public.feedback
  for insert
  with check (
    public.current_app_role() = 'technician'
    and submitted_by = auth.uid()
  );
```

- [ ] **Step 3: Run both files against the live Supabase project**

Ask the user to open the Supabase Dashboard SQL Editor and run the contents of `supabase/schema/014_feedback.sql` followed by `supabase/policies/017_feedback_policies.sql`, then confirm both ran with no errors.

- [ ] **Step 4: Look up the three test-account UUIDs**

Ask the user to run this in the SQL Editor and report back the three ids:

```sql
select id, role from public.users where role in ('admin', 'office', 'technician');
```

- [ ] **Step 5: Run the live RLS verification block**

Substitute the real UUIDs from Step 4 in place of `<ADMIN_ID>`, `<OFFICE_ID>`, `<TECH_ID>` below, then ask the user to run the whole block (it runs inside an explicit transaction and rolls back at the end, so no test rows are left behind):

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
begin
  insert into public.feedback (submitted_by, message) values ('<ADMIN_ID>', 'admin test');
  if (select count(*) from public.feedback) = 0 then
    raise exception 'admin should see feedback rows';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
begin
  insert into public.feedback (submitted_by, message) values ('<OFFICE_ID>', 'office test');

  begin
    insert into public.feedback (submitted_by, message) values ('<ADMIN_ID>', 'spoof attempt');
    raise exception 'office should not be able to spoof submitted_by';
  exception when insufficient_privilege then
    null; -- expected: RLS blocked the spoofed insert
  end;

  if (select count(*) from public.feedback) <> 0 then
    raise exception 'office should see zero feedback rows, RLS is leaking';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<TECH_ID>"}';

do $$
begin
  insert into public.feedback (submitted_by, message) values ('<TECH_ID>', 'tech test');

  begin
    insert into public.feedback (submitted_by, message) values ('<ADMIN_ID>', 'spoof attempt');
    raise exception 'technician should not be able to spoof submitted_by';
  exception when insufficient_privilege then
    null; -- expected
  end;

  if (select count(*) from public.feedback) <> 0 then
    raise exception 'technician should see zero feedback rows, RLS is leaking';
  end if;

  raise notice 'All feedback RLS checks passed.';
end $$;

rollback;
```

Expected: the block completes with a `NOTICE: All feedback RLS checks passed.` and no `ERROR`. If any `raise exception` fires, stop and fix the corresponding policy before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema/014_feedback.sql supabase/policies/017_feedback_policies.sql
git commit -m "feat: add feedback table and RLS policies"
```

---

### Task 2: `feedback-photos` storage bucket + RLS

**Files:**
- Create: `supabase/storage/002_feedback_photos.sql`

**Interfaces:**
- Consumes: `public.current_app_role()` from `supabase/policies/001_helper_function.sql` (already live).
- Produces: bucket `feedback-photos`, consumed by Task 3 (`useFeedback` upload) and Task 4 (`useFeedbackInbox` signed URL resolution).

- [ ] **Step 1: Write the storage bucket + policy file**

```sql
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

create policy "feedback_photos_admin_all" on storage.objects
  for all
  using (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  )
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'admin'
  );

create policy "feedback_photos_office_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'office'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "feedback_photos_technician_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'feedback-photos'
    and public.current_app_role() = 'technician'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Run the file against the live Supabase project**

Ask the user to run `supabase/storage/002_feedback_photos.sql` in the SQL Editor and confirm no errors.

- [ ] **Step 3: Run the live storage RLS verification block**

Reuse the same three UUIDs from Task 1 Step 4. This directly inserts test rows into `storage.objects` (sufficient to test the RLS predicate — no real file bytes are needed to verify policy behavior) inside a transaction that rolls back:

```sql
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<OFFICE_ID>"}';

do $$
begin
  -- office can insert into their own folder
  insert into storage.objects (bucket_id, name) values ('feedback-photos', '<OFFICE_ID>/test.jpg');

  -- office cannot insert into someone else's folder
  begin
    insert into storage.objects (bucket_id, name) values ('feedback-photos', '<TECH_ID>/test.jpg');
    raise exception 'office should not be able to upload into another user''s folder';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- office cannot read anything back
  if (select count(*) from storage.objects where bucket_id = 'feedback-photos') <> 0 then
    raise exception 'office should see zero objects in feedback-photos';
  end if;
end $$;

set local request.jwt.claims to '{"sub": "<ADMIN_ID>"}';

do $$
begin
  -- admin can insert anywhere and read everything
  insert into storage.objects (bucket_id, name) values ('feedback-photos', '<ADMIN_ID>/test.jpg');
  if (select count(*) from storage.objects where bucket_id = 'feedback-photos') = 0 then
    raise exception 'admin should see objects in feedback-photos';
  end if;

  raise notice 'All feedback-photos storage RLS checks passed.';
end $$;

rollback;
```

Expected: completes with `NOTICE: All feedback-photos storage RLS checks passed.` and no `ERROR`.

- [ ] **Step 4: Commit**

```bash
git add supabase/storage/002_feedback_photos.sql
git commit -m "feat: add feedback-photos storage bucket and RLS policies"
```

---

### Task 3: Compose feature — `useFeedback` hook + `FeedbackIcon`

**Files:**
- Create: `src/hooks/useFeedback.js`
- Create: `src/components/FeedbackIcon.jsx`
- Modify: `src/components/AppShell.jsx`

**Interfaces:**
- Consumes: `supabase` client from `src/lib/supabaseClient.js`; the live `feedback` table and `feedback-photos` bucket from Tasks 1–2.
- Produces: `useFeedback()` returning `{ submit({ message, photoFiles }) }` where `submit` returns `{ error }` (error is `null` on success) — not consumed by any other task, but keep this exact shape since Task 4 mirrors the hook-splitting convention.

- [ ] **Step 1: Write `useFeedback.js`**

```js
import { supabase } from '../lib/supabaseClient'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export function useFeedback() {
  async function submit({ message, photoFiles }) {
    const { data: { user } } = await supabase.auth.getUser()
    const photoPaths = []

    for (const file of photoFiles) {
      const path = `${user.id}/${Date.now()}-${sanitizeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('feedback-photos')
        .upload(path, file)
      if (uploadError) return { error: uploadError }
      photoPaths.push(path)
    }

    const { error: insertError } = await supabase.from('feedback').insert({
      submitted_by: user.id,
      message,
      photo_paths: photoPaths,
    })

    if (insertError) return { error: insertError }
    return { error: null }
  }

  return { submit }
}
```

- [ ] **Step 2: Write `FeedbackIcon.jsx`**

```jsx
import { useState } from 'react'
import { useFeedback } from '../hooks/useFeedback'

export default function FeedbackIcon() {
  const { submit } = useFeedback()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [photoFiles, setPhotoFiles] = useState([])
  const [previewUrls, setPreviewUrls] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleFilesChange(e) {
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    const files = Array.from(e.target.files)
    setPhotoFiles(files)
    setPreviewUrls(files.map((file) => URL.createObjectURL(file)))
  }

  function resetForm() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    setMessage('')
    setPhotoFiles([])
    setPreviewUrls([])
    setError(null)
  }

  function handleToggle() {
    if (open) resetForm()
    setOpen((prev) => !prev)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await submit({ message, photoFiles })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    resetForm()
    setOpen(false)
  }

  return (
    <div className="feedback-icon">
      <button onClick={handleToggle}>💬</button>
      {open && (
        <div className="feedback-dropdown">
          <form onSubmit={handleSubmit}>
            <label>
              Feedback
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required />
            </label>
            <label>
              Photos (optional)
              <input type="file" accept="image/*" multiple onChange={handleFilesChange} />
            </label>
            {previewUrls.map((url) => (
              <img
                key={url}
                src={url}
                alt="Selected attachment preview"
                style={{ maxWidth: 100, display: 'inline-block', marginRight: 4 }}
              />
            ))}
            {error && <p role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Sending...' : 'Send Feedback'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount `FeedbackIcon` in `AppShell.jsx`**

In `src/components/AppShell.jsx`, add the import:

```js
import FeedbackIcon from './FeedbackIcon'
```

And add `<FeedbackIcon />` inside the `.app-nav-user` div, next to `NotificationBell`:

```jsx
        <div className="app-nav-user">
          {profile?.role && <NotificationBell role={profile.role} />}
          <FeedbackIcon />
          {profile ? (
```

- [ ] **Step 4: Manually verify in the browser**

Start the dev server (`npm run dev`), sign in as each of the three test accounts (admin, office, technician) in turn, and for each: click the 💬 icon, confirm the compose dropdown opens with no history list, select a photo and confirm a preview thumbnail appears immediately, remove/change the selection and confirm the preview updates, then submit with and without a photo. After each submission, confirm success (dropdown closes, form clears) and use the Supabase Dashboard (Table Editor on `public.feedback`, and Storage on `feedback-photos`) to confirm the row and any uploaded file landed with the correct `submitted_by`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFeedback.js src/components/FeedbackIcon.jsx src/components/AppShell.jsx
git commit -m "feat: add feedback compose icon for all roles"
```

---

### Task 4: Admin inbox — `useFeedbackInbox` hook + `FeedbackInbox` page

**Files:**
- Create: `src/hooks/useFeedbackInbox.js`
- Create: `src/pages/FeedbackInbox.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/AppShell.jsx`

**Interfaces:**
- Consumes: the live `feedback` table (Task 1) and `feedback-photos` bucket (Task 2); `useOutletContext()` → `{ profile }` pattern already used by every other page (e.g. `src/pages/ClientList.jsx`).
- Produces: nothing consumed elsewhere — this is the final task.

- [ ] **Step 1: Write `useFeedbackInbox.js`**

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useFeedbackInbox() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [photoUrls, setPhotoUrls] = useState({})

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('feedback')
      .select('id, message, photo_paths, created_at, submitted_by, users!feedback_submitted_by_fkey(full_name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error)
      setLoading(false)
      return
    }

    setEntries(
      data.map((row) => ({
        ...row,
        submitterName: row.users?.full_name ?? 'Unknown',
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const allPaths = entries.flatMap((entry) => entry.photo_paths)
    const missingPaths = allPaths.filter((path) => !photoUrls[path])
    if (missingPaths.length === 0) return

    let cancelled = false
    Promise.all(
      missingPaths.map((path) =>
        supabase.storage
          .from('feedback-photos')
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

  return { entries, loading, error, photoUrls }
}
```

- [ ] **Step 2: Write `FeedbackInbox.jsx`**

```jsx
import { useFeedbackInbox } from '../hooks/useFeedbackInbox'

export default function FeedbackInbox() {
  const { entries, loading, error, photoUrls } = useFeedbackInbox()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load feedback: {error.message}</p>

  return (
    <div>
      <h1>Feedback Inbox</h1>
      {entries.length === 0 ? (
        <p>No feedback submitted yet.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <p>{new Date(entry.created_at).toLocaleString()} — {entry.submitterName}</p>
              <p>{entry.message}</p>
              {entry.photo_paths.map((path) =>
                photoUrls[path] ? (
                  <img
                    key={path}
                    src={photoUrls[path]}
                    alt="Feedback attachment"
                    style={{ maxWidth: 200, display: 'block' }}
                  />
                ) : (
                  <p key={path}>Loading photo...</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the route in `App.jsx`**

Add the import:

```js
import FeedbackInbox from './pages/FeedbackInbox'
```

Add the route inside `<Route element={<AppShell />}>`, alongside the other routes:

```jsx
        <Route path="/feedback" element={<FeedbackInbox />} />
```

- [ ] **Step 4: Add the admin-only nav link in `AppShell.jsx`**

In the `<nav className="app-nav-links">` block, add (unconditional links first, this one last alongside the existing role-conditional links):

```jsx
          {profile?.role === 'admin' && <Link to="/feedback">Feedback Inbox</Link>}
```

- [ ] **Step 5: Manually verify in the browser**

Using the feedback submitted in Task 3 Step 4 (plus a couple of fresh submissions if needed), sign in as admin and confirm: the "Feedback Inbox" link appears in the nav, `/feedback` lists all submissions newest-first with the correct submitter name and any attached photo rendered via signed URL. Sign in as office and technician and confirm the "Feedback Inbox" link does **not** appear in the nav for either; then navigate directly to `/feedback` as each and confirm the page renders an empty "No feedback submitted yet." list rather than an error (RLS returns zero rows, no route guard).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useFeedbackInbox.js src/pages/FeedbackInbox.jsx src/App.jsx src/components/AppShell.jsx
git commit -m "feat: add admin-only feedback inbox page"
```
