import { Link } from 'react-router-dom'
import Modal from './Modal'
import ScheduleEntryActions from './ScheduleEntryActions'
import { formatJobNumber } from '../lib/jobConstants'
import {
  entryStatusLabel,
  entryTypeLabel,
  formatDayLabel,
  formatTimeRange,
} from '../lib/scheduleUtils'

export default function BlockDetailsModal({
  entry,
  job,
  technicianName,
  onClose,
  onEdit,
  onChanged,
  onRefresh,
}) {
  return (
    <Modal onClose={onClose}>
      {job ? (
        <>
          <h2>{formatJobNumber(job.job_number)} — {job.clientName}</h2>
          <p>{job.site_address || 'No site address'}</p>
          <p><Link to={`/jobs/${job.id}`}>Open job</Link></p>
        </>
      ) : (
        <h2>Booking</h2>
      )}
      <p>Technician: {technicianName ?? 'Unknown'}</p>
      <p>Date: {formatDayLabel(entry.scheduled_date)}</p>
      <p>Time: {formatTimeRange(entry.start_time, entry.end_time)}</p>
      <p>{entryTypeLabel(entry)} · {entryStatusLabel(entry)}</p>
      {job && (
        <ScheduleEntryActions
          entry={entry}
          jobEntries={job.schedule_entries ?? []}
          jobStatus={job.status}
          onEdit={onEdit}
          onChanged={onChanged}
          onRefresh={onRefresh}
        />
      )}
    </Modal>
  )
}
