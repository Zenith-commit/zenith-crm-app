import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

export default function BundleDetail() {
  const { id } = useParams()
  const [bundle, setBundle] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('bundles').select('id, item_number, name, description, active').eq('id', id).single(),
      supabase
        .from('bundle_items')
        .select(
          'id, default_qty, default_markup_pct, materials_catalog:materials_catalog_id (id, item_number, description, purchase_cost)'
        )
        .eq('bundle_id', id)
        .order('created_at'),
    ]).then(([bundleResult, itemsResult]) => {
      if (cancelled) return
      if (bundleResult.error) {
        setError(bundleResult.error)
        setLoading(false)
        return
      }
      if (itemsResult.error) {
        setError(itemsResult.error)
        setLoading(false)
        return
      }
      setBundle(bundleResult.data)
      setItems(
        itemsResult.data.map((row) => ({
          _key: row.id,
          id: row.id,
          materials_catalog_id: row.materials_catalog.id,
          item_number: row.materials_catalog.item_number,
          description: row.materials_catalog.description,
          purchase_cost: row.materials_catalog.purchase_cost,
          default_qty: row.default_qty,
          default_markup_pct: row.default_markup_pct,
        }))
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundle: {error.message}</p>
  if (!bundle) return <p>Bundle not found.</p>

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <h1>{bundle.name}</h1>
      <p>Item Number: {bundle.item_number || '—'}</p>
      <p>Description: {bundle.description || '—'}</p>
      <p>Status: {bundle.active ? 'Active' : 'Archived'}</p>
      <h2>Line Items</h2>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Markup %</th>
            <th>Price (inc. GST)</th>
            <th>Total (inc. GST)</th>
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
                <td>{item.default_qty}</td>
                <td>{item.default_markup_pct}</td>
                <td>${priceIncGst.toFixed(2)}</td>
                <td>${totalIncGst.toFixed(2)}</td>
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
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
