export const JOB_STATUSES = ['Quote', 'Work Order', 'Scheduled', 'Completed']

export function formatJobNumber(jobNumber) {
  return `Job #${String(jobNumber).padStart(4, '0')}`
}

export function formatInvoiceNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Invoice #${String(jobNumber).padStart(4, '0')}-${letter}`
}

export function formatRoofReportNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Roof Report #${String(jobNumber).padStart(4, '0')}-${letter}`
}

export function deriveScheduleSummary(entries) {
  const confirmed = (entries ?? [])
    .filter((entry) => entry.status === 'confirmed')
    .sort((a, b) => `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`))

  if (confirmed.length === 0) {
    return { next_scheduled_date: null, next_scheduled_start_time: null, additional_scheduled_days: 0 }
  }

  return {
    next_scheduled_date: confirmed[0].scheduled_date,
    next_scheduled_start_time: confirmed[0].start_time,
    additional_scheduled_days: confirmed.length - 1,
  }
}

export function formatScheduleSummary(job) {
  if (!job.next_scheduled_date) return '—'

  const date = new Date(`${job.next_scheduled_date}T${job.next_scheduled_start_time ?? '00:00:00'}`)
  const dateStr = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const timeStr = job.next_scheduled_start_time
    ? date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : null

  const base = timeStr ? `${dateStr}, ${timeStr}` : dateStr
  const extra = job.additional_scheduled_days > 0
    ? ` (+${job.additional_scheduled_days} more day${job.additional_scheduled_days === 1 ? '' : 's'})`
    : ''

  return `${base}${extra}`
}

export function deriveAssignedTechnicians(entries, technicianNameById) {
  const confirmed = (entries ?? [])
    .filter((entry) => entry.status === 'confirmed')
    .sort((a, b) => `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`))

  if (confirmed.length === 0) return 'Unassigned'

  const distinctIds = [...new Set(confirmed.map((entry) => entry.technician_id))]
  const primaryName = technicianNameById(confirmed[0].technician_id) ?? 'Unknown'

  return distinctIds.length === 1
    ? primaryName
    : `${primaryName} (+${distinctIds.length - 1} more)`
}

export function formatJobLabel(job) {
  const parts = [formatJobNumber(job.job_number), job.clientName]
  if (job.site_address) parts.push(job.site_address)
  return `${parts.join(' — ')}${job.status === 'Completed' ? ' (Completed)' : ''}`
}
