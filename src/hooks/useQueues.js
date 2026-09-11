import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useQueues() {
  const [queues, setQueues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('queues')
      .select('id, name, created_at')
      .order('name', { ascending: true })

    if (error) setError(error)
    else setQueues(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function create(name) {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('queues').insert({ name, created_by: user.id })
    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function rename(id, name) {
    const { error } = await supabase.from('queues').update({ name }).eq('id', id)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function countJobsInQueue(id) {
    const { count, error } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('queue_id', id)
    if (error) throw error
    return count ?? 0
  }

  async function remove(id) {
    const { error } = await supabase.from('queues').delete().eq('id', id)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { queues, loading, error, reload, create, rename, countJobsInQueue, remove }
}
