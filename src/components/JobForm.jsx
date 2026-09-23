import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClients } from '../hooks/useClients'
import { JOB_STATUSES } from '../lib/jobConstants'

export default function JobForm({ initialValues, onSubmit, submitLabel }) {
  const { clients } = useClients()
  const [values, setValues] = useState({
    client_id: initialValues?.client_id ?? '',
    status: initialValues?.status ?? 'Quote',
    description: initialValues?.description ?? '',
    site_address: initialValues?.site_address ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [knownAddresses, setKnownAddresses] = useState([])
  const [addressChoice, setAddressChoice] = useState('__new__')

  useEffect(() => {
    if (!values.client_id) {
      setKnownAddresses([])
      setAddressChoice('__new__')
      return
    }

    let cancelled = false
    supabase
      .from('jobs')
      .select('site_address')
      .eq('client_id', values.client_id)
      .not('site_address', 'is', null)
      .neq('site_address', '')
      .then(({ data }) => {
        if (cancelled) return
        const client = clients.find((c) => c.id === values.client_id)
        const combined = new Set((data ?? []).map((row) => row.site_address))
        if (client?.address) combined.add(client.address)
        const sorted = [...combined].sort()
        setKnownAddresses(sorted)

        if (initialValues?.site_address && sorted.includes(initialValues.site_address)) {
          setAddressChoice(initialValues.site_address)
          updateField('site_address', initialValues.site_address)
        } else if (sorted.length === 1) {
          setAddressChoice(sorted[0])
          updateField('site_address', sorted[0])
        } else {
          setAddressChoice('__new__')
          updateField('site_address', initialValues?.site_address ?? '')
        }
      })

    return () => {
      cancelled = true
    }
  }, [values.client_id, clients, initialValues])

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
        Description
        <textarea
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </label>
      <label>
        Site Address
        {knownAddresses.length === 0 ? (
          <input
            value={values.site_address}
            onChange={(e) => updateField('site_address', e.target.value)}
          />
        ) : (
          <select
            value={addressChoice}
            onChange={(e) => {
              const choice = e.target.value
              setAddressChoice(choice)
              updateField('site_address', choice === '__new__' ? '' : choice)
            }}
          >
            {knownAddresses.map((address) => (
              <option key={address} value={address}>{address}</option>
            ))}
            <option value="__new__">Add new address</option>
          </select>
        )}
      </label>
      {addressChoice === '__new__' && knownAddresses.length > 0 && (
        <label>
          New Address
          <input
            value={values.site_address}
            onChange={(e) => updateField('site_address', e.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
