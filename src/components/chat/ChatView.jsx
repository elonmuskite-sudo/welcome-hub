/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeftIcon, PhoneIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import Avatar from './Avatar'
import MessageInput from './MessageInput'
import MessageBubble from './MessageBubble'
import { useSetting } from '../../hooks/useSetting'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { getWallpaperById } from '../../lib/wallpapers'
import { encryptMessage, decryptMessage, isE2EEEnabled } from '../../lib/crypto/e2ee'
import { useCall } from '../../lib/CallContext'
import { sendChatMessage, toggleMessageReaction, sendReadReceipt } from '../../lib/persistence'
import { isChatServiceAvailable, newId } from '../../lib/persistence'
import { useAuth } from '../../lib/AuthContext'
import { Search, X, MessageCircle } from 'lucide-react'
import ChatButton from './ChatButton'
import VerificationBadge from './VerificationBadge'
import { peerIdOf, chatDisplayName } from './ChatListItem'
import { resolveMessages, decodeContent, encodeReply } from '../../lib/chatProtocol'

// Single placeholder for any encrypted message we cannot read yet (missing peer
// key or a payload from another key), so pending and failed never look different.
const UNDECRYPTABLE_MESSAGE = '🔒 Encrypted message — unable to decrypt'

// eslint-disable-next-line react/prop-types
export default function ChatView({ chat, onBack, autoStartCall = false }) {
  const [messages, setMessages] = useState(chat?.messages || [])
  const [decryptedMessages, setDecryptedMessages] = useState({})
  const [sendError, setSendError] = useState('')
  const [reply, setReply] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState('')
  const [reacting, setReacting] = useState(false)
  const messagesEndRef = useRef(null)
  // Message ids already attempted in this chat; keeps the decrypt effect from
  // retrying a failure on every render while still allowing a retry after the
  // next realtime refetch brings a fresh message list.
  const decryptAttemptsRef = useRef(new Set())
  const [chatWallpaper] = useSetting('chatWallpaper', 'nature')
  const wallpaper = getWallpaperById(chatWallpaper)
  const [readReceiptsEnabled] = useSetting('readReceipts', true)
  // Highest receipt status already sent for each received message id, so a
  // refetch never re-acknowledges the same message (which would loop).
  const receiptStateRef = useRef(new Map())
  const [threadVisible, setThreadVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')

  // A sync that finishes quickly should not flash a blocking overlay over the
  // thread, so the overlay only appears once syncing has persisted for 250ms.
  const { keys: syncKeys } = useSyncStatus()
  const chatSyncing = syncKeys.includes('chat')
  const [showSyncOverlay, setShowSyncOverlay] = useState(false)
  useEffect(() => {
    if (!chatSyncing) {
      setShowSyncOverlay(false)
      return undefined
    }
    const timer = window.setTimeout(() => setShowSyncOverlay(true), 250)
    return () => window.clearTimeout(timer)
  }, [chatSyncing])

  const { call, initiateCall } = useCall()
  const { user } = useAuth()
  const didAutoStartCall = useRef(false)
  const peerId = peerIdOf(chat, user?.id)

  const startCall = useCallback(() => {
    if (!peerId) return
    initiateCall({
      chatId: chat.id,
      peerId,
      peerName: chatDisplayName(chat, user?.id),
      peerAvatar: chat.avatar_url,
    })
  }, [chat, peerId, user?.id, initiateCall])

  // The number-lookup "Call" action arrives with autoStartCall; fire the call once.
  useEffect(() => {
    if (!autoStartCall || didAutoStartCall.current) return
    didAutoStartCall.current = true
    startCall()
  }, [autoStartCall, startCall])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' })
  }, [])

  useEffect(() => {
    setMessages(chat?.messages || [])
  }, [chat?.id, chat?.messages])

  // Receipt bookkeeping belongs to one conversation only.
  useEffect(() => {
    receiptStateRef.current = new Map()
  }, [chat?.id])

  useEffect(() => {
    const onVisibility = () => setThreadVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Acknowledge messages received from peers: a visible thread means "read",
  // otherwise "delivered". Each id is acknowledged at most once (and only ever
  // upgraded), so a refetch cannot loop, and nothing is sent when the user has
  // turned receipts off.
  useEffect(() => {
    if (!readReceiptsEnabled || !user?.id) return
    const pending = { delivered: [], read: [] }
    for (const message of messages) {
      if (message.type === 'receipt' || message.type === 'reaction') continue
      const sender = String(message.sender_id || '')
      if (!sender || sender === 'me' || sender === String(user.id)) continue
      const alreadySent = receiptStateRef.current.get(message.id)
      if (alreadySent === 'read') continue
      if (threadVisible) {
        receiptStateRef.current.set(message.id, 'read')
        pending.read.push(message.id)
      } else if (!alreadySent) {
        receiptStateRef.current.set(message.id, 'delivered')
        pending.delivered.push(message.id)
      }
    }
    if (!pending.read.length && !pending.delivered.length) return
    ;(async () => {
      try {
        if (pending.read.length) await sendReadReceipt(chat.id, user.id, pending.read, 'read')
        if (pending.delivered.length) await sendReadReceipt(chat.id, user.id, pending.delivered, 'delivered')
      } catch { /* Receipts are best-effort and must not disturb the thread. */ }
    })()
  }, [messages, chat.id, user?.id, readReceiptsEnabled, threadVisible])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const onResize = () => scrollToBottom()
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [scrollToBottom])

  // Cached plaintext and in-flight attempts belong to one conversation only.
  useEffect(() => {
    setDecryptedMessages({})
    decryptAttemptsRef.current = new Set()
  }, [chat?.id])

  // A fresh message list (realtime sync, refetch, or a local append) clears the
  // attempt set so messages that failed before are retried once — never in a loop.
  useEffect(() => {
    decryptAttemptsRef.current = new Set()
  }, [messages])

  useEffect(() => {
    if (!isE2EEEnabled()) return
    const pending = messages.filter((msg) => msg.encrypted && !decryptedMessages[msg.id] && !decryptAttemptsRef.current.has(msg.id))
    if (pending.length === 0) return
    pending.forEach((msg) => decryptAttemptsRef.current.add(msg.id))

    const controller = { cancelled: false }
    ;(async () => {
      const results = await Promise.all(
        pending.map(async (msg) => {
          try {
            return { id: msg.id, text: await decryptMessage(chat.id, msg.content, true) }
          } catch {
            return { id: msg.id, text: null }
          }
        })
      )
      if (controller.cancelled) return
      setDecryptedMessages((prev) => {
        const next = { ...prev }
        // Only successes are cached; failures stay uncached and fall back to the
        // shared placeholder until a later retry succeeds.
        for (const { id, text } of results) if (text != null) next[id] = text
        return next
      })
    })()

    return () => {
      controller.cancelled = true
    }
  }, [messages, chat.id, decryptedMessages])

  const handleSendMessage = useCallback(async (messageData) => {
    setSendError('')
    if (!user?.id) {
      setSendError('Sign in to send messages.')
      return false
    }
    if (!isChatServiceAvailable()) {
      setSendError('Message was not sent: the chat service is unavailable. Please try again when connected.')
      return false
    }

    let content = messageData.content || messageData
    const type = messageData.type || 'text'
    if (type === 'text') content = encodeReply(content, reply)
    let encrypted = false

    if (isE2EEEnabled() && type === 'text') {
      try {
        const result = await encryptMessage(chat.id, content)
        content = result.content
        encrypted = result.encrypted
      } catch (error) {
        setSendError(error?.message || 'Could not encrypt this message.')
        return false
      }
    }

    const newMessage = {
      id: newId(),
      sender_id: String(user.id),
      content,
      type,
      encrypted,
      file_url: messageData.file_url || null,
      file_name: messageData.file_name || null,
      duration: messageData.duration || null,
      created_at: new Date().toISOString(),
    }

    if (encrypted) {
      setDecryptedMessages((prev) => ({
        ...prev,
        [newMessage.id]: encodeReply(messageData.content || messageData, reply),
      }))
    }

    try {
      await sendChatMessage(chat.id, newMessage)
      setReply(null)
      setMessages((prev) => prev.some((message) => message.id === newMessage.id) ? prev : [...prev, newMessage])
    } catch (error) {
      setSendError(error?.message || 'Message delivery failed. Please try again.')
      return false
    }
    return true
  }, [chat.id, user?.id, reply])

  const handleReact = useCallback(async (message, emoji) => {
    if (reacting) return
    setReacting(true)
    setSendError('')
    try {
      if (!user?.id) throw new Error('Sign in to react to messages.')
      const active = !(message.reactions || []).some(r => r.emoji === emoji && r.userId === String(user?.id))
      const event = await toggleMessageReaction(chat.id, message.id, emoji, user?.id, active)
      setMessages(prev => prev.some(m => m.id === event.id) ? prev : [...prev, event])
    } catch (error) { setSendError(error.message || 'Could not save this reaction.') }
    finally { setReacting(false) }
  }, [reacting, user?.id, chat.id])

  const visibleMessages = useMemo(() => {
    const query = search.trim().toLowerCase()
    return resolveMessages(messages)
      .map(message => ({ ...message, content: message.encrypted ? decryptedMessages[message.id] || UNDECRYPTABLE_MESSAGE : message.content }))
      .filter(message => !query || decodeContent(message.content).text.toLowerCase().includes(query))
  }, [messages, decryptedMessages, search])

  const wallpaperStyle = useMemo(() => (
    wallpaper.url
      ? {
          backgroundImage: `url(${wallpaper.url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'repeat',
        }
       : { background: wallpaper.preview || 'hsl(var(--background))' }
  ), [wallpaper.url, wallpaper.preview])

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-background">
      <div className="bg-card border-b border-border chat-page-x py-2 sm:py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <ChatButton
            title="Back to chats"
            onClick={onBack}
            className="md:hidden p-2 hover:bg-muted rounded-full text-foreground flex-shrink-0"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </ChatButton>
          <div className="flex-shrink-0">
            <Avatar src={chat.avatar_url} alt={chatDisplayName(chat, user?.id)} size="sm" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <h2 className="font-bold text-foreground truncate text-sm sm:text-base">{chatDisplayName(chat, user?.id)}</h2>
              {peerId && <VerificationBadge userId={peerId} className="w-4 h-4 flex-shrink-0" />}
              {chat.encrypted && (
                <LockClosedIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" title="End-to-end encrypted" />
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {call?.state === 'connected' ? 'On call' : chat.type === 'group' ? 'Group conversation' : 'Private conversation'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <ChatButton title="Search conversation" aria-expanded={showSearch} onClick={() => { setShowSearch(!showSearch); setSearch('') }} className="w-9"><Search className="w-5 h-5" /></ChatButton>
          <ChatButton
            onClick={startCall}
            disabled={!peerId || Boolean(call)}
            className="p-2 hover:bg-muted rounded-full text-foreground disabled:opacity-50 transition"
            title={peerId ? 'Start call' : 'Only available in one-to-one chats'}
          >
            <PhoneIcon className="w-5 h-5" />
          </ChatButton>
        </div>
      </div>

      {showSearch && <div className="flex items-center gap-2 chat-page-x py-3 bg-card border-b border-border chat-enter"><Search className="w-4 h-4 text-muted-foreground" /><input autoFocus type="search" enterKeyHint="search" autoComplete="off" spellCheck="false" aria-label="Search messages" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages" className="flex-1 min-w-0 bg-muted text-foreground px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /><ChatButton title="Close search" onClick={() => { setSearch(''); setShowSearch(false) }} className="w-9"><X className="w-4 h-4" /></ChatButton></div>}
      <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden" style={wallpaperStyle}>
        <div className="absolute inset-0 bg-card/60 dark:bg-background/70 pointer-events-none" />
        {showSyncOverlay && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/20 backdrop-blur-[1px] transition-all duration-300 animate-in fade-in"
            aria-hidden="true"
            data-chat-sync-overlay="true"
          >
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-card/90 px-6 py-4 shadow-xl border border-border/50 scale-95 animate-in zoom-in-95 duration-300">
              <SyncSpinner className="h-6 w-6" label="Syncing messages" />
              <span className="text-xs font-semibold text-foreground tracking-tight">Syncing…</span>
            </div>
          </div>
        )}

        <div className="relative h-full flex flex-col min-h-0">
          <div aria-busy={showSyncOverlay || undefined} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden chat-page-x py-5 space-y-3 sm:space-y-4 scroll-smooth">
            {visibleMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <MessageCircle className="w-10 h-10 text-primary mx-auto mb-3" /><p className="text-foreground font-medium text-sm">{search ? 'No matching messages' : 'No messages yet'}</p>
                  <p className="text-muted-foreground text-xs mt-1">Start a conversation</p>
                </div>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  userId={user?.id}
                  onReact={handleReact}
                  onReply={setReply}
                  reacting={reacting}
                  receiptsEnabled={readReceiptsEnabled}
                  isOwn={String(message.sender_id) === String(user?.id) || message.sender_id === 'me'}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {sendError && <p role="alert" className="border-t border-destructive/30 bg-destructive/10 chat-page-x py-2 text-sm text-destructive break-words">{sendError}</p>}
      <MessageInput onSendMessage={handleSendMessage} reply={reply} onCancelReply={() => setReply(null)} chatId={chat.id} />
    </div>
  )
}
