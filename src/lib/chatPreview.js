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

// Resolves the conversation name from the viewer's perspective: a 1:1 chat is
// shown as the *other* participant. Falls back to the stored title for groups
// or chats created before participant names were recorded.
export function chatDisplayName(chat, viewerId) {
  const names = chat?.participant_names
  const peerId = peerIdOf(chat, viewerId)
  if (peerId && names && names[peerId]) return names[peerId]
  return chat?.title || 'Chat'
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
  return {
    name: chatDisplayName(chat, viewerId),
    snippet: body ? truncateSnippet(body) : EMPTY_SNIPPET,
    hasHistory: Boolean(body),
    // Only the viewer's own messages need a prefix; the row title already names
    // the contact for everything they sent.
    sentByViewer: Boolean(body && last?.sender_id && viewerId && String(last.sender_id) === String(viewerId)),
    timeLabel: last?.created_at ? formatChatTimestamp(last.created_at, now) : '',
  }
}
