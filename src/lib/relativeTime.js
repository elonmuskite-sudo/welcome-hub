// Pure timestamp formatting for feed posts and comments. Kept free of any
// Supabase/React import so both the browser bundle and the Node test runner can
// load it directly.

const MINUTE = 60000
const HOUR = 3600000
const DAY = 86400000
const WEEK = 7 * DAY
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

// Compact age for narrow surfaces such as the chat contact list, where the full
// sentence form ("2 hours ago") would push the snippet out of the row. Anything
// older than a week falls back to a calendar date.
export function formatChatTimestamp(dateString, now = Date.now()) {
  const time = toTime(dateString)
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, now - time)
  if (diff < 45000) return 'now'

  const minutes = Math.floor(diff / MINUTE)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`

  const date = new Date(time)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return `${Math.floor(diff / HOUR)}h ago`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  if (diff < WEEK) return WEEKDAYS[date.getDay()]
  if (date.getFullYear() === today.getFullYear()) return `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

// Exact posting timestamp, shown next to the relative age so members and admins
// always see when a post was really created.
export function formatExactTime(dateString) {
  const time = toTime(dateString)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
