/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Send, Trash2 } from 'lucide-react'
import ChatButton from './ChatButton'

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

// Shown the moment a recording stops. Nothing is uploaded or sent until the
// user explicitly picks Send here; Delete (or Escape) discards the recording.
export default function VoiceNoteDialog({
  audioUrl,
  durationSeconds = 0,
  peaks = [],
  onSend,
  onDelete,
  isSending = false,
  error = '',
}) {
  const sendRef = useRef(null)
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => { sendRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !isSending) onDelete?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDelete, isSending])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined
    const stop = () => setIsPlaying(false)
    audio.addEventListener('ended', stop)
    audio.addEventListener('pause', stop)
    audio.addEventListener('play', () => setIsPlaying(true))
    return () => {
      audio.removeEventListener('ended', stop)
      audio.removeEventListener('pause', stop)
    }
  }, [])

  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => setIsPlaying(false))
    else audio.pause()
  }

  const bars = peaks.length ? peaks : new Array(32).fill(0.35)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!isSending) onDelete?.() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Voice note preview"
        className="chat-enter w-full max-w-sm rounded-xl border border-border bg-popover p-4 text-popover-foreground chat-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">Voice note ready</h2>
        <div className="mb-3 flex items-center gap-3">
          <ChatButton
            title={isPlaying ? 'Pause preview' : 'Play preview'}
            onClick={togglePlayback}
            disabled={!audioUrl}
            className="h-10 w-10 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </ChatButton>
          <div className="flex h-10 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden="true">
            {bars.map((peak, index) => (
              <span
                key={index}
                className="flex-1 rounded-full bg-primary/70"
                style={{ height: `${Math.max(8, Math.min(100, Math.round(peak * 100)))}%` }}
              />
            ))}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(durationSeconds)}</span>
        </div>
        {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />}
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <p className="mb-4 text-xs text-muted-foreground">Send this voice note, or delete it to record again.</p>
        <div className="flex items-center justify-end gap-2">
          <ChatButton
            title="Delete voice note"
            onClick={onDelete}
            disabled={isSending}
            className="h-10 gap-2 border border-border px-4 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm">Delete</span>
          </ChatButton>
          <ChatButton
            ref={sendRef}
            title="Send voice note"
            variant="primary"
            onClick={onSend}
            disabled={isSending || !audioUrl}
            className="h-10 gap-2 px-4"
          >
            <Send className="h-4 w-4" />
            <span className="text-sm">{isSending ? 'Sending…' : 'Send'}</span>
          </ChatButton>
        </div>
      </div>
    </div>
  )
}
