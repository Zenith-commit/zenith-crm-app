import { GRID_HOURS, assignLanes, blockGeometry, formatHourLabel } from '../lib/scheduleUtils'
import ScheduleBlock from './ScheduleBlock'

const LANE_HEIGHT = 62

function hourToTime(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

export default function DayGrid({ date, technicians, entries, jobsById, onCellClick, onBlockClick }) {
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
                  <button
                    key={hour}
                    type="button"
                    className="schedule-day-cell"
                    data-technician-id={tech.id}
                    data-date={date}
                    data-hour={hour}
                    aria-label={`Book ${tech.full_name} at ${formatHourLabel(hour)}`}
                    onClick={() => onCellClick(tech.id, date, hourToTime(hour))}
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
