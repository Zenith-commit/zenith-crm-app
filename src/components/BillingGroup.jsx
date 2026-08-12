import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function BillingGroup({ title, items, isStaff, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [editQty, setEditQty] = useState('')
  const [editMarkup, setEditMarkup] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const groupTotal = isStaff ? items.reduce((sum, item) => sum + (item.total_inc_gst ?? 0), 0) : null

  function startEdit(item) {
    setEditingId(item.id)
    setEditQty(item.qty)
    setEditMarkup(item.markup_pct)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('job_line_items')
      .update({ qty: Number(editQty), markup_pct: Number(editMarkup) })
      .eq('id', editingId)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingId(null)
    await onChanged()
  }

  return (
    <details open>
      <summary>
        {title}
        {isStaff && ` — $${groupTotal.toFixed(2)}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            {isStaff && <th>Markup %</th>}
            {isStaff && <th>Price (inc. GST)</th>}
            {isStaff && <th>Total (inc. GST)</th>}
            {isStaff && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) =>
            editingId === item.id ? (
              <tr key={item.id}>
                <td colSpan={isStaff ? 6 : 2}>
                  <form onSubmit={handleSaveEdit}>
                    <label>
                      Qty
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                      />
                    </label>
                    <label>
                      Markup %
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editMarkup}
                        onChange={(e) => setEditMarkup(e.target.value)}
                      />
                    </label>
                    {error && <p role="alert">{error}</p>}
                    <button className="btn-primary" type="submit" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={item.id}>
                <td>{item.item_name_snapshot}</td>
                <td>{item.qty}</td>
                {isStaff && <td>{item.markup_pct}</td>}
                {isStaff && <td>${item.price_inc_gst.toFixed(2)}</td>}
                {isStaff && <td>${item.total_inc_gst.toFixed(2)}</td>}
                {isStaff && (
                  <td>
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            )
          )}
        </tbody>
      </table>
    </details>
  )
}
