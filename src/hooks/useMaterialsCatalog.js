import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useMaterialsCatalog() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, item_type, price, purchase_cost, tax_rate, price_includes_tax, active')
      .eq('active', true)
      .order('description')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setItems(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { items, loading, error }
}
