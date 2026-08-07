import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJob(jobId, role) {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (role === 'technician') {
      const { data: jobRows, error: jobsError } = await supabase.rpc('get_my_jobs')
      const found = jobRows?.find((row) => row.id === jobId)

      if (jobsError || !found) {
        setError(jobsError ?? new Error('Job not found'))
        setJob(null)
        setLoading(false)
        return
      }

      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('id', found.client_id)
        .single()

      setJob({
        ...found,
        clientName: client?.name ?? 'Unknown client',
        assignedName: null,
        quotedPrice: null,
        invoiced: null,
      })
      setLoading(false)
      return
    }

    const { data, error: jobError } = await supabase
      .from('jobs')
      .select(
        'id, status, job_type, description, quoted_price, invoiced, client_id, assigned_to, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name)'
      )
      .eq('id', jobId)
      .single()

    if (jobError) {
      setError(jobError)
      setJob(null)
    } else {
      setJob({
        ...data,
        clientName: data.clients?.name ?? 'Unknown client',
        assignedName: data.assigned?.full_name ?? 'Unassigned',
        quotedPrice: data.quoted_price,
      })
    }
    setLoading(false)
  }, [jobId, role])

  useEffect(() => {
    if (!role) return
    reload()
  }, [reload, role])

  return { job, loading, error, reload }
}
