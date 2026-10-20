/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { Smile, Sticker, Paperclip, Mic, Send, Square, X, LoaderCircle, Reply } from 'lucide-react'
import StickerPicker from './StickerPicker'
import VoiceNoteDialog from './VoiceNoteDialog'
import ChatButton from './ChatButton'
import { uploadChatFile, ATTACHMENT_ACCEPT } from '../../lib/storageManager'
import { extractWaveformPeaks } from '../../lib/audioWaveform'
import { useAuth } from '../../lib/AuthContext'

// The emoji set is a sizeable payload only needed once the picker is opened, so
// it is fetched on demand instead of loading with every conversation.
const EmojiPicker = lazy(() => import('./EmojiPicker'))

// Keyboard note: web and Capacitor builds cannot launch or customize a system
// IME such as Gboard — the OS owns the keyboard, and no API exposes it. What the
// app can control is that the chat input asks for the right keyboard and that
// nothing in our focus/tap path delays it, so the keyboard appears as soon as
// the platform allows (see useViewportInsets for the measured inset). Outside
// chat, inputs are untouched, so the default system keyboard behaviour applies.
const CHAT_INPUT_HINTS = {
  inputMode: 'text',
  enterKeyHint: 'send',
  autoComplete: 'off',
  autoCorrect: 'on',
  autoCapitalize: 'sentences',
}

