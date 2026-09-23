import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { deriveAssignedTechnicians, deriveScheduleSummary } from '../lib/jobConstants'
import { useTechnicians } from './useTechnicians'

export function useJobs(role) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { technicians } = useTechnicians()

  const technicianNameById = useMemo(() => {
    const byId = Object.fromEntries(technicians.map((t) => [t.id, t.full_name]))
    return (id) => byId[id]
  }, [technicians])

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
          'id, job_number, status, description, site_address, client_id, queue_id, created_at, updated_at, clients(name), queues(name), schedule_entries(technician_id, scheduled_date, start_time, status)'
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
          queueName: job.queues?.name ?? 'Unqueued',
          ...deriveScheduleSummary(job.schedule_entries),
        }))
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [role])

  const jobsWithAssigned = useMemo(
    () =>
      role === 'technician'
        ? jobs
        : jobs.map((job) => ({
            ...job,
            assignedName: deriveAssignedTechnicians(job.schedule_entries, technicianNameById),
          })),
    [jobs, role, technicianNameById]
  )

  return { jobs: jobsWithAssigned, loading, error }
}
