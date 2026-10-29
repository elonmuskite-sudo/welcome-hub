// Pure helpers that turn a chat row into the contact-list preview: the contact's
// name, a one-line snippet of the most recent message sent to the viewer, and a
// relative age. Kept free of React/Supabase imports so the browser bundle and
// the Node test runner can both load it directly (see lib/relativeTime.js).

import { decodeContent } from './chatProtocol.js'
import { formatChatTimestamp } from './relativeTime.js'

// Long messages are clipped before they reach the DOM; the row also relies on
// CSS `truncate`, which narrows further on small screens.
export const SNIPPET_MAX = 160
export const EMPTY_SNIPPET = 'No messages yet'

// Media and attachment rows carry no readable body, so they get a label instead.
const TYPE_LABELS = {
  image: 'Photo',
  video: 'Video',
  voice: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
  file: 'Attachment',
}

export function peerIdOf(chat, myId) {
  const ids = (chat?.participant_ids || []).map(String).filter((id) => id !== String(myId || ''))
  return ids.length === 1 ? ids[0] : null
}

export function participantNamesFor(firstId, firstName, secondId, secondName) {
  const names = {}
  if (firstId && typeof firstName === 'string' && firstName.trim()) names[String(firstId)] = firstName.trim()
  if (secondId && typeof secondName === 'string' && secondName.trim()) names[String(secondId)] = secondName.trim()
  return Object.keys(names).length ? names : null
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// participant_names is a JSONB column that some paths hand back as an object and
// Appwrite returns as a JSON string, and rows written before the field existed
// carry null. Normalising once here keeps every caller free of shape guessing.
export function participantNames(chat) {
  let value = chat?.participant_names
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const names = {}
  for (const [id, name] of Object.entries(value)) {
    const cleaned = cleanName(name)
    if (cleaned) names[String(id)] = cleaned
  }
  return Object.keys(names).length ? names : null
}

// Resolves the conversation name from the viewer's perspective: a 1:1 chat is
// shown as the *other* participant. Falls back to the stored title for groups or
// chats created before participant names were recorded, and never shows a viewer
// their own name — a 1:1 conversation is materialised by its creator under the
// recipient's name, so the recipient would otherwise see themselves.
export function chatDisplayName(chat, viewerId) {
  const names = participantNames(chat)
  const peerId = peerIdOf(chat, viewerId)
  const viewerKey = viewerId == null ? '' : String(viewerId)

  if (names) {
    if (peerId && names[peerId]) return names[peerId]
    // No usable participant_ids (older rows): a two-person name map still tells
    // us the counterpart when exactly one entry is not the viewer.
    const others = Object.keys(names).filter((id) => id !== viewerKey)
    if (others.length === 1) return names[others[0]]
  }

  const title = cleanName(chat?.title)
  const ownName = viewerKey ? cleanName(names?.[viewerKey]) : ''
  if (title && ownName && title === ownName) {
    const peerName = peerId ? cleanName(names?.[peerId]) : ''
    return peerName || 'Chat'
  }
  return title || 'Chat'
}

// Reactions and receipts ride the message stream as protocol control rows: they
// are real messages, but they must never become a conversation preview.
export function isPreviewableMessage(message) {
  return Boolean(message) && message.type !== 'reaction' && message.type !== 'receipt' && message.type !== 'call'
}

// Collapses runs of whitespace so a multi-line message stays on one readable line.
export function normalizeSnippet(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
}

export function truncateSnippet(text, max = SNIPPET_MAX) {
  const value = normalizeSnippet(text)
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

// The readable body of a message: decoded text, or a label for media that has
// no caption. Ciphertext is never shown — encrypted messages render as a notice.
export function messageSnippet(message) {
  if (!message) return ''
  if (message.encrypted) return 'Encrypted message'
  const text = normalizeSnippet(decodeContent(message.content).text)
  if (text) return text
  return TYPE_LABELS[message.type] || ''
}

// The message a row should preview. Prefers the summary persisted on the chat
// (kept in step by the sync workflow) and falls back to the newest previewable
// message still resident in the cached thread.
export function resolveLastMessage(chat) {
  if (!chat) return null
  if (chat.last_message || chat.last_message_time) {
    return {
      content: chat.last_message || '',
      created_at: chat.last_message_time || null,
      sender_id: chat.last_message_sender_id || null,
      type: chat.last_message_type || 'text',
      encrypted: Boolean(chat.last_message_encrypted),
    }
  }
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isPreviewableMessage(messages[index])) return messages[index]
  }
  return null
}

export function chatListPreview(chat, viewerId, now = Date.now()) {
  const last = resolveLastMessage(chat)
  const body = messageSnippet(last)
  const viewerKey = viewerId == null ? '' : String(viewerId)
  const senderId = last?.sender_id ? String(last.sender_id) : ''
  const sentByViewer = Boolean(body && senderId && viewerKey && senderId === viewerKey)
  // The sender of the previewed message, resolved from the same stored name map
  // the row title uses. Only surfaced by the view when it adds information the
  // title does not already carry (the viewer, or a sender other than the title).
  const senderName = sentByViewer ? 'You' : (senderId ? cleanName(participantNames(chat)?.[senderId]) : '')
  return {
    name: chatDisplayName(chat, viewerId),
    snippet: body ? truncateSnippet(body) : EMPTY_SNIPPET,
    hasHistory: Boolean(body),
    // Only the viewer's own messages need a prefix; the row title already names
    // the contact for everything they sent.
    sentByViewer,
    senderName,
    timeLabel: last?.created_at ? formatChatTimestamp(last.created_at, now) : '',
  }
}
