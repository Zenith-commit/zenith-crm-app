import { useState } from 'react'
import { formatJobLabel } from '../lib/jobConstants'
import { classifyUnscheduled } from '../lib/scheduleUtils'

const TYPE_FILTERS = ['All jobs', 'Needs inspection', 'Needs work scheduling']
const BADGE_LETTERS = { Quote: 'Q', 'Work Order': 'W', Scheduled: 'S' }

export default function UnscheduledList({ jobs, onBook }) {
  const [typeFilter, setTypeFilter] = useState('All jobs')
  const [filter, setFilter] = useState('')

  const q = filter.trim().toLowerCase()
  const cards = jobs
    .map((job) => ({ job, info: classifyUnscheduled(job) }))
    .filter(
      ({ job, info }) =>
        info &&
        (typeFilter === 'All jobs' || info.label === typeFilter) &&
        (!q || formatJobLabel(job).toLowerCase().includes(q))
    )
    .sort((a, b) => a.job.job_number - b.job.job_number)

  return (
    <div className="unscheduled-panel">
      <h2>Unscheduled jobs</h2>
      <div className="unscheduled-controls">
        <select
          value={typeFilter}
          aria-label="Filter by what the job needs"
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {TYPE_FILTERS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <input
          type="text"
          value={filter}
          placeholder="Job search..."
          aria-label="Search unscheduled jobs"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {cards.length === 0 ? (
        <p>Nothing to schedule.</p>
      ) : (
        <ul className="unscheduled-list">
          {cards.map(({ job, info }) => (
            <li
              key={job.id}
              className={
                job.status === 'Quote'
                  ? 'unscheduled-card unscheduled-card--quote'
                  : 'unscheduled-card'
              }
              data-job-id={job.id}
            >
              <span className="unscheduled-badge-circle" aria-hidden="true">
                {BADGE_LETTERS[job.status] ?? '?'}
              </span>
              <div className="unscheduled-card-body">
                <div className="unscheduled-card-head">
                  <span className="unscheduled-client">{job.clientName}</span>
                  <span className="unscheduled-number">
                    #{String(job.job_number).padStart(4, '0')}
                  </span>
                </div>
                <div className="unscheduled-address">{job.site_address || 'No site address'}</div>
                {job.description && (
                  <div className="unscheduled-description">{job.description}</div>
                )}
                <div className="unscheduled-card-foot">
                  <span className="unscheduled-label">{info.label}</span>
                  {info.tentativeCount > 0 && (
                    <span className="unscheduled-hold-badge">
                      {info.tentativeCount} tentative hold{info.tentativeCount === 1 ? '' : 's'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-primary unscheduled-book"
                    onClick={() => onBook(job)}
                  >
                    Book
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
