import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useUnreadNotifications(role) {
  const [items, setItems] = useState([])

  const reload = useCallback(async () => {
    if (role === 'technician') {
      const [{ data: commRows }, { data: jobRows }] = await Promise.all([
        supabase
          .from('communications')
          .select('id, type, sender, body, created_at, job_id')
          .eq('direction', 'inbound')
          .is('read_at', null)
          .order('created_at', { ascending: false }),
        supabase.rpc('get_my_jobs'),
      ])

      if (!commRows) return

      const jobMap = Object.fromEntries((jobRows ?? []).map((job) => [job.id, job]))
      const clientIds = [...new Set(Object.values(jobMap).map((job) => job.client_id))]
      const { data: clientRows } = clientIds.length
        ? await supabase.from('clients').select('id, name').in('id', clientIds)
        : { data: [] }
      const clientMap = Object.fromEntries((clientRows ?? []).map((client) => [client.id, client.name]))

      setItems(
        commRows.map((row) => {
          const job = jobMap[row.job_id]
          return {
            ...row,
            job: {
              id: row.job_id,
              job_number: job?.job_number,
              clientName: clientMap[job?.client_id] ?? 'Unknown client',
            },
          }
        })
      )
      return
    }

    const { data } = await supabase
      .from('communications')
      .select('id, type, sender, body, created_at, job:jobs(id, job_number, clients(name))')
      .eq('direction', 'inbound')
      .is('read_at', null)
      .order('created_at', { ascending: false })

    if (data) {
      setItems(
        data.map((row) => ({
          ...row,
          job: { id: row.job.id, job_number: row.job.job_number, clientName: row.job.clients?.name ?? 'Unknown client' },
        }))
      )
    }
  }, [role])

  useEffect(() => {
    if (!role) return
    reload()
    const interval = setInterval(reload, 30000)
    return () => clearInterval(interval)
  }, [reload, role])

  async function markRead(id) {
    setItems((prev) => prev.filter((item) => item.id !== id))
    await supabase.from('communications').update({ read_at: new Date().toISOString() }).eq('id', id)
  }

  return { items, markRead }
}
