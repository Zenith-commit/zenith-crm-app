import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobDiary(jobId) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_diary')
      .select('id, entry_text, photo_paths, created_at, created_by')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (error) setError(error)
    else setEntries(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function addEntry({ entryText, photoFiles }) {
    const { data: { user } } = await supabase.auth.getUser()
    const photoPaths = []

    for (const file of photoFiles) {
      const path = `${jobId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('diary-photos')
        .upload(path, file)
      if (uploadError) return { error: uploadError }
      photoPaths.push(path)
    }

    const { error: insertError } = await supabase.from('job_diary').insert({
      job_id: jobId,
      entry_text: entryText,
      photo_paths: photoPaths,
      created_by: user.id,
    })

    if (insertError) return { error: insertError }
    await reload()
    return { error: null }
  }

  return { entries, loading, error, addEntry }
}
