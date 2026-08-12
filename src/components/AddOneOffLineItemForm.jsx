import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst } from '../lib/bundleCalc'

export default function AddOneOffLineItemForm({ jobId, onAdded }) {
  const { materials } = useActiveMaterials()
  const [materialId, setMaterialId] = useState('')
  const [qty, setQty] = useState(1)
  const [markupPct, setMarkupPct] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedMaterial = materials.find((m) => m.id === materialId)
  const costIncGst = selectedMaterial?.purchase_cost ?? 0
  const priceIncGst = calcPriceIncGst(costIncGst, Number(markupPct) || 0)
  const totalIncGst = calcTotalIncGst(costIncGst, Number(markupPct) || 0, Number(qty) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedMaterial) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('job_line_items').insert({
      job_id: jobId,
      materials_catalog_id: selectedMaterial.id,
      item_code_snapshot: selectedMaterial.item_number,
      item_name_snapshot: selectedMaterial.description,
      qty: Number(qty),
      cost_inc_gst_snapshot: costIncGst,
      markup_pct: Number(markupPct),
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setMaterialId('')
    setQty(1)
    setMarkupPct(0)
    await onAdded()
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Add One-off Item</h3>
      <label>
        Material
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Select a material...</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>{material.description}</option>
          ))}
        </select>
      </label>
      <label>
        Qty
        <input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <label>
        Markup %
        <input
          type="number"
          step="0.01"
          min="0"
          value={markupPct}
          onChange={(e) => setMarkupPct(e.target.value)}
        />
      </label>
      {selectedMaterial && (
        <p>
          Preview: Price ${priceIncGst.toFixed(2)} · Total ${totalIncGst.toFixed(2)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={!selectedMaterial || saving}>
        {saving ? 'Adding...' : 'Add Item'}
      </button>
    </form>
  )
}
