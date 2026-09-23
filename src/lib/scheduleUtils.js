export const GRID_START_HOUR = 6
export const GRID_END_HOUR = 18
export const GRID_HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, index) => GRID_START_HOUR + index
)
export const ALL_DAY = 'all-day'
export const ALL_DAY_START = '06:00'
export const ALL_DAY_END = '18:00'
export const DEFAULT_START = '08:00'

const MINUTES_PER_DAY = 24 * 60
const GRID_START_MINUTES = GRID_START_HOUR * 60
const GRID_END_MINUTES = GRID_END_HOUR * 60
const MIN_BLOCK_PCT = 4

function pad2(value) {
  return String(value).padStart(2, '0')
}

// ---- dates: plain 'YYYY-MM-DD' strings, local-time arithmetic only ----

export function toDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseDateString(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function todayString() {
  return toDateString(new Date())
}

export function isValidDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? '')) return false
  return toDateString(parseDateString(dateStr)) === dateStr
}

export function addDays(dateStr, days) {
  const date = parseDateString(dateStr)
  date.setDate(date.getDate() + days)
  return toDateString(date)
}

export function startOfWeek(dateStr) {
  const date = parseDateString(dateStr)
  const offsetFromMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offsetFromMonday)
  return toDateString(date)
}

export function weekDays(dateStr) {
  const start = startOfWeek(dateStr)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function formatDayLabel(dateStr) {
  return parseDateString(dateStr).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatRangeLabel(view, dateStr) {
  if (view === 'day') {
    return parseDateString(dateStr).toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  const start = parseDateString(startOfWeek(dateStr))
  const end = parseDateString(addDays(startOfWeek(dateStr), 6))
  const startText = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${startText} – ${endText}`
}

export function parseBoardParams(params, today = todayString()) {
  const rawView = params.get('view')
  const rawDate = params.get('date')
  return {
    view: rawView === 'day' ? 'day' : 'week',
    date: isValidDateString(rawDate) ? rawDate : today,
  }
}

// ---- times: Postgres 'HH:MM[:SS]' strings ----

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

export function minutesToTime(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

export function formatTime(time) {
  const minutes = timeToMinutes(time)
  const hour24 = Math.floor(minutes / 60)
  const suffix = hour24 >= 12 ? 'pm' : 'am'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${pad2(minutes % 60)}${suffix}`
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)}`
}

export function formatHourLabel(hour) {
  return formatTime(`${pad2(hour)}:00`).replace(':00', '')
}

export function hourToTime(hour) {
  return `${pad2(hour)}:00`
}

export function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

// ---- start-time and duration pickers ----

export const START_TIME_OPTIONS = (() => {
  const options = []
  for (let minutes = 5 * 60; minutes <= 21 * 60; minutes += 15) {
    options.push(minutesToTime(minutes))
  }
  return options
})()

export const DURATION_PRESETS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 90, label: '1.5 hr' },
  { value: 120, label: '2 hr' },
  ...[3, 4, 5, 6, 7, 8, 9, 10].map((hours) => ({ value: hours * 60, label: `${hours} hr` })),
  { value: ALL_DAY, label: 'All day (6am–6pm)' },
]

export function resolveTimes(startTime, duration) {
  if (duration === ALL_DAY) return { start: ALL_DAY_START, end: ALL_DAY_END }
  return {
    start: startTime.slice(0, 5),
    end: minutesToTime(timeToMinutes(startTime) + duration),
  }
}

export function durationFits(startTime, duration) {
  if (duration === ALL_DAY) return true
  return timeToMinutes(startTime) + duration < MINUTES_PER_DAY
}

export function fitDuration(startTime, duration) {
  if (durationFits(startTime, duration)) return duration
  const fitting = DURATION_PRESETS.filter(
    (preset) => preset.value !== ALL_DAY && durationFits(startTime, preset.value)
  )
  return fitting[fitting.length - 1].value
}

export function durationFromTimes(start, end) {
  if (start.slice(0, 5) === ALL_DAY_START && end.slice(0, 5) === ALL_DAY_END) return ALL_DAY
  return timeToMinutes(end) - timeToMinutes(start)
}

export function defaultDuration(jobStatus) {
  return jobStatus === 'Quote' || jobStatus === 'Completed' ? 60 : 480
}

export function durationOptions(currentDuration) {
  const known = currentDuration === ALL_DAY || DURATION_PRESETS.some((preset) => preset.value === currentDuration)
  if (known) return DURATION_PRESETS
  return [...DURATION_PRESETS, { value: currentDuration, label: `Custom (${formatMinutes(currentDuration)})` }]
}

// ---- Day-grid layout ----

export function assignLanes(entries) {
  const sorted = [...entries].sort(
    (a, b) =>
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time) ||
      timeToMinutes(a.end_time) - timeToMinutes(b.end_time)
  )
  const laneEnds = []
  const placed = []
  for (const entry of sorted) {
    const start = timeToMinutes(entry.start_time)
    let lane = laneEnds.findIndex((end) => end <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = timeToMinutes(entry.end_time)
    placed.push({ entry, lane })
  }
  return { placed, laneCount: Math.max(1, laneEnds.length) }
}

export function blockGeometry(startTime, endTime) {
  const span = GRID_END_MINUTES - GRID_START_MINUTES
  const clamp = (minutes) => Math.min(Math.max(minutes, GRID_START_MINUTES), GRID_END_MINUTES)
  const start = clamp(timeToMinutes(startTime))
  const end = clamp(timeToMinutes(endTime))
  let leftPct = ((start - GRID_START_MINUTES) / span) * 100
  let widthPct = ((end - start) / span) * 100
  if (widthPct < MIN_BLOCK_PCT) {
    widthPct = MIN_BLOCK_PCT
    if (leftPct + widthPct > 100) leftPct = 100 - widthPct
  }
  return { leftPct, widthPct }
}

// ---- jobs and entries ----

export function classifyUnscheduled(job) {
  const entries = job.schedule_entries ?? []
  const tentativeCount = entries.filter((entry) => entry.status === 'tentative').length

  if (job.status === 'Quote') {
    const hasInspection = entries.some(
      (entry) => entry.entry_type === 'inspection' && entry.status === 'confirmed'
    )
    return hasInspection ? null : { label: 'Needs inspection', tentativeCount }
  }

  if (job.status === 'Work Order' || job.status === 'Scheduled') {
    const hasWork = entries.some((entry) => entry.entry_type === 'work' && entry.status === 'confirmed')
    return hasWork ? null : { label: 'Needs work scheduling', tentativeCount }
  }

  return null
}

export function entryContext(entry, jobEntries, jobStatus) {
  const otherTentative = jobEntries.filter(
    (other) => other.status === 'tentative' && other.entry_type === entry.entry_type && other.id !== entry.id
  ).length
  const otherConfirmedWork = jobEntries.some(
    (other) => other.id !== entry.id && other.entry_type === 'work' && other.status === 'confirmed'
  )
  const revertsToWorkOrder =
    entry.entry_type === 'work' &&
    entry.status === 'confirmed' &&
    !otherConfirmedWork &&
    jobStatus === 'Scheduled'
  return { otherTentative, revertsToWorkOrder }
}

export function entryTypeLabel(entry) {
  return entry.entry_type === 'inspection' ? 'Inspection' : 'Work'
}

export function entryStatusLabel(entry) {
  return entry.status === 'tentative' ? 'Tentative' : 'Confirmed'
}

export function entryTags(entry) {
  const tags = [entryTypeLabel(entry)]
  if (entry.status === 'tentative') tags.push('Tentative')
  return tags
}

export function compareEntries(a, b) {
  return `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`)
}

// ---- result messages (built from the real result, never predicted) ----

function withStatusChange(text, statusBefore, statusAfter) {
  return statusBefore && statusAfter && statusBefore !== statusAfter
    ? `${text} The job is now ${statusAfter}.`
    : text
}

export function describeBooked(entry, statusBefore, statusAfter) {
  let text
  if (entry.status === 'tentative') {
    text =
      entry.entry_type === 'inspection'
        ? 'Booked as a tentative inspection candidate.'
        : 'Booked as a tentative hold.'
  } else if (entry.entry_type === 'inspection') {
    text = 'Booked as a confirmed inspection.'
  } else {
    text = 'Booked and confirmed.'
  }
  return withStatusChange(text, statusBefore, statusAfter)
}

export function describeConfirmed(statusBefore, statusAfter) {
  return withStatusChange('Booking confirmed.', statusBefore, statusAfter)
}

export function describeRemoved(statusBefore, statusAfter) {
  return withStatusChange('Booking removed.', statusBefore, statusAfter)
}
