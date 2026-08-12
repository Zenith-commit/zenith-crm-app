import { useState } from 'react'
import BundleLineItemsEditor from './BundleLineItemsEditor'

export default function BundleForm({ initialValues, onSubmit, submitLabel }) {
  const [values, setValues] = useState({
    name: initialValues?.name ?? '',
    item_number: initialValues?.item_number ?? '',
    description: initialValues?.description ?? '',
  })
  const [items, setItems] = useState(initialValues?.items ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function updateField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await onSubmit({
      name: values.name,
      item_number: values.item_number || null,
      description: values.description || null,
      items,
    })
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
        Item Number
        <input value={values.item_number} onChange={(e) => updateField('item_number', e.target.value)} />
      </label>
      <label>
        Description
        <input value={values.description} onChange={(e) => updateField('description', e.target.value)} />
      </label>
      <h2>Line Items</h2>
      <BundleLineItemsEditor items={items} onItemsChange={setItems} />
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
