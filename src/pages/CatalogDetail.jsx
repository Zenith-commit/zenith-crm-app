import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import CatalogForm from '../components/CatalogForm'

export default function CatalogDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setItem(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load item: {error.message}</p>
  if (!item) return <p>Item not found.</p>

  async function handleUpdate(values) {
    const { error } = await supabase.from('materials_catalog').update(values).eq('id', id)
    if (!error) {
      setItem({ ...item, ...values })
      setEditing(false)
    }
    return { error }
  }

  return (
    <div>
      <h1>{item.description}</h1>
      {editing ? (
        <CatalogForm initialValues={item} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Item Number: {item.item_number || '—'}</p>
          <p>Type: {item.item_type}</p>
          <p>Price: ${item.price}</p>
          <p>Purchase Cost: {item.purchase_cost != null ? `$${item.purchase_cost}` : '—'}</p>
          <p>Tax Rate: {item.tax_rate}%</p>
          <p>Price Includes Tax: {item.price_includes_tax ? 'Yes' : 'No'}</p>
          <button className="btn-primary" onClick={() => setEditing(true)}>
            Edit Item
          </button>
        </div>
      )}
    </div>
  )
}
