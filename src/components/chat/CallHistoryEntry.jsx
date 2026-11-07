/* eslint-disable react/prop-types */
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react'
import { callHistoryLabel, decodeCallHistory } from '../../lib/chatProtocol'

function formatCallDuration(seconds) {
  const total = Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours
    ? `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(minutes)}:${pad(remainingSeconds)}`
}

function formatCallTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

export default function CallHistoryEntry({ message, userId }) {
  const event = decodeCallHistory(message.content)
  const isOutgoing = String(message.sender_id) === String(userId || '')
  const isMissed = event?.outcome === 'missed' && !isOutgoing
  const Icon = isMissed
    ? PhoneMissed
    : event?.outcome === 'completed'
      ? isOutgoing ? PhoneOutgoing : PhoneIncoming
      : Phone
  const time = formatCallTime(message.created_at)

  return (
    <div id={`message-${message.id}`} className="flex justify-center py-1">
      <div
        role="note"
        className={`flex max-w-full items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-2 text-xs shadow-sm ${
          isMissed ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground">{callHistoryLabel(event, isOutgoing)}</span>
        {event?.outcome === 'completed' && (
          <span className="font-mono tabular-nums">{formatCallDuration(event.duration)}</span>
        )}
        {time && <time dateTime={message.created_at}>{time}</time>}
      </div>
    </div>
  )
}
