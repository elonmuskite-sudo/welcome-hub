const PREFIX = 'nexus:v1:'
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏']
export const CALL_HISTORY_OUTCOMES = ['completed', 'missed', 'declined', 'busy', 'cancelled', 'failed']

export function encodeReply(text, reply) {
  return reply ? PREFIX + JSON.stringify({ kind: 'reply', text, reply: { id: reply.id, preview: reply.content.slice(0, 160) } }) : text
}

export function decodeContent(content) {
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) return { text: content || '' }
  try {
    const value = JSON.parse(content.slice(PREFIX.length))
    if (value.kind === 'reply' && typeof value.text === 'string' && typeof value.reply?.id === 'string') return { text: value.text, reply: value.reply }
  } catch { /* Legacy text remains readable. */ }
  return { text: content }
}

export function reactionContent(messageId, emoji, active) {
  if (!messageId || !REACTIONS.includes(emoji)) throw new Error('Choose a valid message reaction.')
  return JSON.stringify({ messageId, emoji, active: Boolean(active) })
}

// Delivery/read receipts ride the message stream as `type: 'receipt'` rows, the
// same way reactions do, so no schema change is required. `read` supersedes
// `delivered`, and a receipt carries the ids it covers so one row can acknowledge
// a whole batch of messages.
export const RECEIPT_STATUSES = ['delivered', 'read']

export function receiptContent(messageIds, status) {
  if (!RECEIPT_STATUSES.includes(status)) throw new Error('Unsupported receipt status.')
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).map(String).filter(Boolean))]
  if (ids.length === 0) throw new Error('A receipt needs at least one message id.')
  return JSON.stringify({ messageIds: ids, status })
}

export function encodeCallHistory(event) {
  if (!event || typeof event.callId !== 'string' || !event.callId.trim()
    || !CALL_HISTORY_OUTCOMES.includes(event.outcome)
    || !Number.isSafeInteger(event.duration) || event.duration < 0) {
    throw new Error('Call history details are invalid.')
  }
  return PREFIX + JSON.stringify({
    kind: 'call',
    callId: event.callId,
    outcome: event.outcome,
    duration: event.duration,
    startedAt: typeof event.startedAt === 'string' ? event.startedAt : null,
    endedAt: typeof event.endedAt === 'string' ? event.endedAt : null,
  })
}

export function decodeCallHistory(content) {
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) return null
  try {
    const event = JSON.parse(content.slice(PREFIX.length))
    if (event.kind !== 'call'
      || typeof event.callId !== 'string' || !event.callId
      || !CALL_HISTORY_OUTCOMES.includes(event.outcome)
      || !Number.isSafeInteger(event.duration) || event.duration < 0) return null
    return {
      callId: event.callId,
      outcome: event.outcome,
      duration: event.duration,
      startedAt: typeof event.startedAt === 'string' ? event.startedAt : null,
      endedAt: typeof event.endedAt === 'string' ? event.endedAt : null,
    }
  } catch {
    return null
  }
}

export function callHistoryLabel(event, isOutgoing) {
  if (!event) return 'Voice call'
  if (event.outcome === 'completed') return isOutgoing ? 'Outgoing voice call' : 'Incoming voice call'
  if (event.outcome === 'missed') return isOutgoing ? 'Outgoing call · No answer' : 'Missed call'
  if (event.outcome === 'declined') return isOutgoing ? 'Outgoing call · Declined' : 'Declined incoming call'
  if (event.outcome === 'busy') return isOutgoing ? 'Outgoing call · Contact busy' : 'Call unavailable'
  if (event.outcome === 'cancelled') return isOutgoing ? 'Cancelled outgoing call' : 'Cancelled call'
  return isOutgoing ? 'Outgoing call failed' : 'Incoming call failed'
}

export function callHistoryOutcome(call, error = '') {
  if (call?.startedAt) return 'completed'
  const reason = String(error || '').toLowerCase()
  if (reason.includes('missed') || reason.includes('no answer')) return 'missed'
  if (reason.includes('declined')) return 'declined'
  if (reason.includes('busy') || reason.includes('already on a call')) return 'busy'
  return reason ? 'failed' : 'cancelled'
}

export function resolveMessages(messages) {
  const reactions = new Map()
  // messageId -> { delivered: Set<readerId>, read: Set<readerId> }
  const receipts = new Map()
  const ordered = [...messages].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  for (const message of ordered) {
    if (message.type === 'reaction') {
      try {
        const event = JSON.parse(message.content)
        if (!REACTIONS.includes(event.emoji) || typeof event.messageId !== 'string' || typeof event.active !== 'boolean') continue
        const key = `${event.messageId}:${message.sender_id}:${event.emoji}`
        reactions.set(key, { ...event, userId: String(message.sender_id) })
      } catch { /* Ignore malformed reaction events. */ }
      continue
    }
    if (message.type === 'receipt') {
      try {
        const event = JSON.parse(message.content)
        if (!RECEIPT_STATUSES.includes(event.status) || !Array.isArray(event.messageIds)) continue
        const reader = String(message.sender_id)
        for (const id of event.messageIds) {
          const key = String(id)
          const entry = receipts.get(key) || { delivered: new Set(), read: new Set() }
          entry[event.status].add(reader)
          receipts.set(key, entry)
        }
      } catch { /* Ignore malformed receipt events. */ }
    }
  }
  return ordered
    .filter(message => message.type !== 'reaction' && message.type !== 'receipt')
    .map(message => {
      const entry = receipts.get(String(message.id))
      return {
        ...message,
        reactions: [...reactions.values()].filter(event => event.messageId === message.id && event.active),
        delivered: Boolean(entry && (entry.delivered.size || entry.read.size)),
        read: Boolean(entry && entry.read.size),
      }
    })
}