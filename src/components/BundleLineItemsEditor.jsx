import { useActiveMaterials } from '../hooks/useActiveMaterials'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

let nextKey = 0
function newKey() {
  nextKey += 1
  return `new-${nextKey}`
}

export default function BundleLineItemsEditor({ items, onItemsChange }) {
  const { materials, loading, error } = useActiveMaterials()

  function handleAddLine(e) {
    const materialId = e.target.value
    if (!materialId) return
    const material = materials.find((m) => m.id === materialId)
    if (!material) return
    onItemsChange([
      ...items,
      {
        _key: newKey(),
        id: null,
        materials_catalog_id: material.id,
        item_number: material.item_number,
        description: material.description,
        purchase_cost: material.purchase_cost,
        default_qty: 0,
        default_markup_pct: 0,
      },
    ])
    e.target.value = ''
  }

  function handleRemoveLine(key) {
    onItemsChange(items.filter((item) => item._key !== key))
  }

  function handleFieldChange(key, field, value) {
    onItemsChange(items.map((item) => (item._key === key ? { ...item, [field]: value } : item)))
  }

  if (loading) return <p>Loading materials...</p>
  if (error) return <p role="alert">Could not load materials: {error.message}</p>

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Markup %</th>
            <th>Price (inc. GST)</th>
            <th>Total (inc. GST)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const costIncGst = item.purchase_cost ?? 0
            const priceIncGst = calcPriceIncGst(costIncGst, item.default_markup_pct)
            const totalIncGst = calcTotalIncGst(costIncGst, item.default_markup_pct, item.default_qty)
            return (
              <tr key={item._key}>
                <td>{item.item_number || '—'}</td>
                <td>{item.description}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.default_qty}
                    onChange={(e) => handleFieldChange(item._key, 'default_qty', Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.default_markup_pct}
                    onChange={(e) =>
                      handleFieldChange(item._key, 'default_markup_pct', Number(e.target.value))
                    }
                  />
                </td>
                <td>${priceIncGst.toFixed(2)}</td>
                <td>${totalIncGst.toFixed(2)}</td>
                <td>
                  <button type="button" onClick={() => handleRemoveLine(item._key)}>
                    Remove
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">Totals</td>
            <td colSpan="2">
              Cost: ${totalCost.toFixed(2)} · Markup: ${totalMarkupDollar.toFixed(2)} (
              {totalMarkupPct.toFixed(1)}%) · Price: ${totalPrice.toFixed(2)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <label>
        Add line
        <select defaultValue="" onChange={handleAddLine}>
          <option value="" disabled>
            Select a material...
          </option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.item_number ? `${material.item_number} — ` : ''}
              {material.description}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
