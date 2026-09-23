import { Fragment, useEffect, useRef } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { compareEntries, formatDayLabel, todayString } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

function WeekCell({ technicianId, day, isToday, cellEntries, jobsById, onCellClick, onBlockClick, onDrop }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return dropTargetForElements({
      element,
      getData: () => ({ technicianId, date: day, hour: null }),
      onDragEnter: () => element.classList.add('schedule-week-cell--drop-active'),
      onDragLeave: () => element.classList.remove('schedule-week-cell--drop-active'),
      onDrop: ({ source, self }) => {
        element.classList.remove('schedule-week-cell--drop-active')
        onDrop(source.data, self.data)
      },
    })
  }, [technicianId, day, onDrop])

  return (
    <div
      ref={ref}
      className={isToday ? 'schedule-week-cell schedule-week-today' : 'schedule-week-cell'}
      tabIndex={0}
      data-technician-id={technicianId}
      data-date={day}
      aria-label={`Book at ${formatDayLabel(day)}`}
      onClick={() => onCellClick(technicianId, day, null)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onCellClick(technicianId, day, null)
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
}

export default function WeekGrid({ days, technicians, entries, jobsById, onCellClick, onBlockClick, onDrop }) {
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
              <WeekCell
                key={day}
                technicianId={tech.id}
                day={day}
                isToday={day === today}
                cellEntries={cellEntries}
                jobsById={jobsById}
                onCellClick={onCellClick}
                onBlockClick={onBlockClick}
                onDrop={onDrop}
              />
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
