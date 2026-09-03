import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobContact(jobId, userId) {
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_contacts')
      .select('job_id, first_name, last_name, email, phone, mobile, updated_at')
      .eq('job_id', jobId)
      .maybeSingle()

    if (error) setError(error)
    else setContact(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function save({ first_name, last_name, email, phone, mobile }) {
    const { error } = await supabase.from('job_contacts').upsert({
      job_id: jobId,
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || null,
      phone: phone || null,
      mobile: mobile || null,
      updated_by: userId,
    })

    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function clear() {
    const { error } = await supabase.from('job_contacts').delete().eq('job_id', jobId)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { contact, loading, error, save, clear }
}
