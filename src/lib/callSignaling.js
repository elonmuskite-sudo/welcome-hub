// Signalling vocabulary shared by the caller and the callee. Kept dependency
// free so it can be unit tested (and reasoned about) without React or Supabase.
//
// Two channel kinds are used:
//   * the per-user inbox  (`nexus-call-inbox:<userId>`) carries call control —
//     ring / ready / decline / busy / hangup — so a call can reach a user on any
//     page of the app, and
//   * the per-call channel (`nexus-call:<callId>`) carries the WebRTC handshake —
//     offer / answer / ice — so only the two ends of a call exchange SDP.

export const INBOX_PREFIX = 'nexus-call-inbox:'
export const CALL_PREFIX = 'nexus-call:'

export const CALL_EVENTS = {
  RING: 'ring',
  READY: 'ready',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE: 'ice',
  DECLINE: 'decline',
  BUSY: 'busy',
  HANGUP: 'hangup',
}

export const INBOX_EVENTS = [
  CALL_EVENTS.RING,
  CALL_EVENTS.READY,
  CALL_EVENTS.DECLINE,
  CALL_EVENTS.BUSY,
  CALL_EVENTS.HANGUP,
]

export const CALL_CHANNEL_EVENTS = [
  CALL_EVENTS.OFFER,
  CALL_EVENTS.ANSWER,
  CALL_EVENTS.ICE,
]

function idOf(value) {
  return String(value ?? '').trim()
}

export function inboxChannelName(userId) {
  const id = idOf(userId)
  return id ? `${INBOX_PREFIX}${id}` : ''
}

export function callChannelName(callId) {
  const id = idOf(callId)
  return id ? `${CALL_PREFIX}${id}` : ''
}

// A fresh, unguessable id per call keeps the SDP exchange scoped to the two
// participants even though the channel is public.
export function createCallId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `call-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildRingPayload({ callId, chatId, caller }) {
  return {
    callId: idOf(callId),
    chatId: idOf(chatId),
    fromUserId: idOf(caller?.id),
    fromName: idOf(caller?.name) || 'Nexus user',
    fromAvatar: caller?.avatar || null,
  }
}

// Only accept payloads that describe the call we are currently handling.
export function matchesCall(payload, call) {
  if (!payload || !call) return false
  return Boolean(payload.callId) && payload.callId === call.id
}
