import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { ICE_SERVERS } from './callIce'
import { notifyCallPush } from './callPush'
import { sendChatMessage, newId } from './persistence'
import {
  CALL_EVENTS,
  buildRingPayload,
  callChannelName,
  createCallId,
  inboxChannelName,
  isBroadcastAcknowledged,
  matchesCall,
} from './callSignaling'
import { CALL_HISTORY_OUTCOMES, callHistoryOutcome, encodeCallHistory } from './chatProtocol'

const RING_TIMEOUT_MS = 45000
const CONNECTION_TIMEOUT_MS = 30000
const DISCONNECT_GRACE_MS = 8000
const ENDED_DISMISS_MS = 2500
const SUBSCRIBE_TIMEOUT_MS = 8000
const SEND_LINGER_MS = 1500
const AUDIO_ELEMENT_ID = 'nexus-remote-audio'

const INACTIVE_CALL_API = {
  call: null,
  isAvailable: false,
  initiateCall: async () => {},
  acceptCall: async () => {},
  declineCall: () => {},
  endCall: () => {},
  toggleMute: () => {},
}

// Reuse one context across hot reloads so the provider and consumers never split.
const CallContext = globalThis.__nexusCallContext || (globalThis.__nexusCallContext = createContext(INACTIVE_CALL_API))

export function useCall() {
  return useContext(CallContext) || INACTIVE_CALL_API
}

function subscribeChannel(channel) {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId
    const finish = (status) => {
      if (settled) return
      settled = true
      if (timeoutId) window.clearTimeout(timeoutId)
      resolve(status)
    }
    try {
      channel.subscribe((status) => {
        if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) finish(status)
      })
    } catch {
      finish('CHANNEL_ERROR')
    }
    if (!settled && typeof window !== 'undefined') {
      timeoutId = window.setTimeout(() => finish('TIMED_OUT'), SUBSCRIBE_TIMEOUT_MS)
    }
  })
}

async function sendBroadcast(channel, event, payload) {
  if (!channel) return false
  try {
    const status = await channel.send({ type: 'broadcast', event, payload })
    return isBroadcastAcknowledged(status)
  } catch (error) {
    console.error(`Realtime call signal "${event}" failed`, error)
    return false
  }
}

// A short-lived channel pointed at one user's inbox. Realtime broadcast is not
// replayed, so the channel must be fully subscribed before the message is sent
// and kept alive briefly afterwards for it to flush.
async function sendInbox(peerId, event, payload) {
  const name = inboxChannelName(peerId)
  if (!supabase || !name || typeof window === 'undefined') return false
  const channel = supabase.channel(name, { config: { broadcast: { ack: true, self: false } } })
  const status = await subscribeChannel(channel)
  let delivered = false
  if (status === 'SUBSCRIBED') {
    delivered = await sendBroadcast(channel, event, payload)
  }
  window.setTimeout(() => {
    try { supabase.removeChannel(channel) } catch { /* channel already gone */ }
  }, SEND_LINGER_MS)
  return delivered
}

// iOS only unlocks media playback from inside a user gesture; a no-op play on
// the (still empty) audio element unlocks it for the remote stream arriving later.
function primeAudio() {
  const audio = document.getElementById(AUDIO_ELEMENT_ID)
  audio?.play?.().catch(() => {})
}

/**
 * App-wide voice calling.
 *
 * Signalling rides on Supabase Realtime broadcast channels (no third-party
 * service and no per-minute cap): a per-user inbox carries call control so the
 * app can ring anywhere, and a per-call channel carries the WebRTC handshake.
 * Media flows peer-to-peer, falling back to a TURN relay when one is configured.
 */
