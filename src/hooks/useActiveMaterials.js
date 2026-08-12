import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useActiveMaterials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('materials_catalog')
      .select('id, item_number, description, purchase_cost')
      .eq('active', true)
      .order('description')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setMaterials(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { materials, loading, error }
}
