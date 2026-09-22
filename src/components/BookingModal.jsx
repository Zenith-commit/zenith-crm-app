import { useState } from 'react'
import Modal from './Modal'
import JobPicker from './JobPicker'
import { formatJobLabel } from '../lib/jobConstants'
import { bookEntry, fetchJobStatus, updateEntry } from '../lib/scheduleActions'
import {
  ALL_DAY,
  ALL_DAY_START,
  DEFAULT_START,
  START_TIME_OPTIONS,
  defaultDuration,
  describeBooked,
  durationFits,
  durationFromTimes,
  durationOptions,
  fitDuration,
  formatTime,
  resolveTimes,
  todayString,
} from '../lib/scheduleUtils'

export default function BookingModal({
  mode,
  job = null,
  jobs = [],
  technicians,
  initial = {},
  entry = null,
  onClose,
  onSaved,
}) {
  const isEdit = mode === 'edit'
  const [selectedJobId, setSelectedJobId] = useState(job?.id ?? '')
  const [technicianId, setTechnicianId] = useState(isEdit ? entry.technician_id : (initial.technicianId ?? ''))
  const [date, setDate] = useState(isEdit ? entry.scheduled_date : (initial.date ?? todayString()))
  const [startTime, setStartTime] = useState(
    isEdit ? entry.start_time.slice(0, 5) : (initial.startTime ?? DEFAULT_START)
  )
  const [duration, setDuration] = useState(
    isEdit ? durationFromTimes(entry.start_time, entry.end_time) : defaultDuration(job?.status)
  )
  const [durationTouched, setDurationTouched] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedJob = job ?? jobs.find((candidate) => candidate.id === selectedJobId) ?? null
  const startOptions = START_TIME_OPTIONS.includes(startTime)
    ? START_TIME_OPTIONS
    : [...START_TIME_OPTIONS, startTime].sort()
  const isAllDay = duration === ALL_DAY
  const endTime = resolveTimes(startTime, duration).end

  function handleJobSelect(picked) {
    setSelectedJobId(picked.id)
    if (!durationTouched && !isAllDay) {
      setDuration(fitDuration(startTime, defaultDuration(picked.status)))
    }
  }

  function handleStartChange(value) {
    setStartTime(value)
    setDuration((current) => fitDuration(value, current))
  }

  function handleDurationChange(raw) {
    const value = raw === ALL_DAY ? ALL_DAY : Number(raw)
    setDurationTouched(true)
    setDuration(value)
    if (value === ALL_DAY) setStartTime(ALL_DAY_START)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isEdit && !selectedJob) {
      setError('Choose a job.')
      return
    }
    if (!technicianId) {
      setError('Choose a technician.')
      return
    }
    if (!date) {
      setError('Choose a date.')
      return
    }

    setSaving(true)
    setError(null)
    const { start, end } = resolveTimes(startTime, duration)

    if (isEdit) {
      const { error: saveError } = await updateEntry(entry.id, { technicianId, date, start, end })
      if (saveError) {
        setError(saveError.message)
        setSaving(false)
        return
      }
      setSaving(false)
      await onSaved('Booking updated.')
      return
    }

    const { data, error: saveError } = await bookEntry({
      jobId: selectedJob.id,
      technicianId,
      date,
      start,
      end,
    })
    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }
    const statusAfter = await fetchJobStatus(selectedJob.id)
    setSaving(false)
    await onSaved(describeBooked(data, selectedJob.status, statusAfter))
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2>{isEdit ? 'Edit booking' : 'Book'}</h2>

        {job || isEdit ? (
          <p>
            <strong>Job:</strong> {job ? formatJobLabel(job) : 'Unknown job'}
          </p>
        ) : (
          <label>
            Job
            <JobPicker
              jobs={jobs}
              selectedLabel={selectedJob ? formatJobLabel(selectedJob) : ''}
              onSelect={handleJobSelect}
            />
          </label>
        )}

        <label>
          Technician
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required>
            <option value="">Select technician</option>
            {technicians.map((tech) => (
              <option key={tech.id} value={tech.id}>{tech.full_name}</option>
            ))}
          </select>
        </label>

        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <label>
          Start time
          <select
            value={startTime}
            disabled={isAllDay}
            onChange={(e) => handleStartChange(e.target.value)}
          >
            {startOptions.map((time) => (
              <option key={time} value={time}>{formatTime(time)}</option>
            ))}
          </select>
        </label>

        <label>
          Duration
          <select value={duration} onChange={(e) => handleDurationChange(e.target.value)}>
            {durationOptions(duration).map((preset) => (
              <option
                key={preset.value}
                value={preset.value}
                disabled={!durationFits(startTime, preset.value)}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <p className="schedule-end-preview">Ends {formatTime(endTime)}</p>

        {error && <p role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Book'}
        </button>
      </form>
    </Modal>
  )
}
