import { useState } from 'react'

export default function CatalogForm({ initialValues, onSubmit, submitLabel }) {
  const [values, setValues] = useState({
    item_number: initialValues?.item_number ?? '',
    description: initialValues?.description ?? '',
    item_type: initialValues?.item_type ?? 'material',
    price: initialValues?.price ?? '',
    purchase_cost: initialValues?.purchase_cost ?? '',
    tax_rate: initialValues?.tax_rate ?? '10.00',
    price_includes_tax: initialValues?.price_includes_tax ?? false,
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
    const { error } = await onSubmit({
      item_number: values.item_number || null,
      description: values.description,
      item_type: values.item_type,
      price: Number(values.price),
      purchase_cost: values.purchase_cost === '' ? null : Number(values.purchase_cost),
      tax_rate: Number(values.tax_rate),
      price_includes_tax: values.price_includes_tax,
    })
    setSaving(false)
    if (error) setError(error.message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Item Number
        <input value={values.item_number} onChange={(e) => updateField('item_number', e.target.value)} />
      </label>
      <label>
        Description
        <input
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
          required
        />
      </label>
      <label>
        Type
        <select value={values.item_type} onChange={(e) => updateField('item_type', e.target.value)}>
          <option value="material">Material</option>
          <option value="service">Service</option>
        </select>
      </label>
      <label>
        Price
        <input
          type="number"
          step="0.01"
          value={values.price}
          onChange={(e) => updateField('price', e.target.value)}
          required
        />
      </label>
      <label>
        Purchase Cost
        <input
          type="number"
          step="0.01"
          value={values.purchase_cost}
          onChange={(e) => updateField('purchase_cost', e.target.value)}
        />
      </label>
      <label>
        Tax Rate (%)
        <input
          type="number"
          step="0.01"
          value={values.tax_rate}
          onChange={(e) => updateField('tax_rate', e.target.value)}
          required
        />
      </label>
      <label>
        Price Includes Tax
        <select
          value={values.price_includes_tax ? 'true' : 'false'}
          onChange={(e) => updateField('price_includes_tax', e.target.value === 'true')}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}
