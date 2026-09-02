import { useState } from 'react'
import { useFeedback } from '../hooks/useFeedback'

export default function FeedbackIcon() {
  const { submit } = useFeedback()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [photoFiles, setPhotoFiles] = useState([])
  const [previewUrls, setPreviewUrls] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleFilesChange(e) {
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    const files = Array.from(e.target.files)
    setPhotoFiles(files)
    setPreviewUrls(files.map((file) => URL.createObjectURL(file)))
  }

  function resetForm() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    setMessage('')
    setPhotoFiles([])
    setPreviewUrls([])
    setError(null)
  }

  function handleToggle() {
    if (open) resetForm()
    setOpen((prev) => !prev)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await submit({ message, photoFiles })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    resetForm()
    setOpen(false)
  }

  return (
    <div className="feedback-icon">
      <button onClick={handleToggle}>💬</button>
      {open && (
        <div className="feedback-dropdown">
          <form onSubmit={handleSubmit}>
            <label>
              Feedback
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required />
            </label>
            <label>
              Photos (optional)
              <input type="file" accept="image/*" multiple onChange={handleFilesChange} />
            </label>
            {previewUrls.map((url) => (
              <img
                key={url}
                src={url}
                alt="Selected attachment preview"
                style={{ maxWidth: 100, display: 'inline-block', marginRight: 4 }}
              />
            ))}
            {error && <p role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Sending...' : 'Send Feedback'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
