import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst } from '../lib/bundleCalc'
import MaterialPicker from './MaterialPicker'

export default function AddOneOffLineItemForm({ jobId, onAdded }) {
  const { materials } = useActiveMaterials()
  const [mode, setMode] = useState('catalog')
  const [selectedMaterial, setSelectedMaterial] = useState(null)
  const [customName, setCustomName] = useState('')
  const [customCost, setCustomCost] = useState('')
  const [qty, setQty] = useState(1)
  const [markupPct, setMarkupPct] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const costIncGst = mode === 'custom' ? Number(customCost) || 0 : selectedMaterial?.purchase_cost ?? 0
  const priceIncGst = calcPriceIncGst(costIncGst, Number(markupPct) || 0)
  const totalIncGst = calcTotalIncGst(costIncGst, Number(markupPct) || 0, Number(qty) || 0)
  const canSubmit = mode === 'custom' ? customName.trim() !== '' : !!selectedMaterial

  function toggleMode() {
    setMode((prev) => (prev === 'catalog' ? 'custom' : 'catalog'))
    setSelectedMaterial(null)
    setCustomName('')
    setCustomCost('')
    setError(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('job_line_items').insert(
      mode === 'custom'
        ? {
            job_id: jobId,
            materials_catalog_id: null,
            item_code_snapshot: null,
            item_name_snapshot: customName.trim(),
            qty: Number(qty),
            cost_inc_gst_snapshot: costIncGst,
            markup_pct: Number(markupPct),
          }
        : {
            job_id: jobId,
            materials_catalog_id: selectedMaterial.id,
            item_code_snapshot: selectedMaterial.item_number,
            item_name_snapshot: selectedMaterial.description,
            qty: Number(qty),
            cost_inc_gst_snapshot: costIncGst,
            markup_pct: Number(markupPct),
          }
    )
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSelectedMaterial(null)
    setCustomName('')
    setCustomCost('')
    setQty(1)
    setMarkupPct(0)
    await onAdded()
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Add One-off Item</h3>
      <button type="button" onClick={toggleMode}>
        {mode === 'catalog' ? 'Add Custom Item' : 'Pick from Catalog Instead'}
      </button>
      {mode === 'custom' ? (
        <>
          <label>
            Item Name
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} />
          </label>
          <label>
            Cost (inc. GST)
            <input
              type="number"
              step="0.01"
              min="0"
              value={customCost}
              onChange={(e) => setCustomCost(e.target.value)}
            />
          </label>
        </>
      ) : (
        <label>
          Material
          <MaterialPicker
            materials={materials}
            onSelect={setSelectedMaterial}
            selectedLabel={selectedMaterial?.description ?? ''}
            placeholder="Search materials..."
          />
        </label>
      )}
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
      {canSubmit && (
        <p>
          Preview: Price ${priceIncGst.toFixed(2)} · Total ${totalIncGst.toFixed(2)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={!canSubmit || saving}>
        {saving ? 'Adding...' : 'Add Item'}
      </button>
    </form>
  )
}
