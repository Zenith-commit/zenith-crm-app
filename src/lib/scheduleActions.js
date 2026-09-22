import { supabase } from './supabaseClient'

async function run(action) {
  try {
    return await action()
  } catch (err) {
    return { data: null, error: err }
  }
}

export function bookEntry({ jobId, technicianId, date, start, end }) {
  return run(() =>
    supabase.rpc('create_schedule_entry', {
      target_job_id: jobId,
      target_technician_id: technicianId,
      target_date: date,
      target_start: start,
      target_end: end,
    })
  )
}

export function updateEntry(entryId, { technicianId, date, start, end }) {
  return run(() =>
    supabase
      .from('schedule_entries')
      .update({
        technician_id: technicianId,
        scheduled_date: date,
        start_time: start,
        end_time: end,
      })
      .eq('id', entryId)
      .select()
      .single()
  )
}

export function confirmEntry(entryId) {
  return run(() => supabase.rpc('confirm_schedule_entry', { target_entry_id: entryId }))
}

export function removeEntry(entryId) {
  return run(() => supabase.rpc('remove_schedule_entry', { target_entry_id: entryId }))
}

export async function fetchJobStatus(jobId) {
  const { data } = await run(() => supabase.from('jobs').select('status').eq('id', jobId).single())
  return data?.status ?? null
}
