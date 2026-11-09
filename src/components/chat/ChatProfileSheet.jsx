import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Bell,
  BellOff,
  FileText,
  Flag,
  Image,
  LoaderCircle,
  Music2,
  Phone,
  Search,
  ShieldAlert,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import Avatar from './Avatar'
import ReportDialog from '../ReportDialog'
import { addContact, formatNexusId, isContactSaved } from '../../lib/persistence'
import { isAppwriteAuthEnabled } from '../../lib/appwrite'
import { blockUser, getPublicMemberProfile } from '../../lib/moderation'
import { isChatMuted, setChatMuted } from '../../lib/chatPreferences'

const MEDIA_TYPES = new Set(['image', 'video', 'voice', 'audio', 'document', 'file', 'sticker'])

function mediaLabel(message) {
  if (message.type === 'image' || message.type === 'sticker') return 'Photo'
  if (message.type === 'video') return 'Video'
  if (message.type === 'voice' || message.type === 'audio') return 'Audio'
  return 'File'
}

function mediaIcon(message) {
  if (message.type === 'image' || message.type === 'sticker') return Image
  if (message.type === 'video') return Video
  if (message.type === 'voice' || message.type === 'audio') return Music2
  return FileText
}

export default function ChatProfileSheet({ open, chat, peerId, peerName, callDisabled = false, onClose, onCall, onSearch, onOpenMessage }) {
  const [profile, setProfile] = useState(null)
  const [saved, setSaved] = useState(false)
  const [muted, setMuted] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [showReport, setShowReport] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const moderationAvailable = Boolean(!isAppwriteAuthEnabled())

  const media = useMemo(() => (chat?.messages || []).filter((message) => (
    MEDIA_TYPES.has(message.type) || Boolean(message.file_url)
  )), [chat?.messages])

  useEffect(() => {
    if (!open || !chat?.id) return undefined
    let active = true
    setProfile(null)
    setError('')
    setNotice('')
    setActiveTab('details')
    setConfirmBlock(false)
    setMuted(isChatMuted(chat.id))

    if (peerId && !isAppwriteAuthEnabled()) {
      getPublicMemberProfile(peerId)
        .then((details) => {
          if (active) setProfile(details || { name: peerName, avatarUrl: chat.avatar_url || null })
        })
        .catch((loadError) => {
          if (active) {
            setProfile({ name: peerName, avatarUrl: chat.avatar_url || null })
            setError(loadError?.message || 'Could not load additional profile details.')
          }
        })
    }

    return () => { active = false }
  }, [open, chat?.id, peerId, peerName, chat?.avatar_url])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !showReport && !busyAction) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, showReport, busyAction, onClose])

  useEffect(() => {
    let active = true
    const nexusId = profile?.nexusId
    if (!open || !nexusId) {
      setSaved(false)
      return undefined
    }
    isContactSaved(nexusId)
      .then((isSaved) => { if (active) setSaved(isSaved) })
      .catch((loadError) => { if (active) setError(loadError?.message || 'Could not check saved contacts.') })
    return () => { active = false }
  }, [open, profile?.nexusId])

  if (!open) return null

  const displayName = profile?.name || profile?.fullName || peerName
  const avatarUrl = profile?.avatarUrl || chat?.avatar_url || null
  const nexusId = profile?.nexusId

  const handleSaveContact = async () => {
    if (!nexusId || busyAction) return
    setBusyAction('save')
    setError('')
    setNotice('')
    try {
      await addContact({
        name: displayName,
        nexusId: formatNexusId(nexusId),
        avatarUrl,
      })
      setSaved(true)
      setNotice('Saved to your contacts.')
    } catch (saveError) {
      setError(saveError?.message || 'Could not save this contact.')
    } finally {
      setBusyAction('')
    }
  }

  const handleMuteToggle = () => {
    try {
      const next = !muted
      setChatMuted(chat.id, next)
      setMuted(next)
      setNotice(next ? 'Notifications muted for this conversation.' : 'Notifications enabled for this conversation.')
      setError('')
    } catch (muteError) {
      setError(muteError?.message || 'Could not update notification settings.')
    }
  }

  const handleBlock = async () => {
    if (!peerId || busyAction) return
    setBusyAction('block')
    setError('')
    try {
      await blockUser(peerId)
      setConfirmBlock(false)
      setNotice('This account is blocked from community posts and comments. Chat messages are not blocked.')
    } catch (blockError) {
      setError(blockError?.message || 'Could not block this account.')
    } finally {
      setBusyAction('')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4">
        <button type="button" className="absolute inset-0 cursor-default" aria-label="Close contact profile" onClick={onClose} />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-profile-title"
          className="relative z-10 flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="chat-profile-title" className="font-semibold text-foreground">Contact profile</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-5">
            <div className="flex flex-col items-center text-center">
              <Avatar src={avatarUrl} alt={displayName || 'Contact'} size="2xl" />
              <h3 className="mt-3 text-lg font-bold text-foreground">{displayName}</h3>
              {nexusId && <p className="mt-1 text-sm text-muted-foreground">{formatNexusId(nexusId)}</p>}
              {chat?.encrypted && (
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <ShieldAlert className="h-3.5 w-3.5" /> End-to-end encrypted
                </p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { onClose(); onCall() }} disabled={!peerId || callDisabled} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
                <Phone className="h-5 w-5 text-primary" /> Call
              </button>
              <button type="button" onClick={() => { onClose(); onSearch() }} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-medium text-foreground hover:bg-muted">
                <Search className="h-5 w-5 text-primary" /> Search
              </button>
              <button type="button" onClick={() => setActiveTab(activeTab === 'media' ? 'details' : 'media')} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border text-xs font-medium hover:bg-muted ${activeTab === 'media' ? 'bg-primary/10 text-primary' : 'bg-background text-foreground'}`}>
                <Image className="h-5 w-5 text-primary" /> Media
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={handleMuteToggle} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-foreground hover:bg-muted">
                {muted ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-primary" />}
                <span>{muted ? 'Unmute notifications' : 'Mute notifications'}</span>
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={!nexusId || saved || busyAction === 'save' || isAppwriteAuthEnabled()}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === 'save' ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : <UserRound className="h-4 w-4 text-primary" />}
                <span>{saved ? 'Saved to contacts' : nexusId ? 'Save contact' : 'Contact details unavailable'}</span>
              </button>
              <button type="button" onClick={() => { setShowReport(true); setError('') }} disabled={!moderationAvailable || !peerId} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50">
                <Flag className="h-4 w-4" /> Report account
              </button>
              {!confirmBlock ? (
                <button type="button" onClick={() => setConfirmBlock(true)} disabled={!moderationAvailable || !peerId} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50">
                  <Ban className="h-4 w-4" /> Block from community
                </button>
              ) : (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-foreground">Block this account from community posts and comments?</p>
                  <p className="mt-1 text-xs text-muted-foreground">This does not block messages in the current conversation.</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmBlock(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">Cancel</button>
                    <button type="button" onClick={handleBlock} disabled={busyAction === 'block'} className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
                      {busyAction === 'block' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                      Block
                    </button>
                  </div>
                </div>
              )}
            </div>

            {activeTab === 'details' ? (
              <div className="mt-4 rounded-xl bg-muted/50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <UserRound className="h-4 w-4 text-primary" /> About
                </div>
                {profile?.bio ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{profile.bio}</p> : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {profile ? 'No additional public profile details are available.' : isAppwriteAuthEnabled() ? 'Additional profile details are not available with Appwrite sign-in yet.' : 'Loading profile details…'}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Shared media and files</h4>
                  <span className="text-xs text-muted-foreground">{media.length}</span>
                </div>
                {media.length ? (
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {media.slice().reverse().map((message) => {
                      const Icon = mediaIcon(message)
                      return (
                        <button key={message.id} type="button" onClick={() => { onClose(); onOpenMessage(message.id) }} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted">
                          <Icon className="h-5 w-5 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{message.file_name || message.content || mediaLabel(message)}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{mediaLabel(message)}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="rounded-xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">No shared media or files yet.</p>
                )}
              </div>
            )}

            {notice && <p role="status" className="mt-3 text-sm text-primary">{notice}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            {!moderationAvailable && <p className="mt-3 text-xs text-muted-foreground">Report and block options are not yet available with Appwrite sign-in.</p>}
          </div>
        </section>
      </div>
      {showReport && (
        <ReportDialog
          targetType="member"
          targetId={peerId}
          targetLabel="this account"
          onClose={() => setShowReport(false)}
          onSubmitted={() => setNotice('Your report was submitted for review.')}
        />
      )}
    </>
  )
}
