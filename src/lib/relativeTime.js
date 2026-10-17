// Pure timestamp formatting for feed posts and comments. Kept free of any
// Supabase/React import so both the browser bundle and the Node test runner can
// load it directly.

const MINUTE = 60000
const HOUR = 3600000
const DAY = 86400000

function plural(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

function toTime(value) {
  if (value === null || value === undefined || value === '') return NaN
  return new Date(value).getTime()
}

// Long-form relative age ("2 hours ago", "3 days ago"). Pass the shared clock
// value so a single interval can refresh every timestamp on the page at once.
export function formatTimeAgo(dateString, now = Date.now()) {
  const time = toTime(dateString)
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, now - time)
  if (diff < 45000) return 'Just now'

  const minutes = Math.round(diff / MINUTE)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`

  const hours = Math.floor(diff / HOUR)
  if (hours < 24) return `${plural(hours, 'hour')} ago`

  const days = Math.floor(diff / DAY)
  if (days < 30) return `${plural(days, 'day')} ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${plural(months, 'month')} ago`

  return `${plural(Math.floor(days / 365), 'year')} ago`
}

// Exact posting timestamp, shown next to the relative age so members and admins
// always see when a post was really created.
export function formatExactTime(dateString) {
  const time = toTime(dateString)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
