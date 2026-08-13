import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClients } from '../hooks/useClients'
import { JOB_STATUSES } from '../lib/jobConstants'

export default function JobForm({ initialValues, onSubmit, submitLabel }) {
  const { clients } = useClients()
  const [technicians, setTechnicians] = useState([])
  const [values, setValues] = useState({
    client_id: initialValues?.client_id ?? '',
    status: initialValues?.status ?? 'Quote',
    assigned_to: initialValues?.assigned_to ?? '',
    description: initialValues?.description ?? '',
    site_address: initialValues?.site_address ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name')
      .eq('role', 'technician')
      .order('full_name')
      .then(({ data }) => setTechnicians(data ?? []))
  }, [])

  function updateField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await onSubmit({
      client_id: values.client_id,
      status: values.status,
      assigned_to: values.assigned_to || null,
      description: values.description,
      site_address: values.site_address,
    })
    setSaving(false)
    if (error) setError(error.message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Client
        <select
          value={values.client_id}
          onChange={(e) => updateField('client_id', e.target.value)}
          required
        >
          <option value="">Select a client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={values.status} onChange={(e) => updateField('status', e.target.value)}>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        Assigned Technician
        <select
          value={values.assigned_to}
          onChange={(e) => updateField('assigned_to', e.target.value)}
        >
          <option value="">Unassigned</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>{tech.full_name}</option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </label>
      <label>
        Site Address
        <input
          value={values.site_address}
          onChange={(e) => updateField('site_address', e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
