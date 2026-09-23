import { useEffect, useRef } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { GRID_HOURS, assignLanes, blockGeometry, formatHourLabel, hourToTime } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

const LANE_HEIGHT = 62

function DayCell({ technicianId, date, hour, techName, onCellClick, onDrop }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return dropTargetForElements({
      element,
      getData: () => ({ technicianId, date, hour }),
      onDragEnter: () => element.classList.add('schedule-day-cell--drop-active'),
      onDragLeave: () => element.classList.remove('schedule-day-cell--drop-active'),
      onDrop: ({ source, self }) => {
        element.classList.remove('schedule-day-cell--drop-active')
        onDrop(source.data, self.data)
      },
    })
  }, [technicianId, date, hour, onDrop])

  return (
    <button
      ref={ref}
      type="button"
      className="schedule-day-cell"
      data-technician-id={technicianId}
      data-date={date}
      data-hour={hour}
      aria-label={`Book ${techName} at ${formatHourLabel(hour)}`}
      onClick={() => onCellClick(technicianId, date, hourToTime(hour))}
    />
  )
}

export default function DayGrid({ date, technicians, entries, jobsById, onCellClick, onBlockClick, onDrop }) {
  return (
    <div className="schedule-day">
      <div className="schedule-day-header">
        <div className="schedule-day-name">Technician</div>
        <div className="schedule-day-hours">
          {GRID_HOURS.map((hour) => (
            <div key={hour} className="schedule-day-hour-label">{formatHourLabel(hour)}</div>
          ))}
        </div>
      </div>
      {technicians.map((tech) => {
        const techEntries = entries.filter(
          (entry) => entry.technician_id === tech.id && entry.scheduled_date === date
        )
        const { placed, laneCount } = assignLanes(techEntries)
        return (
          <div key={tech.id} className="schedule-day-row">
            <div className="schedule-day-name">{tech.full_name}</div>
            <div className="schedule-day-track" style={{ minHeight: laneCount * LANE_HEIGHT }}>
              <div className="schedule-day-cells">
                {GRID_HOURS.map((hour) => (
                  <DayCell
                    key={hour}
                    technicianId={tech.id}
                    date={date}
                    hour={hour}
                    techName={tech.full_name}
                    onCellClick={onCellClick}
                    onDrop={onDrop}
                  />
                ))}
              </div>
              {placed.map(({ entry, lane }) => {
                const { leftPct, widthPct } = blockGeometry(entry.start_time, entry.end_time)
                return (
                  <ScheduleBlock
                    key={entry.id}
                    entry={entry}
                    job={jobsById[entry.job_id]}
                    variant="block"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: lane * LANE_HEIGHT + 2,
                      height: LANE_HEIGHT - 4,
                    }}
                    onClick={onBlockClick}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
