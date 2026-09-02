import { useFeedbackInbox } from '../hooks/useFeedbackInbox'

export default function FeedbackInbox() {
  const { entries, loading, error, photoUrls } = useFeedbackInbox()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load feedback: {error.message}</p>

  return (
    <div>
      <h1>Feedback Inbox</h1>
      {entries.length === 0 ? (
        <p>No feedback submitted yet.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <p>{new Date(entry.created_at).toLocaleString()} — {entry.submitterName}</p>
              <p>{entry.message}</p>
              {entry.photo_paths.map((path) =>
                photoUrls[path] ? (
                  <img
                    key={path}
                    src={photoUrls[path]}
                    alt="Feedback attachment"
                    style={{ maxWidth: 200, display: 'block' }}
                  />
                ) : (
                  <p key={path}>Loading photo...</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
