import { useEffect, useRef } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { formatJobNumber } from '../lib/jobConstants'
import { entryTags, formatTimeRange } from '../lib/scheduleUtils'

export default function ScheduleBlock({ entry, job, variant, style, onClick }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return draggable({
      element,
      getInitialData: () => ({ type: 'schedule-entry', entryId: entry.id }),
      onDragStart: () => element.classList.add('schedule-block--dragging'),
      onDrop: () => element.classList.remove('schedule-block--dragging'),
    })
  }, [entry.id])

  const className = [
    'schedule-block',
    `schedule-block--${variant}`,
    `schedule-block--${entry.entry_type}`,
    entry.status === 'tentative' ? 'schedule-block--tentative' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const title = job ? `${formatJobNumber(job.job_number)} ${job.clientName}` : 'Unknown job'
  const meta = `${formatTimeRange(entry.start_time, entry.end_time)} · ${entryTags(entry).join(' · ')}`

  return (
    <button
      ref={ref}
      draggable
      type="button"
      className={className}
      style={style}
      data-entry-id={entry.id}
      title={`${title} — ${meta}${job?.site_address ? ` — ${job.site_address}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick(entry)
      }}
    >
      <span className="schedule-block-title">{title}</span>
      <span className="schedule-block-meta">{meta}</span>
      {job?.site_address && <span className="schedule-block-address">{job.site_address}</span>}
    </button>
  )
}
