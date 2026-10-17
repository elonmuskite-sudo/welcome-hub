import { formatExactTime, formatTimeAgo } from '../lib/relativeTime'

// Shows both halves of a post/comment timestamp: the live relative age and the
// exact time it was created. `now` comes from a single shared clock (useNow) so
// the relative text refreshes on its own.
export default function FeedTimestamp({ createdAt, now, className = '', edited = false }) {
  const exact = formatExactTime(createdAt)
  const date = new Date(createdAt)
  if (!exact || Number.isNaN(date.getTime())) return null

  return (
    <span className={className} title={`Posted ${exact}`}>
      <time dateTime={date.toISOString()}>{formatTimeAgo(createdAt, now)}</time>
      <span aria-hidden="true"> · </span>
      <span>{exact}</span>
      {edited && <span> · edited</span>}
    </span>
  )
}
