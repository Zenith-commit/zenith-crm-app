import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useScheduleBoard } from '../hooks/useScheduleBoard'
import { useTechnicians } from '../hooks/useTechnicians'
import DayGrid from '../components/DayGrid'
import WeekGrid from '../components/WeekGrid'
import UnscheduledList from '../components/UnscheduledList'
import BookingModal from '../components/BookingModal'
import BlockDetailsModal from '../components/BlockDetailsModal'
import {
  addDays,
  formatRangeLabel,
  parseBoardParams,
  startOfWeek,
  todayString,
  weekDays,
} from '../lib/scheduleUtils'

function ScheduleBoard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { view, date } = parseBoardParams(searchParams)
  const rangeStart = view === 'day' ? date : startOfWeek(date)
  const rangeEnd = view === 'day' ? date : addDays(rangeStart, 6)

  const { entries, jobs, loaded, error, reload } = useScheduleBoard(rangeStart, rangeEnd)
  const { technicians, error: techError } = useTechnicians()
  const [booking, setBooking] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [notice, setNotice] = useState(null)

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((job) => [job.id, job])), [jobs])
  const techNames = useMemo(
    () => Object.fromEntries(technicians.map((tech) => [tech.id, tech.full_name])),
    [technicians]
  )

  function navigate(nextView, nextDate) {
    setSearchParams({ view: nextView, date: nextDate })
  }

  function shift(direction) {
    navigate(view, addDays(date, (view === 'day' ? 1 : 7) * direction))
  }

  function handleCellClick(technicianId, cellDate, startTime) {
    setBooking({ mode: 'book', job: null, initial: { technicianId, date: cellDate, startTime } })
  }

  function handleBookJob(job) {
    setBooking({
      mode: 'book',
      job,
      initial: { date: view === 'day' ? date : todayString() },
    })
  }

  function handleEditFromDetails() {
    setBooking({ mode: 'edit', entry: selectedEntry })
    setSelectedEntry(null)
  }

  async function handleChanged(message) {
    setBooking(null)
    setSelectedEntry(null)
    setNotice(message)
    await reload()
  }

  const bookingJob =
    booking?.mode === 'edit' ? (jobsById[booking.entry.job_id] ?? null) : (booking?.job ?? null)

  return (
    <div>
      <h1>Schedule</h1>

      <div className="schedule-controls">
        <button
          type="button"
          className={view === 'day' ? 'active' : ''}
          onClick={() => navigate('day', date)}
        >
          Day
        </button>
        <button
          type="button"
          className={view === 'week' ? 'active' : ''}
          onClick={() => navigate('week', date)}
        >
          Week
        </button>
        <button type="button" onClick={() => shift(-1)}>‹ Prev</button>
        <button type="button" onClick={() => navigate(view, todayString())}>Today</button>
        <button type="button" onClick={() => shift(1)}>Next ›</button>
        <span className="schedule-range-label">{formatRangeLabel(view, date)}</span>
      </div>

      {notice && <p role="status" className="schedule-notice">{notice}</p>}
      {error && (
        <p role="alert">
          Could not load the schedule: {error.message} <button type="button" onClick={reload}>Retry</button>
        </p>
      )}
      {techError && <p role="alert">Could not load technicians: {techError.message}</p>}

      {!loaded && !error ? (
        <p>Loading...</p>
      ) : (
        <div className="schedule-layout">
          <div className="schedule-main">
            {technicians.length === 0 ? (
              <p>No technicians yet.</p>
            ) : (
              <>
                {entries.length === 0 && <p>No bookings in this range.</p>}
                {view === 'day' ? (
                  <DayGrid
                    date={date}
                    technicians={technicians}
                    entries={entries}
                    jobsById={jobsById}
                    onCellClick={handleCellClick}
                    onBlockClick={setSelectedEntry}
                  />
                ) : (
                  <WeekGrid
                    days={weekDays(date)}
                    technicians={technicians}
                    entries={entries}
                    jobsById={jobsById}
                    onCellClick={handleCellClick}
                    onBlockClick={setSelectedEntry}
                  />
                )}
              </>
            )}
          </div>
          <aside className="schedule-side">
            <UnscheduledList jobs={jobs} onBook={handleBookJob} />
          </aside>
        </div>
      )}

      {selectedEntry && (
        <BlockDetailsModal
          entry={selectedEntry}
          job={jobsById[selectedEntry.job_id]}
          technicianName={techNames[selectedEntry.technician_id]}
          onClose={() => setSelectedEntry(null)}
          onEdit={handleEditFromDetails}
          onChanged={handleChanged}
          onRefresh={reload}
        />
      )}
      {booking && (
        <BookingModal
          mode={booking.mode}
          job={bookingJob}
          jobs={jobs}
          technicians={technicians}
          initial={booking.initial}
          entry={booking.entry}
          onClose={() => setBooking(null)}
          onSaved={handleChanged}
        />
      )}
    </div>
  )
}

export default function Schedule() {
  const { profile } = useOutletContext()
  if (profile?.role === 'technician') return <p>Staff only.</p>
  return <ScheduleBoard />
}
