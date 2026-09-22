import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useTechnicians() {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data, error: loadError } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('role', 'technician')
          .order('full_name', { ascending: true })
        if (cancelled) return
        if (loadError) setError(loadError)
        else setTechnicians(data)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { technicians, loading, error }
}
