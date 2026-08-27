import { useState } from 'react'

export default function CreateInvoiceForm({ lineItems, onCreate }) {
  const [selectedIds, setSelectedIds] = useState([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  function toggle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.length === 0) return
    setCreating(true)
    setError(null)
    const { error } = await onCreate(selectedIds)
    setCreating(false)
    if (error) {
      setError(error.message)
      return
    }
    setSelectedIds([])
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Create Invoice</h3>
      {lineItems.length === 0 && <p>No line items on this job yet.</p>}
      <ul>
        {lineItems.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
              {item.item_name_snapshot} — Qty {item.qty} — ${item.total_inc_gst.toFixed(2)}
            </label>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={selectedIds.length === 0 || creating}>
        {creating ? 'Creating...' : 'Create Invoice'}
      </button>
    </form>
  )
}
