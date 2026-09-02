import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useFeedbackInbox() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [photoUrls, setPhotoUrls] = useState({})

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('feedback')
      .select('id, message, photo_paths, created_at, submitted_by, users!feedback_submitted_by_fkey(full_name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error)
      setLoading(false)
      return
    }

    setEntries(
      data.map((row) => ({
        ...row,
        submitterName: row.users?.full_name ?? 'Unknown',
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const allPaths = entries.flatMap((entry) => entry.photo_paths)
    const missingPaths = allPaths.filter((path) => !photoUrls[path])
    if (missingPaths.length === 0) return

    let cancelled = false
    Promise.all(
      missingPaths.map((path) =>
        supabase.storage
          .from('feedback-photos')
          .createSignedUrl(path, 3600)
          .then(({ data }) => [path, data?.signedUrl])
      )
    ).then((pairs) => {
      if (cancelled) return
      setPhotoUrls((prev) => ({
        ...prev,
        ...Object.fromEntries(pairs.filter(([, url]) => url)),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [entries, photoUrls])

  return { entries, loading, error, photoUrls }
}
