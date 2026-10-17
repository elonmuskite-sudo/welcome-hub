/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeftIcon, PhoneIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import Avatar from './Avatar'
import MessageInput from './MessageInput'
import MessageBubble from './MessageBubble'
import { useSetting } from '../../hooks/useSetting'
import { getWallpaperById } from '../../lib/wallpapers'
import { encryptMessage, decryptMessage, isE2EEEnabled } from '../../lib/crypto/e2ee'
import { useCall } from '../../lib/CallContext'
import { sendChatMessage, toggleMessageReaction } from '../../lib/persistence'
import { isChatServiceAvailable, newId } from '../../lib/persistence'
import { useAuth } from '../../lib/AuthContext'
import { Search, X, MessageCircle } from 'lucide-react'
import ChatButton from './ChatButton'
import VerificationBadge from './VerificationBadge'
import { peerIdOf, chatDisplayName } from './ChatListItem'
import { resolveMessages, decodeContent, encodeReply } from '../../lib/chatProtocol'

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
  const [chatWallpaper] = useSetting('chatWallpaper', 'nature')
  const wallpaper = getWallpaperById(chatWallpaper)

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

  useEffect(() => {
    if (!isE2EEEnabled()) return
    const pending = messages.filter((msg) => msg.encrypted && !decryptedMessages[msg.id])
    if (pending.length === 0) return

    const controller = { cancelled: false }
    ;(async () => {
      const results = await Promise.all(
        pending.map(async (msg) => {
          try {
            const decrypted = await decryptMessage(chat.id, msg.content, true)
            return { id: msg.id, decrypted }
          } catch {
            return { id: msg.id, decrypted: '🔒 Decryption failed' }
          }
        })
      )
      if (controller.cancelled) return
      setDecryptedMessages((prev) => {
        const next = { ...prev }
        for (const { id, decrypted } of results) {
          next[id] = decrypted
        }
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

  const handleReact = async (message, emoji) => {
    if (reacting) return
    setReacting(true)
    setSendError('')
    try {
      const active = !(message.reactions || []).some(r => r.emoji === emoji && r.userId === String(user?.id))
      const event = await toggleMessageReaction(chat.id, message.id, emoji, user?.id, active)
      setMessages(prev => prev.some(m => m.id === event.id) ? prev : [...prev, event])
    } catch (error) { setSendError(error.message || 'Could not save this reaction.') }
    finally { setReacting(false) }
  }
  const visibleMessages = resolveMessages(messages).map(message => ({ ...message, content: message.encrypted ? decryptedMessages[message.id] || 'Encrypted message — unable to decrypt' : message.content })).filter(message => !search || decodeContent(message.content).text.toLowerCase().includes(search.toLowerCase()))

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
      <div className="bg-card border-b border-border px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between flex-shrink-0">
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
              {peerIdOf(chat, user?.id) && <VerificationBadge userId={peerIdOf(chat, user?.id)} className="w-4 h-4 flex-shrink-0" />}
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

      {showSearch && <div className="flex items-center gap-2 p-3 bg-card border-b border-border chat-enter"><Search className="w-4 h-4 text-muted-foreground" /><input autoFocus aria-label="Search messages" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages" className="flex-1 min-w-0 bg-muted text-foreground px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /><ChatButton title="Close search" onClick={() => { setSearch(''); setShowSearch(false) }} className="w-9"><X className="w-4 h-4" /></ChatButton></div>}
      <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden" style={wallpaperStyle}>
        <div className="absolute inset-0 bg-card/60 dark:bg-background/70 pointer-events-none" />

        <div className="relative h-full flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-5 space-y-3 sm:space-y-4 scroll-smooth">
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
                  isOwn={String(message.sender_id) === String(user?.id) || message.sender_id === 'me'}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {sendError && <p role="alert" className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{sendError}</p>}
      <MessageInput onSendMessage={handleSendMessage} reply={reply} onCancelReply={() => setReply(null)} chatId={chat.id} />
    </div>
  )
}