export default function MessageInput({ onSendMessage, reply, onCancelReply, chatId }) {
  const { user } = useAuth()
  const [inputText, setInputText] = useState('')
  const [activePanel, setActivePanel] = useState(null) // 'stickers' | 'emoji' | null
  const [isSending, setIsSending] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(null) // { percent, label }
  const [pendingVoice, setPendingVoice] = useState(null) // { file, durationSeconds, url, peaks }
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const recorderRef = useRef(null)
  const intervalRef = useRef(null)
  const streamRef = useRef(null)
  const startedRef = useRef(0)
  const aliveRef = useRef(true)
  const chunksRef = useRef([])
  const pendingUrlRef = useRef(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (recorderRef.current) recorderRef.current.onstop = null
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      streamRef.current?.getTracks().forEach(track => track.stop())
      clearInterval(intervalRef.current)
      if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    }
  }, [])
  useEffect(() => { if (reply) textareaRef.current?.focus() }, [reply])

  // Auto-grows the composer up to a cap derived from the *visible* viewport: on
  // mobile the keyboard shrinks visualViewport but not window.innerHeight, so
  // using innerHeight would let the composer grow past the space above the keyboard.
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el || typeof window === 'undefined') return
    const available = window.visualViewport?.height || window.innerHeight
    const cap = Math.min(available * 0.4, 180)
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden'
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => { resizeTextarea() }, [inputText, resizeTextarea])

  // Re-fit when the keyboard opens or closes, since the available height changed.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    viewport.addEventListener('resize', resizeTextarea)
    return () => viewport.removeEventListener('resize', resizeTextarea)
  }, [resizeTextarea])

  const send = async data => {
    if (isSending) return false
    setIsSending(true)
    setError('')
    try { return await onSendMessage(data) }
    catch (err) { setError(err.message || 'Message could not be sent.'); return false }
    finally { if (aliveRef.current) setIsSending(false) }
  }
  const submit = async event => {
    event.preventDefault()
    if (!inputText.trim() || isSending) return
    if (await send({ content: inputText.trim(), type: 'text' })) setInputText('')
  }

  // Multi-file attachments: each file is validated, uploaded with progress, and
  // sent as its own message so one bad file never blocks the rest.
  const selectFiles = async event => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || isSending) return
    setIsSending(true)
    setError('')
    const failures = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const label = files.length > 1 ? `Uploading ${index + 1} of ${files.length}: ${file.name}` : `Uploading ${file.name}`
        setUploadProgress({ percent: 0, label })
        try {
          const uploaded = await uploadChatFile({
            userId: user?.id,
            chatId,
            file,
            onProgress: percent => setUploadProgress({ percent, label }),
          })
          await send({
            content: uploaded.fileName,
            type: uploaded.fileType === 'sticker' ? 'image' : uploaded.fileType,
            file_url: uploaded.fileUrl,
            file_name: uploaded.fileName,
            duration: uploaded.durationSeconds,
          })
        } catch (fileError) {
          failures.push(`${file.name}: ${fileError?.message || 'the file could not be sent.'}`)
        }
      }
      if (failures.length) setError(failures.join(' • '))
    } finally {
      if (aliveRef.current) { setIsSending(false); setUploadProgress(null) }
    }
  }

  const startRecording = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser.'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!aliveRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        clearInterval(intervalRef.current)
        const chunks = chunksRef.current
        chunksRef.current = []
        const mimeType = recorder.mimeType || 'audio/webm'
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000))
        if (!aliveRef.current) return
        setIsRecording(false)
        setRecordingDuration(0)
        const blob = new Blob(chunks, { type: mimeType })
        if (!blob.size) return
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'webm'
        const file = new File([blob], `voice-note.${ext}`, { type: blob.type })
        // Nothing is uploaded yet: the confirmation dialog owns Send/Delete.
        const peaks = await extractWaveformPeaks(file)
        if (!aliveRef.current) return
        if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
        pendingUrlRef.current = URL.createObjectURL(blob)
        setPendingVoice({ file, durationSeconds, url: pendingUrlRef.current, peaks: peaks || [] })
      }
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
      recorder.start()
      startedRef.current = Date.now()
      setIsRecording(true)
      intervalRef.current = setInterval(() => setRecordingDuration(Math.floor((Date.now() - startedRef.current) / 1000)), 250)
    } catch { setError('Microphone access is required for voice messages.') }
  }
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }

  const discardPendingVoice = () => {
    if (pendingUrlRef.current) { URL.revokeObjectURL(pendingUrlRef.current); pendingUrlRef.current = null }
    setPendingVoice(null)
    setError('')
  }
  const sendPendingVoice = async () => {
    if (!pendingVoice || isSending) return
    setIsSending(true)
    setError('')
    setUploadProgress({ percent: 0, label: 'Uploading voice note' })
    try {
      const uploaded = await uploadChatFile({
        userId: user?.id,
        chatId,
        file: pendingVoice.file,
        kind: 'voice',
        durationSeconds: pendingVoice.durationSeconds,
        onProgress: percent => setUploadProgress({ percent, label: 'Uploading voice note' }),
      })
      const sent = await send({
        content: uploaded.fileName,
        type: 'voice',
        file_url: uploaded.fileUrl,
        file_name: uploaded.fileName,
        duration: uploaded.durationSeconds,
      })
      if (sent) discardPendingVoice()
      else setError('The voice note could not be sent.')
    } catch (err) {
      setError(err.message || 'The voice note could not be sent.')
    } finally {
      if (aliveRef.current) { setIsSending(false); setUploadProgress(null) }
    }
  }

  const togglePanel = panel => setActivePanel(current => (current === panel ? null : panel))
  const busy = isSending || Boolean(uploadProgress)

  return <div className="relative flex-shrink-0 chat-surface chat-composer bg-card/95 border-t border-border">
    {reply && <div className="flex items-center gap-2 border-l-2 border-primary pl-2 pb-2 mb-2 chat-enter"><Reply className="w-4 h-4 shrink-0 text-primary" /><div className="flex-1 min-w-0"><p className="text-xs text-primary font-semibold">Reply</p><p className="text-sm truncate text-muted-foreground">{reply.content}</p></div><ChatButton title="Cancel reply" onClick={onCancelReply} className="w-8 shrink-0"><X className="w-4 h-4" /></ChatButton></div>}
    {activePanel === 'stickers' && <StickerPicker onSelect={async sticker => { if (await send({ content: sticker.emoji, type: 'sticker' })) setActivePanel(null) }} onClose={() => setActivePanel(null)} />}
    {activePanel === 'emoji' && <Suspense fallback={null}><EmojiPicker onSelect={emoji => setInputText(text => (text + emoji).slice(0, 16000))} onClose={() => setActivePanel(null)} /></Suspense>}
    {uploadProgress && <div className="mb-2" role="status" aria-live="polite">
      <p className="mb-1 truncate text-xs text-muted-foreground">{uploadProgress.label} · {uploadProgress.percent}%</p>
      <div className="chat-upload-progress"><span style={{ width: `${uploadProgress.percent}%` }} /></div>
    </div>}
    {error && <div role="alert" className="flex gap-2 items-start text-sm text-destructive mb-2"><p className="flex-1">{error}</p><ChatButton title="Dismiss attachment error" onClick={() => setError('')} className="w-7 shrink-0"><X className="w-4 h-4" /></ChatButton></div>}
    {isRecording ? <div className="flex items-center gap-2"><div className="flex-1 text-destructive flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-destructive motion-safe:animate-pulse" /><span className="text-sm">Recording {recordingDuration}s</span></div><ChatButton title="Stop recording" onClick={stopRecording} className="w-11 h-11 bg-destructive text-destructive-foreground"><Square className="w-5 h-5" /></ChatButton></div> : <form onSubmit={submit} className="flex items-end gap-2">
      <ChatButton title="Emoji" disabled={busy} onClick={() => togglePanel('emoji')} aria-expanded={activePanel === 'emoji'} className={`w-11 h-11 shrink-0 ${activePanel === 'emoji' ? 'bg-primary/10 text-primary' : ''}`}><Smile className="w-5 h-5" /></ChatButton>
      <ChatButton title="Stickers" disabled={busy} onClick={() => togglePanel('stickers')} aria-expanded={activePanel === 'stickers'} className={`w-11 h-11 shrink-0 ${activePanel === 'stickers' ? 'bg-primary/10 text-primary' : ''}`}><Sticker className="w-5 h-5" /></ChatButton>
      <ChatButton title="Attach files" disabled={busy} onClick={() => fileInputRef.current?.click()} className="w-11 h-11 shrink-0"><Paperclip className="w-5 h-5" /></ChatButton>
      <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={selectFiles} />
      <textarea ref={textareaRef} rows={1} disabled={busy} aria-label="Message" maxLength={16000} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e) }} placeholder="Message…" {...CHAT_INPUT_HINTS} className="chat-textarea flex-1 min-w-0 min-h-11 resize-none rounded-lg bg-muted px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      <ChatButton type={inputText.trim() ? 'submit' : 'button'} variant="primary" title={busy ? 'Sending message' : inputText.trim() ? 'Send message' : 'Record voice message'} disabled={busy} onClick={!inputText.trim() ? startRecording : undefined} className="w-11 h-11 shrink-0">{busy ? <LoaderCircle className="w-5 h-5 animate-spin" /> : inputText.trim() ? <Send className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</ChatButton>
    </form>}
    {pendingVoice && <VoiceNoteDialog audioUrl={pendingVoice.url} durationSeconds={pendingVoice.durationSeconds} peaks={pendingVoice.peaks} isSending={busy} error={error} onSend={sendPendingVoice} onDelete={discardPendingVoice} />}
  </div>
}
