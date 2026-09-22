import { Fragment } from 'react'
import { compareEntries, formatDayLabel, todayString } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

export default function WeekGrid({ days, technicians, entries, jobsById, onCellClick, onBlockClick }) {
  const today = todayString()

  return (
    <div className="schedule-week">
      <div className="schedule-week-head">Technician</div>
      {days.map((day) => (
        <div
          key={day}
          className={day === today ? 'schedule-week-head schedule-week-today' : 'schedule-week-head'}
        >
          {formatDayLabel(day)}
        </div>
      ))}
      {technicians.map((tech) => (
        <Fragment key={tech.id}>
          <div className="schedule-week-name">{tech.full_name}</div>
          {days.map((day) => {
            const cellEntries = entries
              .filter((entry) => entry.technician_id === tech.id && entry.scheduled_date === day)
              .sort(compareEntries)
            return (
              <div
                key={day}
                className={day === today ? 'schedule-week-cell schedule-week-today' : 'schedule-week-cell'}
                tabIndex={0}
                data-technician-id={tech.id}
                data-date={day}
                aria-label={`Book ${tech.full_name} on ${formatDayLabel(day)}`}
                onClick={() => onCellClick(tech.id, day, null)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === 'Enter') onCellClick(tech.id, day, null)
                }}
              >
                {cellEntries.map((entry) => (
                  <ScheduleBlock
                    key={entry.id}
                    entry={entry}
                    job={jobsById[entry.job_id]}
                    variant="chip"
                    onClick={onBlockClick}
                  />
                ))}
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
