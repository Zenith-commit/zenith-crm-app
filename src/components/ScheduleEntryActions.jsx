import { useState } from 'react'
import { confirmEntry, fetchJobStatus, removeEntry } from '../lib/scheduleActions'
import { describeConfirmed, describeRemoved, entryContext } from '../lib/scheduleUtils'

export default function ScheduleEntryActions({
  entry,
  jobEntries,
  jobStatus,
  onEdit,
  onChanged,
  onRefresh,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { otherTentative, revertsToWorkOrder } = entryContext(entry, jobEntries, jobStatus)
  const canConfirm = entry.entry_type === 'work' && entry.status === 'tentative'

  async function handleConfirm() {
    const warning =
      otherTentative > 0
        ? `Confirming this drops the other ${otherTentative} tentative hold${otherTentative === 1 ? '' : 's'} for this job.\n\n`
        : ''
    if (!window.confirm(`${warning}Confirm this booking?`)) return

    setBusy(true)
    setError(null)
    const { error: actionError } = await confirmEntry(entry.id)
    if (actionError) {
      setError(actionError.message)
      setBusy(false)
      await onRefresh()
      return
    }
    const statusAfter = await fetchJobStatus(entry.job_id)
    setBusy(false)
    await onChanged(describeConfirmed(jobStatus, statusAfter))
  }

  async function handleRemove() {
    const extra = revertsToWorkOrder
      ? '\n\nThis is the last confirmed work day, so the job will go back from Scheduled to Work Order.'
      : ''
    if (!window.confirm(`Are you sure you want to remove this booking?${extra}`)) return

    setBusy(true)
    setError(null)
    const { error: actionError } = await removeEntry(entry.id)
    if (actionError) {
      setError(actionError.message)
      setBusy(false)
      await onRefresh()
      return
    }
    const statusAfter = await fetchJobStatus(entry.job_id)
    setBusy(false)
    await onChanged(describeRemoved(jobStatus, statusAfter))
  }

  return (
    <div className="schedule-actions">
      {canConfirm && (
        <button type="button" className="btn-primary" disabled={busy} onClick={handleConfirm}>
          Confirm
        </button>
      )}
      <button type="button" disabled={busy} onClick={onEdit}>Edit</button>
      <button type="button" disabled={busy} onClick={handleRemove}>Remove</button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
