/* eslint-disable react/prop-types */
import { memo, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { FileText, Download, Film, Music, SmilePlus, Reply, Copy, Check, CheckCheck } from 'lucide-react'
import ChatButton from './ChatButton'
import { REACTIONS, decodeContent } from '../../lib/chatProtocol'

function formatTime(dateString) {
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      return '...'
    }
    return format(date, 'h:mm a')
  } catch {
    return '...'
  }
}

function MessageBubble({ message, isOwn, userId, onReact, onReply, reacting, receiptsEnabled = true }) {
  const [showReactions, setShowReactions] = useState(false)
  const [copied, setCopied] = useState(false)
  const decoded = decodeContent(message.content)
  const groups = REACTIONS.map(emoji => ({ emoji, users: (message.reactions || []).filter(r => r.emoji === emoji).map(r => r.userId) })).filter(r => r.users.length)
  const copyText = async () => {
    try { await navigator.clipboard.writeText(decoded.text); setCopied(true) } catch { setCopied(false) }
  }
  const timeLabel = useMemo(() => formatTime(message.created_at), [message.created_at])
  const isSticker = message.type === 'sticker'

  const renderContent = useMemo(() => {
    switch (message.type) {
      case 'text':
        return <p className="text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed">{decoded.text}</p>

      case 'image':
        return (
          <img
            src={message.file_url}
            alt="Shared image"
            className="w-full max-w-xs sm:max-w-sm rounded-lg cursor-pointer hover:opacity-90 transition"
            onClick={() => window.open(message.file_url, '_blank')}
          />
        )

      case 'video':
        return (
          <div className="max-w-xs sm:max-w-sm">
            <video
              src={message.file_url}
              controls
              className="rounded-lg w-full"
              preload="metadata"
            />
            {message.file_name && (
              <p className="text-xs mt-1 opacity-75 flex items-center gap-1">
                <Film className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{message.file_name}</span>
              </p>
            )}
          </div>
        )

      case 'voice':
        return (
          <div className="flex items-center gap-2 min-w-0 max-w-full">
            <Music className="w-4 h-4 flex-shrink-0" />
            <audio
              src={message.file_url}
              controls
              className="h-8 w-52 max-w-full min-w-0"
            />
            {message.duration && (
              <span className="text-xs opacity-75 flex-shrink-0">{message.duration}s</span>
            )}
          </div>
        )

      case 'sticker':
        return (
          <span className="text-4xl sm:text-5xl leading-none select-none" role="img">
            {message.content}
          </span>
        )

      case 'document':
      case 'file':
        return (
          <a
            href={message.file_url}
            download={message.file_name}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-background/10 hover:bg-background/20 transition-colors"
          >
            <FileText className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium truncate">
                {message.file_name || message.content}
              </p>
              <p className="text-xs opacity-75 flex items-center gap-1">
                <Download className="w-3 h-3 flex-shrink-0" />
                Tap to download
              </p>
            </div>
          </a>
        )

      default:
        return <p className="text-xs sm:text-sm">{decoded.text}</p>
    }
  }, [message.type, message.content, message.file_url, message.file_name, message.duration, decoded.text])

  return (
    <div id={`message-${message.id}`} className={`chat-enter flex ${isOwn ? 'justify-end' : 'justify-start'} px-0`}>
      <div
        className={
          isSticker
            ? 'min-w-0 max-w-[85%] sm:max-w-[70%]'
            : `min-w-0 max-w-[85%] sm:max-w-[65%] px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-xl ${
                isOwn
                  ? 'bg-primary text-primary-foreground rounded-tr-none shadow-sm'
                  : 'bg-muted text-foreground rounded-tl-none shadow-sm'
              }`
        }
      >
        {decoded.reply && <a href={`#message-${decoded.reply.id}`} className="block border-l-2 border-current bg-background/10 px-2 py-1 mb-2 rounded text-xs opacity-80 max-w-full truncate">{decoded.reply.preview}</a>}
        {renderContent}
        {!isSticker && (
          <div className={`text-xs mt-1 opacity-70 ${isOwn ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
            <span>{timeLabel}</span>
            {isOwn && (() => {
              if (receiptsEnabled && message.read) {
                return <CheckCheck className="inline w-3.5 h-3.5 ml-1 text-sky-300" aria-label="Read" title="Read" />
              }
              if (receiptsEnabled && message.delivered) {
                return <CheckCheck className="inline w-3.5 h-3.5 ml-1" aria-label="Delivered" title="Delivered" />
              }
              return <Check className="inline w-3.5 h-3.5 ml-1" aria-label="Sent" title="Sent" />
            })()}
          </div>
        )}
        <div className="flex items-center gap-1 mt-1" aria-label="Message actions">
          <ChatButton title="React to message" aria-expanded={showReactions} onClick={() => setShowReactions(!showReactions)} className={`!min-h-7 w-7 ${isOwn && !isSticker ? '!text-primary-foreground hover:!bg-background/10' : ''}`}><SmilePlus className="w-3.5 h-3.5" /></ChatButton>
          <ChatButton title="Reply to message" onClick={() => onReply?.({ ...message, content: decoded.text })} className={`!min-h-7 w-7 ${isOwn && !isSticker ? '!text-primary-foreground hover:!bg-background/10' : ''}`}><Reply className="w-3.5 h-3.5" /></ChatButton>
          {message.type === 'text' && <ChatButton title={copied ? 'Copied' : 'Copy message'} onClick={copyText} className={`!min-h-7 w-7 ${isOwn ? '!text-primary-foreground hover:!bg-background/10' : ''}`}>{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</ChatButton>}
        </div>
        {showReactions && <div className="flex flex-wrap gap-1 p-1 mt-1 bg-popover text-popover-foreground rounded-lg border border-border chat-enter" aria-label="Choose reaction">{REACTIONS.map(emoji => <ChatButton key={emoji} title={`React ${emoji}`} disabled={reacting} onClick={() => { onReact?.(message, emoji); setShowReactions(false) }} className="w-8 text-lg">{emoji}</ChatButton>)}</div>}
        {groups.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{groups.map(({ emoji, users }) => <ChatButton key={emoji} title={`${emoji}: ${users.length} reaction${users.length > 1 ? 's' : ''}`} aria-pressed={users.includes(String(userId))} disabled={reacting} onClick={() => onReact?.(message, emoji)} className={`!min-h-7 px-2 text-xs border ${users.includes(String(userId)) ? 'bg-accent text-accent-foreground border-accent' : 'bg-card text-card-foreground border-border'}`}>{emoji} {users.length}</ChatButton>)}</div>}
      </div>
    </div>
  )
}

export default memo(MessageBubble)
