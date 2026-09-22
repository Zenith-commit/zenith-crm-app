import { useState } from 'react'
import { classifyUnscheduled } from '../lib/scheduleUtils'
import { formatJobLabel } from '../lib/jobConstants'

const MAX_RESULTS = 50

export default function JobPicker({ jobs, selectedLabel, onSelect }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const q = query.trim().toLowerCase()
  const ordered = jobs
    .filter((job) => !q || formatJobLabel(job).toLowerCase().includes(q))
    .sort((a, b) => {
      const aRank = classifyUnscheduled(a) ? 0 : 1
      const bRank = classifyUnscheduled(b) ? 0 : 1
      return aRank - bRank || b.job_number - a.job_number
    })
    .slice(0, MAX_RESULTS)

  function handleSelect(job) {
    onSelect(job)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="material-picker">
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder="Search by job number, client or address"
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="material-picker-results">
          {ordered.length === 0 ? (
            <li className="material-picker-empty">No matches</li>
          ) : (
            ordered.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(job)
                  }}
                >
                  {formatJobLabel(job)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
