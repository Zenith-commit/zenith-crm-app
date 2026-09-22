import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobSchedule(jobId) {
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const latestRequest = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const { data, error: loadError } = await supabase
        .from('schedule_entries')
        .select('id, job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time')
        .eq('job_id', jobId)
        .order('scheduled_date', { ascending: true })
        .order('start_time', { ascending: true })
      if (requestId !== latestRequest.current) return

      if (loadError) {
        setError(loadError)
        return
      }
      setEntries(data)
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (requestId === latestRequest.current) setError(err)
    }
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  return { entries, loaded, error, reload }
}
