import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useJobDiary } from '../hooks/useJobDiary'

export default function DiarySection({ jobId }) {
  const { entries, loading, error, addEntry } = useJobDiary(jobId)
  const [entryText, setEntryText] = useState('')
  const [photoFiles, setPhotoFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [photoUrls, setPhotoUrls] = useState({})

  useEffect(() => {
    const allPaths = entries.flatMap((entry) => entry.photo_paths)
    const missingPaths = allPaths.filter((path) => !photoUrls[path])
    if (missingPaths.length === 0) return

    let cancelled = false
    Promise.all(
      missingPaths.map((path) =>
        supabase.storage
          .from('diary-photos')
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

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const { error } = await addEntry({ entryText, photoFiles })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setEntryText('')
    setPhotoFiles([])
  }

  return (
    <section>
      <h2>Diary</h2>
      {loading && <p>Loading diary...</p>}
      {error && <p role="alert">Could not load diary: {error.message}</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <p>{new Date(entry.created_at).toLocaleString()}</p>
            <p>{entry.entry_text}</p>
            {entry.photo_paths.map((path) =>
              photoUrls[path] ? (
                <img
                  key={path}
                  src={photoUrls[path]}
                  alt="Diary attachment"
                  style={{ maxWidth: 200, display: 'block' }}
                />
              ) : (
                <p key={path}>Loading photo...</p>
              )
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label>
          New entry
          <textarea value={entryText} onChange={(e) => setEntryText(e.target.value)} required />
        </label>
        <label>
          Photos
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotoFiles(Array.from(e.target.files))}
          />
        </label>
        {formError && <p role="alert">{formError}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Add Entry'}
        </button>
      </form>
    </section>
  )
}
