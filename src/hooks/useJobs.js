import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobs(role) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!role) return

    let cancelled = false
    setLoading(true)

    async function load() {
      if (role === 'technician') {
        const [{ data: jobRows, error: jobsError }, { data: clientRows, error: clientsError }] =
          await Promise.all([
            supabase.rpc('get_my_jobs'),
            supabase.from('clients').select('id, name'),
          ])

        if (cancelled) return
        if (jobsError || clientsError) {
          setError(jobsError ?? clientsError)
          setLoading(false)
          return
        }

        const clientNames = Object.fromEntries(clientRows.map((c) => [c.id, c.name]))
        setJobs(
          jobRows.map((job) => ({
            ...job,
            clientName: clientNames[job.client_id] ?? 'Unknown client',
            assignedName: null,
          }))
        )
        setLoading(false)
        return
      }

      const { data, error: jobsError } = await supabase
        .from('jobs')
        .select(
          'id, job_number, status, description, site_address, client_id, assigned_to, queue_id, created_at, updated_at, clients(name), assigned:users!jobs_assigned_to_fkey(full_name), queues(name)'
        )
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (jobsError) {
        setError(jobsError)
        setLoading(false)
        return
      }

      setJobs(
        data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
          assignedName: job.assigned?.full_name ?? 'Unassigned',
          queueName: job.queues?.name ?? 'Unqueued',
        }))
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [role])

  return { jobs, loading, error }
}
