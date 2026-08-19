import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'
import { calcPriceIncGst, calcTotalIncGst, calcBundleTotals } from '../lib/bundleCalc'

export default function BundleDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const navigate = useNavigate()
  const [bundle, setBundle] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

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

  async function handleUpdate({ name, item_number, description, items: submittedItems }) {
    const { error: bundleError } = await supabase
      .from('bundles')
      .update({ name, item_number, description })
      .eq('id', id)
    if (bundleError) return { error: bundleError }

    const originalIds = new Set(items.filter((item) => item.id).map((item) => item.id))
    const submittedIds = new Set(submittedItems.filter((item) => item.id).map((item) => item.id))

    const toDelete = [...originalIds].filter((itemId) => !submittedIds.has(itemId))
    const toInsert = submittedItems.filter((item) => !item.id)
    const toUpdate = submittedItems.filter((item) => {
      if (!item.id) return false
      const original = items.find((orig) => orig.id === item.id)
      return (
        original &&
        (original.default_qty !== item.default_qty ||
          original.default_markup_pct !== item.default_markup_pct)
      )
    })

    if (toDelete.length > 0) {
      const { error } = await supabase.from('bundle_items').delete().in('id', toDelete)
      if (error) return { error }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('bundle_items').insert(
        toInsert.map((item) => ({
          bundle_id: id,
          materials_catalog_id: item.materials_catalog_id,
          default_qty: item.default_qty,
          default_markup_pct: item.default_markup_pct,
        }))
      )
      if (error) return { error }
    }

    for (const item of toUpdate) {
      const { error } = await supabase
        .from('bundle_items')
        .update({ default_qty: item.default_qty, default_markup_pct: item.default_markup_pct })
        .eq('id', item.id)
      if (error) return { error }
    }

    setBundle((prev) => ({ ...prev, name, item_number, description }))
    setItems(submittedItems)
    setEditing(false)
    return { error: null }
  }

  async function handleArchive() {
    if (
      !window.confirm('Archive this bundle? It will no longer be offered when applying a bundle to a job.')
    ) {
      return
    }
    setArchiving(true)
    const { error } = await supabase.from('bundles').update({ active: false }).eq('id', id)
    setArchiving(false)
    if (!error) setBundle((prev) => ({ ...prev, active: false }))
  }

  async function handleUnarchive() {
    setArchiving(true)
    const { error } = await supabase.from('bundles').update({ active: true }).eq('id', id)
    setArchiving(false)
    if (!error) setBundle((prev) => ({ ...prev, active: true }))
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Permanently delete "${bundle.name}"? This cannot be undone.`
      )
    ) {
      return
    }
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('bundles').delete().eq('id', id)
    if (error) {
      setDeleting(false)
      setDeleteError(
        error.code === '23503'
          ? "This bundle can't be deleted because it's been applied to one or more jobs. Archive it instead."
          : error.message
      )
      return
    }
    navigate('/bundles')
  }

  if (editing) {
    return (
      <div>
        <h1>Edit {bundle.name}</h1>
        <BundleForm initialValues={{ ...bundle, items }} onSubmit={handleUpdate} submitLabel="Save Changes" />
      </div>
    )
  }

  const { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct } = calcBundleTotals(items)

  return (
    <div>
      <h1>{bundle.name}</h1>
      <p>Item Number: {bundle.item_number || '—'}</p>
      <p>Description: {bundle.description || '—'}</p>
      <p>Status: {bundle.active ? 'Active' : 'Archived'}</p>
      <button className="btn-primary" onClick={() => setEditing(true)}>
        Edit Bundle
      </button>
      {bundle.active ? (
        <button onClick={handleArchive} disabled={archiving}>
          {archiving ? 'Archiving...' : 'Archive'}
        </button>
      ) : (
        (profile?.role === 'admin' || profile?.role === 'office') && (
          <button onClick={handleUnarchive} disabled={archiving}>
            {archiving ? 'Unarchiving...' : 'Unarchive'}
          </button>
        )
      )}
      {profile?.role === 'admin' && (
        <button onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting...' : 'Delete Permanently'}
        </button>
      )}
      {deleteError && <p role="alert">{deleteError}</p>}
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
