import { useState } from 'react'
import { useJobContact } from '../hooks/useJobContact'

export default function JobContactSection({ jobId, isStaff, userId }) {
  const { contact, loading, error, save, clear } = useJobContact(jobId, userId)
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
