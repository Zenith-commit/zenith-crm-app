import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function ClientSiteInfoSection({ job, isStaff, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [clientError, setClientError] = useState(null)
  const [jobError, setJobError] = useState(null)

  function startEdit() {
    setPhone(job.clientPhone ?? '')
    setEmail(job.clientEmail ?? '')
    setSiteAddress(job.site_address ?? '')
    setClientError(null)
    setJobError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setClientError(null)
    setJobError(null)
  }

  function copyClientAddress() {
    setSiteAddress(job.clientAddress ?? '')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setClientError(null)
    setJobError(null)

    const [{ error: clientErr }, { error: jobErr }] = await Promise.all([
      supabase
        .from('clients')
        .update({ phone: phone || null, email: email || null })
        .eq('id', job.client_id),
      supabase.from('jobs').update({ site_address: siteAddress || null }).eq('id', job.id),
    ])

    setSaving(false)
    setClientError(clientErr?.message ?? null)
    setJobError(jobErr?.message ?? null)

    if (!clientErr && !jobErr) {
      setEditing(false)
      await onSaved()
    }
  }

  if (isStaff && editing) {
    return (
      <section>
        <h2>Client &amp; Site Info</h2>
        <form onSubmit={handleSave}>
          <p>Client: {job.clientName}</p>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Site Address
            <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
          </label>
          <button type="button" onClick={copyClientAddress} disabled={!job.clientAddress}>
            Copy from Client Address
          </button>
          {clientError && <p role="alert">Contact info failed to save: {clientError}</p>}
          {jobError && <p role="alert">Site address failed to save: {jobError}</p>}
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={cancelEdit}>
            Cancel
          </button>
        </form>
      </section>
    )
  }

  return (
    <section>
      <h2>Client &amp; Site Info</h2>
      <p>
        Client: <Link to={`/clients/${job.client_id}`}>{job.clientName}</Link>
      </p>
      <p>Phone: {job.clientPhone || '—'}</p>
      <p>Email: {job.clientEmail || '—'}</p>
      <p>Site Address: {job.site_address || '—'}</p>
      {isStaff && (
        <button className="btn-primary" onClick={startEdit}>
          Edit Contact &amp; Site Info
        </button>
      )}
    </section>
  )
}
