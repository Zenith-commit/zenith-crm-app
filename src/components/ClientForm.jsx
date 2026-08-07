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
