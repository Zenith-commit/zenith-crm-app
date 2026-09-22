import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useScheduleBoard(rangeStart, rangeEnd) {
  const [entries, setEntries] = useState([])
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const latestRequest = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const [entriesResult, jobsResult] = await Promise.all([
        supabase
          .from('schedule_entries')
          .select('id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time')
          .gte('scheduled_date', rangeStart)
          .lte('scheduled_date', rangeEnd),
        supabase
          .from('jobs')
          .select('id, job_number, status, description, site_address, clients(name), schedule_entries(id, entry_type, status)')
          .order('job_number', { ascending: false }),
      ])
      if (requestId !== latestRequest.current) return

      const failure = entriesResult.error ?? jobsResult.error
      if (failure) {
        setError(failure)
        return
      }

      setEntries(entriesResult.data)
      setJobs(
        jobsResult.data.map((job) => ({
          ...job,
          clientName: job.clients?.name ?? 'Unknown client',
        }))
      )
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (requestId === latestRequest.current) setError(err)
    }
  }, [rangeStart, rangeEnd])

  useEffect(() => {
    reload()
  }, [reload])

  return { entries, jobs, loaded, error, reload }
}