export function CallProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ? String(user.id) : null

  const [call, setCall] = useState(null)
  const callRef = useRef(null)
  const userIdRef = useRef(userId)
  const pcRef = useRef(null)
  const streamRef = useRef(null)
  const callChannelRef = useRef(null)
  const pendingIceRef = useRef([])
  const remoteSetRef = useRef(false)
  const durationTimerRef = useRef(null)
  const ringTimerRef = useRef(null)
  const connectionTimerRef = useRef(null)
  const disconnectTimerRef = useRef(null)
  const dismissTimerRef = useRef(null)
  const pendingIncomingCallsRef = useRef(new Set())
  const recordedCallIdsRef = useRef(new Set())

  userIdRef.current = userId

  const setCallState = useCallback((next) => {
    callRef.current = next
    setCall(next)
  }, [])

  const patchCall = useCallback((patch) => {
    const current = callRef.current
    if (!current) return
    callRef.current = { ...current, ...patch }
    setCall(callRef.current)
  }, [])

  const cleanupMedia = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.clearTimeout(ringTimerRef.current)
      window.clearTimeout(connectionTimerRef.current)
      window.clearTimeout(disconnectTimerRef.current)
      window.clearTimeout(dismissTimerRef.current)
      window.clearInterval(durationTimerRef.current)
    }
    ringTimerRef.current = null
    connectionTimerRef.current = null
    disconnectTimerRef.current = null
    dismissTimerRef.current = null
    durationTimerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const pc = pcRef.current
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      try { pc.close() } catch { /* already closed */ }
      pcRef.current = null
    }
    pendingIceRef.current = []
    remoteSetRef.current = false
    if (typeof document !== 'undefined') {
      const audio = document.getElementById(AUDIO_ELEMENT_ID)
      if (audio) audio.srcObject = null
    }
    const channel = callChannelRef.current
    if (channel) {
      try { supabase?.removeChannel(channel) } catch { /* already removed */ }
      callChannelRef.current = null
    }
  }, [])

  // Ends the local call. `notify` tells the other side; remote-initiated endings
  // pass false so two clients cannot bounce a hangup back and forth.
  const endCallInternal = useCallback((patch = {}, notify = true) => {
    const current = callRef.current
    if (!current || current.state === 'ended') return
    const error = patch.error ?? current.error
    const outcome = current.startedAt
      ? 'completed'
      : CALL_HISTORY_OUTCOMES.includes(patch.outcome)
        ? patch.outcome
        : callHistoryOutcome(current, error)
    if (notify) sendInbox(current.peerId, CALL_EVENTS.HANGUP, { callId: current.id, outcome })
    if (current.direction === 'outgoing' && current.chatId && userIdRef.current
      && !recordedCallIdsRef.current.has(current.id)) {
      recordedCallIdsRef.current.add(current.id)
      const endedAt = new Date().toISOString()
      const duration = current.startedAt
        ? Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000))
        : 0
      void sendChatMessage(current.chatId, {
        id: newId(),
        sender_id: userIdRef.current,
        type: 'call',
        content: encodeCallHistory({
          callId: current.id,
          outcome,
          duration,
          startedAt: current.startedAt ? new Date(current.startedAt).toISOString() : null,
          endedAt,
        }),
        duration,
        encrypted: false,
        created_at: endedAt,
      }).catch((historyError) => {
        console.error('Could not save call history to the conversation.', historyError)
      })
    }
    cleanupMedia()
    setCallState({ ...current, state: 'ended', ...patch, error })
    if (typeof window !== 'undefined') {
      dismissTimerRef.current = window.setTimeout(() => {
        if (callRef.current?.state === 'ended') setCallState(null)
      }, ENDED_DISMISS_MS)
    }
  }, [cleanupMedia, setCallState])

  const markConnected = useCallback(() => {
    const current = callRef.current
    if (!current || current.state === 'connected') return
    if (typeof window !== 'undefined') {
      window.clearTimeout(ringTimerRef.current)
      window.clearTimeout(connectionTimerRef.current)
      window.clearTimeout(disconnectTimerRef.current)
      window.clearInterval(durationTimerRef.current)
    }
    ringTimerRef.current = null
    const startedAt = Date.now()
    callRef.current = { ...current, state: 'connected', error: '', startedAt, duration: 0 }
    setCall(callRef.current)
    if (typeof window === 'undefined') return
    durationTimerRef.current = window.setInterval(() => {
      const active = callRef.current
      if (!active || active.state !== 'connected') return
      patchCall({ duration: Math.floor((Date.now() - active.startedAt) / 1000) })
    }, 1000)
  }, [patchCall])

  const startConnectionTimer = useCallback((callId) => {
    if (typeof window === 'undefined') return
    window.clearTimeout(connectionTimerRef.current)
    connectionTimerRef.current = window.setTimeout(() => {
      if (callRef.current?.id === callId && callRef.current.state === 'connecting') {
        endCallInternal({ error: 'The call could not connect. Check your network and try again.' })
      }
    }, CONNECTION_TIMEOUT_MS)
  }, [endCallInternal])

  const ensureStream = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    streamRef.current = stream
    return stream
  }, [])

  const createPeerConnection = useCallback(async () => {
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice calls are not supported in this browser.')
    }
    const stream = await ensureStream()
    const pc = new RTCPeerConnection(ICE_SERVERS)
    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      const activeCallId = callRef.current?.id
      sendBroadcast(callChannelRef.current, CALL_EVENTS.ICE, {
        callId: activeCallId,
        candidate: event.candidate,
      }).then((sent) => {
        if (!sent) console.error('Realtime ICE candidate was not acknowledged')
      })
    }
    pc.ontrack = (event) => {
      const audio = document.getElementById(AUDIO_ELEMENT_ID)
      if (!audio) return
      audio.srcObject = event.streams[0]
      audio.play?.().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (typeof window !== 'undefined') window.clearTimeout(disconnectTimerRef.current)
        disconnectTimerRef.current = null
        markConnected()
      }
      else if (pc.connectionState === 'failed') endCallInternal({ error: 'The call connection failed' })
      else if (pc.connectionState === 'disconnected' && typeof window !== 'undefined') {
        if (disconnectTimerRef.current) return
        const disconnectedCallId = callRef.current?.id
        disconnectTimerRef.current = window.setTimeout(() => {
          disconnectTimerRef.current = null
          if (pcRef.current === pc && callRef.current?.id === disconnectedCallId && pc.connectionState === 'disconnected') {
            endCallInternal({ error: 'The call connection was lost' })
          }
        }, DISCONNECT_GRACE_MS)
      }
    }
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    pcRef.current = pc
    return pc
  }, [ensureStream, markConnected, endCallInternal])

  const flushIce = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !remoteSetRef.current) return
    const queued = pendingIceRef.current
    pendingIceRef.current = []
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate) } catch { /* stale candidate */ }
    }
  }, [])

  // Callee side of the handshake.
  const handleOffer = useCallback(async (payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current)) return
    try {
      const pc = await createPeerConnection()
      await pc.setRemoteDescription(payload.sdp)
      remoteSetRef.current = true
      await flushIce()
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      const sent = await sendBroadcast(callChannelRef.current, CALL_EVENTS.ANSWER, {
        callId: current.id,
        sdp: pc.localDescription,
      })
      if (!sent) throw new Error('The call answer was not acknowledged')
    } catch {
      endCallInternal({ error: 'The call could not be answered' })
    }
  }, [createPeerConnection, flushIce, endCallInternal])

  // Caller side of the handshake.
  const handleAnswer = useCallback(async (payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current) || !pcRef.current) return
    try {
      await pcRef.current.setRemoteDescription(payload.sdp)
      remoteSetRef.current = true
      await flushIce()
    } catch {
      endCallInternal({ error: 'The call could not be established' })
    }
  }, [flushIce, endCallInternal])

  const handleIce = useCallback((payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current) || !payload.candidate) return
    if (!pcRef.current || !remoteSetRef.current) {
      pendingIceRef.current.push(payload.candidate)
      return
    }
    pcRef.current.addIceCandidate(payload.candidate).catch(() => {})
  }, [])

  const bindCallChannel = useCallback((channel) => {
    channel
      .on('broadcast', { event: CALL_EVENTS.OFFER }, ({ payload }) => { handleOffer(payload) })
      .on('broadcast', { event: CALL_EVENTS.ANSWER }, ({ payload }) => { handleAnswer(payload) })
      .on('broadcast', { event: CALL_EVENTS.ICE }, ({ payload }) => { handleIce(payload) })
  }, [handleOffer, handleAnswer, handleIce])

  const openCallChannel = useCallback(async (callId) => {
    if (!supabase) return null
    const channel = supabase.channel(callChannelName(callId), { config: { broadcast: { ack: true, self: false } } })
    bindCallChannel(channel)
    const status = await subscribeChannel(channel)
    if (status !== 'SUBSCRIBED') {
      try { supabase.removeChannel(channel) } catch { /* already removed */ }
      return null
    }
    callChannelRef.current = channel
    return channel
  }, [bindCallChannel])

  const startOffer = useCallback(async (callId) => {
    try {
      const pc = await createPeerConnection()
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sent = await sendBroadcast(callChannelRef.current, CALL_EVENTS.OFFER, {
        callId,
        sdp: pc.localDescription,
      })
      if (!sent) throw new Error('The call offer was not acknowledged')
    } catch {
      endCallInternal({ error: 'Could not start the call. Check microphone access and your connection.' })
    }
  }, [createPeerConnection, endCallInternal])

  // ---- Caller (outgoing) ----

  const initiateCall = useCallback(async (target = {}) => {
    const peerId = String(target.peerId || '').trim()
    if (!supabase || !userIdRef.current || callRef.current || pendingIncomingCallsRef.current.size || !peerId) return

    const id = createCallId()
    setCallState({
      id,
      chatId: String(target.chatId || ''),
      direction: 'outgoing',
      peerId,
      peerName: target.peerName || 'Contact',
      peerAvatar: target.peerAvatar || null,
      state: 'ringing',
      error: '',
      muted: false,
      startedAt: null,
      duration: 0,
    })
    primeAudio()

    const channel = await openCallChannel(id)
    if (!channel) {
      endCallInternal({ error: 'Realtime calling is unavailable. Check your connection and try again.' }, false)
      return
    }

    const expiresAt = Date.now() + RING_TIMEOUT_MS
    const delivered = await sendInbox(peerId, CALL_EVENTS.RING, buildRingPayload({
      callId: id,
      chatId: target.chatId,
      expiresAt,
      caller: {
        id: userIdRef.current,
        name: user?.fullName || user?.firstName || user?.email,
        avatar: user?.avatarUrl,
      },
    }))
    if (!delivered) {
      endCallInternal({ error: 'That contact could not be reached' })
      return
    }
    void notifyCallPush({ chatId: target.chatId, callId: id, expiresAt }).catch((error) => {
      console.error('Background call notification was not delivered.', error)
    })

    if (typeof window !== 'undefined') {
      ringTimerRef.current = window.setTimeout(() => {
        if (callRef.current?.id === id && callRef.current.state === 'ringing') endCallInternal({ error: 'No answer' })
      }, Math.max(0, expiresAt - Date.now()))
    }
  }, [openCallChannel, setCallState, endCallInternal, user])

  // ---- Callee (incoming) ----

  const handleRing = useCallback(async (payload) => {
    if (!payload?.callId || !payload.fromUserId) return
    const expiresAt = payload.expiresAt == null ? null : Number(payload.expiresAt)
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) return
    if (callRef.current?.id === String(payload.callId) || pendingIncomingCallsRef.current.has(String(payload.callId))) return
    if (callRef.current || pendingIncomingCallsRef.current.size > 0) {
      sendInbox(payload.fromUserId, CALL_EVENTS.BUSY, { callId: payload.callId })
      return
    }
    const incomingId = String(payload.callId)
    pendingIncomingCallsRef.current.add(incomingId)
    try {
      const channel = await openCallChannel(incomingId)
      if (!channel) {
        sendInbox(payload.fromUserId, CALL_EVENTS.DECLINE, { callId: payload.callId })
        return
      }
      if (callRef.current) {
        sendInbox(payload.fromUserId, CALL_EVENTS.BUSY, { callId: payload.callId })
        if (callChannelRef.current === channel) callChannelRef.current = null
        try { await supabase?.removeChannel(channel) } catch { /* channel already removed */ }
        return
      }
      const ringDuration = expiresAt === null
        ? RING_TIMEOUT_MS
        : Math.min(RING_TIMEOUT_MS, expiresAt - Date.now())
      if (ringDuration <= 0) {
        if (callChannelRef.current === channel) callChannelRef.current = null
        try { await supabase?.removeChannel(channel) } catch { /* channel already removed */ }
        return
      }
      setCallState({
        id: incomingId,
        chatId: String(payload.chatId || ''),
        direction: 'incoming',
        peerId: String(payload.fromUserId),
        peerName: payload.fromName || 'Contact',
        peerAvatar: payload.fromAvatar || null,
        state: 'ringing',
        error: '',
        muted: false,
        startedAt: null,
        duration: 0,
      })
      if (typeof window !== 'undefined') {
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current?.id === incomingId && callRef.current.state === 'ringing') {
            endCallInternal({ error: 'Missed call' })
          }
        }, ringDuration)
      }
    } finally {
      pendingIncomingCallsRef.current.delete(incomingId)
    }
  }, [openCallChannel, setCallState, endCallInternal])

  // A push notification click reopens the call route with the signed payload
  // in the query string so the callee can rejoin the ephemeral Realtime topic.
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const callId = url.searchParams.get('incomingCall')
    const expiresAt = Number(url.searchParams.get('expiresAt'))
    const fromUserId = url.searchParams.get('fromUserId')
    const fromName = url.searchParams.get('fromName') || 'Contact'
    const fromAvatar = url.searchParams.get('fromAvatar') || null
    const chatId = url.pathname.match(/^\/app\/chat\/([^/]+)/)?.[1]
    if (!callId || !fromUserId || !chatId) return
    url.searchParams.delete('incomingCall')
    url.searchParams.delete('expiresAt')
    url.searchParams.delete('fromUserId')
    url.searchParams.delete('fromName')
    url.searchParams.delete('fromAvatar')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
    void handleRing({
      callId,
      chatId,
      fromUserId,
      fromName,
      fromAvatar,
      expiresAt,
    })
  }, [userId, handleRing])

  const handleReady = useCallback(async (payload) => {
    const current = callRef.current
    if (!current || current.direction !== 'outgoing' || !matchesCall(payload, current)) return
    if (typeof window !== 'undefined') window.clearTimeout(ringTimerRef.current)
    ringTimerRef.current = null
    patchCall({ state: 'connecting', error: '' })
    startConnectionTimer(current.id)
    await startOffer(current.id)
  }, [patchCall, startOffer, startConnectionTimer])

  const handleDecline = useCallback((payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current)) return
    endCallInternal({ error: 'Call declined' })
  }, [endCallInternal])

  const handleBusy = useCallback((payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current)) return
    endCallInternal({ error: 'That contact is already on a call' })
  }, [endCallInternal])

  const handleHangup = useCallback((payload) => {
    const current = callRef.current
    if (!current || !matchesCall(payload, current)) return
    endCallInternal({
      error: '',
      outcome: typeof payload.outcome === 'string' ? payload.outcome : undefined,
    }, false)
  }, [endCallInternal])

  // Always-on inbox so a call can ring on any page while signed in.
  useEffect(() => {
    if (!supabase || !userId) return undefined
    const channel = supabase.channel(inboxChannelName(userId), { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: CALL_EVENTS.RING }, ({ payload }) => { handleRing(payload) })
      .on('broadcast', { event: CALL_EVENTS.READY }, ({ payload }) => { handleReady(payload) })
      .on('broadcast', { event: CALL_EVENTS.DECLINE }, ({ payload }) => { handleDecline(payload) })
      .on('broadcast', { event: CALL_EVENTS.BUSY }, ({ payload }) => { handleBusy(payload) })
      .on('broadcast', { event: CALL_EVENTS.HANGUP }, ({ payload }) => { handleHangup(payload) })
      .subscribe()

    return () => {
      try { supabase.removeChannel(channel) } catch { /* already removed */ }
      cleanupMedia()
      setCallState(null)
    }
  }, [userId, handleRing, handleReady, handleDecline, handleBusy, handleHangup, cleanupMedia, setCallState])

  // ---- Public API ----

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (!current || current.direction !== 'incoming' || current.state !== 'ringing') return
    if (typeof window !== 'undefined') window.clearTimeout(ringTimerRef.current)
    ringTimerRef.current = null
    patchCall({ state: 'connecting', error: '' })
    startConnectionTimer(current.id)
    primeAudio()
    try {
      await ensureStream()
    } catch {
      sendInbox(current.peerId, CALL_EVENTS.DECLINE, { callId: current.id })
      endCallInternal({ error: 'Microphone access is required to take the call' })
      return
    }
    const sent = await sendInbox(current.peerId, CALL_EVENTS.READY, { callId: current.id })
    if (!sent) endCallInternal({ error: 'Could not signal the caller. Check your connection and try again.' })
  }, [ensureStream, patchCall, endCallInternal, startConnectionTimer])

  const declineCall = useCallback(() => {
    const current = callRef.current
    if (current) sendInbox(current.peerId, CALL_EVENTS.DECLINE, { callId: current.id })
    cleanupMedia()
    setCallState(null)
  }, [cleanupMedia, setCallState])

  const endCall = useCallback(() => {
    endCallInternal({ error: '' })
  }, [endCallInternal])

  const toggleMute = useCallback(() => {
    const current = callRef.current
    const stream = streamRef.current
    if (!current || !stream) return
    const muted = !current.muted
    stream.getAudioTracks().forEach((track) => { track.enabled = !muted })
    patchCall({ muted })
  }, [patchCall])

  const value = useMemo(() => ({
    call,
    isAvailable: Boolean(supabase),
    initiateCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  }), [call, initiateCall, acceptCall, declineCall, endCall, toggleMute])

  return (
    <CallContext.Provider value={value}>
      {children}
      {/* Remote audio output for the active call. Rendered here (not in a chat
          view) so the call keeps playing while the user navigates the app. */}
      <audio id={AUDIO_ELEMENT_ID} autoPlay />
    </CallContext.Provider>
  )
}
