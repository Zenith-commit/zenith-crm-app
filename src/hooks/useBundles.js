import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useBundles() {
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('bundles')
      .select('id, item_number, name, active')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setBundles(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { bundles, loading, error }
}
