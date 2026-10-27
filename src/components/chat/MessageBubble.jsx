/* eslint-disable react/prop-types */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { ArrowLeft, FileText, Film, Music, SmilePlus, Reply, Copy, Check, CheckCheck, X } from 'lucide-react'
import ChatButton from './ChatButton'
import { REACTIONS, decodeContent } from '../../lib/chatProtocol'
import { resolveChatFileUrl } from '../../lib/storageManager'

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

function MessageBubble({ message, isOwn, userId, chatId, onReact, onReply, reacting, receiptsEnabled = true }) {
  const [showReactions, setShowReactions] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resolvedFileUrl, setResolvedFileUrl] = useState('')
  const [fileUrlError, setFileUrlError] = useState(false)
  const [preview, setPreview] = useState(null)
  const decoded = decodeContent(message.content)
  const groups = REACTIONS.map(emoji => ({ emoji, users: (message.reactions || []).filter(r => r.emoji === emoji).map(r => r.userId) })).filter(r => r.users.length)
  const copyText = async () => {
    try { await navigator.clipboard.writeText(decoded.text); setCopied(true) } catch { setCopied(false) }
  }
  const timeLabel = useMemo(() => formatTime(message.created_at), [message.created_at])
  const isSticker = message.type === 'sticker'

  useEffect(() => {
    let active = true
    setResolvedFileUrl('')
    setFileUrlError(false)
    if (!message.file_url) return () => { active = false }
    if (message.type === 'document' || message.type === 'file') return () => { active = false }
    resolveChatFileUrl(message.file_url, chatId)
      .then((url) => { if (active) setResolvedFileUrl(url) })
      .catch((error) => {
        console.error('Could not load chat attachment', error)
        if (active) setFileUrlError(true)
      })
    return () => { active = false }
  }, [message.file_url, message.type, chatId])

  const closePreview = useCallback(() => setPreview(null), [])

  const openPreview = useCallback(async (type) => {
    const requestId = `${message.id}-${Date.now()}`
    setPreview({ requestId, type, url: '', loading: true, error: false })
    try {
      const url = type === 'image' && resolvedFileUrl
        ? resolvedFileUrl
        : await resolveChatFileUrl(message.file_url, chatId)
      setPreview((current) => current?.requestId === requestId
        ? { ...current, url, loading: false }
        : current)
    } catch (error) {
      console.error('Could not preview chat attachment', error)
      setPreview((current) => current?.requestId === requestId
        ? { ...current, loading: false, error: true }
        : current)
    }
  }, [message.id, message.file_url, chatId, resolvedFileUrl])

  useEffect(() => {
    if (!preview) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [preview, closePreview])

  const renderContent = useMemo(() => {
    switch (message.type) {
      case 'text':
        return <p className="text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed">{decoded.text}</p>

      case 'image':
        if (!message.file_url) return <p className="text-xs">Image preview unavailable</p>
        if (fileUrlError) return <p className="text-xs">Image preview unavailable</p>
        if (!resolvedFileUrl) return <p className="text-xs opacity-70">Loading image…</p>
        return (
          <button type="button" onClick={() => openPreview('image')} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <img
              src={resolvedFileUrl}
              alt="Shared image; tap to preview"
              className="w-full max-w-xs sm:max-w-sm rounded-lg cursor-pointer hover:opacity-90 transition"
            />
          </button>
        )

      case 'video':
        if (!message.file_url) return <p className="text-xs">Video preview unavailable</p>
        if (fileUrlError) return <p className="text-xs">Video preview unavailable</p>
        if (!resolvedFileUrl) return <p className="text-xs opacity-70">Loading video…</p>
        return (
          <div className="max-w-xs sm:max-w-sm">
            <video
              src={resolvedFileUrl}
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
        if (!message.file_url) return <p className="text-xs">Audio preview unavailable</p>
        if (fileUrlError) return <p className="text-xs">Audio preview unavailable</p>
        if (!resolvedFileUrl) return <p className="text-xs opacity-70">Loading audio…</p>
        return (
          <div className="flex items-center gap-2 min-w-0 max-w-full">
            <Music className="w-4 h-4 flex-shrink-0" />
            <audio
              src={resolvedFileUrl}
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
        if (!message.file_url) return <p className="text-xs">File preview unavailable</p>
        return (
          <button
            type="button"
            onClick={() => openPreview('document')}
            className="flex w-full items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-background/10 hover:bg-background/20 disabled:opacity-60 transition-colors text-left"
          >
            <FileText className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium truncate">
                {message.file_name || message.content}
              </p>
              <p className="text-xs opacity-75 flex items-center gap-1">
                <FileText className="w-3 h-3 flex-shrink-0" />
                Tap to preview
              </p>
            </div>
          </button>
        )

      default:
        return <p className="text-xs sm:text-sm">{decoded.text}</p>
    }
  }, [message.type, message.content, message.file_url, message.file_name, message.duration, decoded.text, resolvedFileUrl, fileUrlError, openPreview])

  return (
    <>
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
    {preview && createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePreview()
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={preview.type === 'image' ? 'Image preview' : 'Document preview'}
          className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
        >
          <header className="flex min-h-14 items-center gap-2 border-b border-border px-3 sm:px-4">
            <button
              type="button"
              onClick={closePreview}
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label="Back to conversation"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to conversation</span>
              <span className="sm:hidden">Back</span>
            </button>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {preview.type === 'image' ? 'Image preview' : (message.file_name || 'Document preview')}
            </p>
            <button
              type="button"
              onClick={closePreview}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label="Close preview"
              title="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/5 p-2 sm:p-4">
            {preview.loading && <p className="text-sm text-muted-foreground">Loading preview…</p>}
            {preview.error && (
              <div className="space-y-3 text-center">
                <p role="alert" className="text-sm text-destructive">This file preview could not be loaded.</p>
                <button type="button" onClick={() => openPreview(preview.type)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  Try again
                </button>
              </div>
            )}
            {!preview.loading && !preview.error && preview.url && preview.type === 'image' && (
              <img src={preview.url} alt={message.file_name || 'Shared image'} className="max-h-full max-w-full object-contain" />
            )}
            {!preview.loading && !preview.error && preview.url && preview.type === 'document' && (
              <iframe
                src={preview.url}
                title={message.file_name || 'Shared document preview'}
                className="h-[75vh] min-h-[50vh] w-full rounded-md bg-white"
              />
            )}
          </div>
        </section>
      </div>,
      document.body,
    )}
    </>
  )
}

export default memo(MessageBubble)
