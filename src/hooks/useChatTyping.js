import { useCallback, useEffect, useRef, useState } from 'react'
import { isAppwriteAuthEnabled } from '../lib/appwrite'
import { supabase } from '../lib/supabase'

const TYPING_EXPIRY_MS = 4500
const TYPING_REFRESH_MS = 1800

function sendTypingStatus(channel, userId, typing) {
  try {
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: String(userId), typing: Boolean(typing) },
    }).then((result) => {
      if (result !== 'ok') console.warn('Chat typing status could not be sent:', result)
    }).catch((error) => {
      console.warn('Chat typing status could not be sent:', error)
    })
  } catch (error) {
    console.warn('Chat typing status could not be sent:', error)
  }
}

export function useChatTyping(chatId, userId, enabled = true) {
  const [isPeerTyping, setIsPeerTyping] = useState(false)
  const channelRef = useRef(null)
  const subscribedRef = useRef(false)
  const queuedStatusRef = useRef(null)
  const lastSentAtRef = useRef(0)
  const peerExpiryRef = useRef(null)

  useEffect(() => {
    setIsPeerTyping(false)
    if (!enabled || !chatId || !userId || !supabase || isAppwriteAuthEnabled()) return undefined

    let active = true
    const channel = supabase
      .channel(`nexus-chat-typing:${chatId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!active || String(payload?.userId || '') === String(userId)) return
        if (peerExpiryRef.current) window.clearTimeout(peerExpiryRef.current)

        if (payload?.typing === false) {
          setIsPeerTyping(false)
          peerExpiryRef.current = null
          return
        }
        if (payload?.typing !== true) return

        setIsPeerTyping(true)
        peerExpiryRef.current = window.setTimeout(() => {
          peerExpiryRef.current = null
          setIsPeerTyping(false)
        }, TYPING_EXPIRY_MS)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true
          const queued = queuedStatusRef.current
          if (queued !== null) {
            queuedStatusRef.current = null
            sendTypingStatus(channel, userId, queued)
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Chat typing status is unavailable:', status)
        }
      })

    channelRef.current = channel

    return () => {
      active = false
      subscribedRef.current = false
      queuedStatusRef.current = null
      channelRef.current = null
      if (peerExpiryRef.current) window.clearTimeout(peerExpiryRef.current)
      peerExpiryRef.current = null
      setIsPeerTyping(false)
      void supabase.removeChannel(channel)
    }
  }, [chatId, userId, enabled])

  const setLocalTyping = useCallback((typing) => {
    if (!enabled || !chatId || !userId || !supabase || isAppwriteAuthEnabled()) return

    if (typing) {
      const now = Date.now()
      if (now - lastSentAtRef.current < TYPING_REFRESH_MS) return
      lastSentAtRef.current = now
    } else lastSentAtRef.current = 0

    if (!subscribedRef.current || !channelRef.current) {
      queuedStatusRef.current = Boolean(typing)
      return
    }

    sendTypingStatus(channelRef.current, userId, typing)
  }, [chatId, userId, enabled])

  return { isPeerTyping, setLocalTyping }
}
