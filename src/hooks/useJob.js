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
        .select('name, phone, email, address')
        .eq('id', found.client_id)
        .single()

      setJob({
        ...found,
        clientName: client?.name ?? 'Unknown client',
        clientPhone: client?.phone ?? null,
        clientEmail: client?.email ?? null,
        clientAddress: client?.address ?? null,
        assignedName: null,
        invoiced: null,
      })
      setLoading(false)
      return
    }

    const { data, error: jobError } = await supabase
      .from('jobs')
      .select(
        'id, status, description, invoiced, client_id, assigned_to, site_address, created_at, updated_at, clients(name, phone, email, address), assigned:users!jobs_assigned_to_fkey(full_name)'
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
        clientPhone: data.clients?.phone ?? null,
        clientEmail: data.clients?.email ?? null,
        clientAddress: data.clients?.address ?? null,
        assignedName: data.assigned?.full_name ?? 'Unassigned',
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
