import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('clients')
      .select('id, name, phone, email, address, notes, created_at')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setClients(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { clients, loading, error }
}
