import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const SIMULATED_REPLY_BODY = {
  email: "Thanks for reaching out -- this is a simulated reply for demo purposes.",
  sms: 'Got it, thanks! (simulated reply)',
}

export function useCommunications(jobId, type) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('communications')
      .select('id, direction, sender, recipient, subject, body, created_at, sent_by')
      .eq('job_id', jobId)
      .eq('type', type)
      .order('created_at', { ascending: false })

    if (error) {
      setError(error)
      setLoading(false)
      return
    }

    const distinctSenderIds = [...new Set(data.filter((row) => row.sent_by).map((row) => row.sent_by))]
    const namePairs = await Promise.all(
      distinctSenderIds.map((id) =>
        supabase.rpc('get_sender_name', { target_user_id: id }).then(({ data: name }) => [id, name])
      )
    )
    const nameMap = Object.fromEntries(namePairs)

    setEntries(data.map((row) => ({ ...row, sentByName: row.sent_by ? nameMap[row.sent_by] : null })))
    setLoading(false)
  }, [jobId, type])

  useEffect(() => {
    reload()
  }, [reload])

  async function send({ sender, recipient, subject, body }) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase.from('communications').insert({
      job_id: jobId,
      type,
      direction: 'outbound',
      sender,
      recipient,
      subject: type === 'email' ? subject : null,
      body,
      sent_by: user.id,
    })

    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function simulateIncomingReply({ sender, recipient }) {
    const { error } = await supabase.from('communications').insert({
      job_id: jobId,
      type,
      direction: 'inbound',
      sender: recipient,
      recipient: sender,
      subject: type === 'email' ? 'Re: your message' : null,
      body: SIMULATED_REPLY_BODY[type],
      sent_by: null,
    })

    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { entries, loading, error, send, simulateIncomingReply }
}
