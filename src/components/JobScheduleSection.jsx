import { useState } from 'react'
import { useJobSchedule } from '../hooks/useJobSchedule'
import { useTechnicians } from '../hooks/useTechnicians'
import BookingModal from './BookingModal'
import ScheduleEntryActions from './ScheduleEntryActions'
import {
  entryStatusLabel,
  entryTypeLabel,
  formatDayLabel,
  formatTimeRange,
  todayString,
} from '../lib/scheduleUtils'

export default function JobScheduleSection({ job, onJobChanged }) {
  const { entries, loaded, error, reload } = useJobSchedule(job.id)
  const { technicians } = useTechnicians()
  const [booking, setBooking] = useState(null)
  const [notice, setNotice] = useState(null)

  const techNames = Object.fromEntries(technicians.map((tech) => [tech.id, tech.full_name]))

  async function handleChanged(message) {
    setBooking(null)
    setNotice(message)
    await reload()
    await onJobChanged()
  }

  if (error) {
    return (
      <p role="alert">
        Could not load bookings: {error.message} <button type="button" onClick={reload}>Retry</button>
      </p>
    )
  }
  if (!loaded) return <p>Loading...</p>

  return (
    <div>
      <div className="job-detail-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setBooking({ mode: 'book' })}
        >
          Book
        </button>
      </div>

      {notice && <p role="status" className="schedule-notice">{notice}</p>}

      {entries.length === 0 ? (
        <p>No bookings yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Technician</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDayLabel(entry.scheduled_date)}</td>
                <td>{formatTimeRange(entry.start_time, entry.end_time)}</td>
                <td>{techNames[entry.technician_id] ?? 'Unknown'}</td>
                <td>{entryTypeLabel(entry)} · {entryStatusLabel(entry)}</td>
                <td>
                  <ScheduleEntryActions
                    entry={entry}
                    jobEntries={entries}
                    jobStatus={job.status}
                    onEdit={() => setBooking({ mode: 'edit', entry })}
                    onChanged={handleChanged}
                    onRefresh={reload}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {booking && (
        <BookingModal
          mode={booking.mode}
          job={job}
          technicians={technicians}
          initial={{ date: todayString() }}
          entry={booking.entry}
          onClose={() => setBooking(null)}
          onSaved={handleChanged}
        />
      )}
    </div>
  )
}
