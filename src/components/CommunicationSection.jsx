import { useState } from 'react'
import { useCommunications } from '../hooks/useCommunications'

const SENDER_IDENTITY = {
  email: 'Zenith Roof Restorations <noreply@zenith-demo.local>',
  sms: 'ZENITH',
}

const LABELS = {
  email: { heading: 'Email', to: 'To (email)', sendLabel: 'Send Email' },
  sms: { heading: 'SMS', to: 'To (phone)', sendLabel: 'Send SMS' },
}

export default function CommunicationSection({ jobId, type, recipientDefault, role }) {
  const { entries, loading, error, send, simulateIncomingReply } = useCommunications(jobId, type)
  const canSimulate = role !== 'technician'
  const [recipient, setRecipient] = useState(recipientDefault ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [formError, setFormError] = useState(null)

  const { heading, to, sendLabel } = LABELS[type]

  async function handleSubmit(e) {
    e.preventDefault()
    setSending(true)
    setFormError(null)
    const { error } = await send({ sender: SENDER_IDENTITY[type], recipient, subject, body })
    setSending(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setSubject('')
    setBody('')
  }

  async function handleSimulateReply() {
    setSimulating(true)
    setFormError(null)
    const { error } = await simulateIncomingReply({ sender: SENDER_IDENTITY[type], recipient })
    setSimulating(false)
    if (error) setFormError(error.message)
  }

  return (
    <section>
      <h2>{heading}</h2>
      <p><em>Simulated — nothing is actually sent. Demonstrates the intended UX only.</em></p>
      {loading && <p>Loading {heading.toLowerCase()}...</p>}
      {error && <p role="alert">Could not load {heading.toLowerCase()}: {error.message}</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <p>
              <strong>{entry.direction === 'inbound' ? 'Received' : 'Sent'}</strong>
              {' — '}
              {new Date(entry.created_at).toLocaleString()}
              {entry.direction === 'outbound' && entry.sentByName ? ` by ${entry.sentByName}` : ''}
            </p>
            <p>From: {entry.sender} · To: {entry.recipient}</p>
            {entry.subject && <p>Subject: {entry.subject}</p>}
            <p>{entry.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label>
          {to}
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
          />
        </label>
        {type === 'email' && (
          <label>
            Subject
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        )}
        <label>
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        {formError && <p role="alert">{formError}</p>}
        <button className="btn-primary" type="submit" disabled={sending}>
          {sending ? 'Sending...' : sendLabel}
        </button>
        {canSimulate && (
          <button type="button" onClick={handleSimulateReply} disabled={simulating || !recipient}>
            {simulating ? 'Simulating...' : 'Simulate Incoming Reply'}
          </button>
        )}
      </form>
    </section>
  )
}
