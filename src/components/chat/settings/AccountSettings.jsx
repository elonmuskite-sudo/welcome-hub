import { useEffect, useState } from 'react'
import { AlertTriangle, Download, LoaderCircle, Trash2, UserX, X } from 'lucide-react'
import { useAuth } from '../../../lib/AuthContext'
import { supabase, getMemberProfile } from '../../../lib/supabase'
import { isAppwriteAuthEnabled } from '../../../lib/appwrite'
import { isModerationAvailable, listBlockedUsers, unblockUser } from '../../../lib/moderation'

const CONFIRM_WORD = 'DELETE'

async function collectAccountData(userId) {
  const [profile, contacts, posts] = await Promise.all([
    getMemberProfile(userId).catch(() => null),
    supabase.from('contacts').select('name, nexus_id, created_at').eq('user_id', userId).then(({ data }) => data || []),
    supabase.from('feed_posts').select('content, media, created_at').eq('author_id', userId).then(({ data }) => data || []),
  ])
  return { exportedAt: new Date().toISOString(), profile, contacts, posts }
}

export default function AccountSettings() {
  const { user, deleteAccount } = useAuth()
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState([])
  const [unblocking, setUnblocking] = useState('')

  const canExport = !isAppwriteAuthEnabled() && Boolean(supabase)
  const canManageBlocks = isModerationAvailable()

  useEffect(() => {
    if (!canManageBlocks) return undefined
    let active = true
    const load = async () => {
      try {
        const list = await listBlockedUsers()
        if (active) setBlocked(list)
      } catch {
        if (active) setBlocked([])
      }
    }
    load()
    window.addEventListener('nexus-blocks:updated', load)
    return () => {
      active = false
      window.removeEventListener('nexus-blocks:updated', load)
    }
  }, [canManageBlocks])

  const handleUnblock = async (id) => {
    setUnblocking(id)
    setError('')
    try {
      await unblockUser(id)
      setBlocked((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      setError(err.message || 'That member could not be unblocked.')
    } finally {
      setUnblocking('')
    }
  }

  const downloadData = async () => {
    if (exporting || !user?.id) return
    setExporting(true)
    setError('')
    try {
      const data = await collectAccountData(user.id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `nexus-chat-data-${user.id}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || 'Your data could not be prepared for download.')
    } finally {
      setExporting(false)
    }
  }

  const confirmDelete = async () => {
    if (busy || confirmText.trim().toUpperCase() !== CONFIRM_WORD) return
    setBusy(true)
    setError('')
    try {
      await deleteAccount()
      // The session is cleared by deleteAccount; the auth guard sends the user
      // back to the sign-in screen.
    } catch (err) {
      setError(err.message || 'Your account could not be deleted. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {canExport && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">Download your data</p>
              <p className="text-sm text-muted-foreground mt-1">
                Get a copy of your profile, contacts and feed posts as a JSON file. Private messages are
                end-to-end encrypted and are not included.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={downloadData}
            disabled={exporting}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:opacity-50 transition"
          >
            {exporting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
      )}

      {canManageBlocks && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <UserX className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">Blocked accounts</p>
              <p className="text-sm text-muted-foreground mt-1">
                Members you block cannot appear in your feed: their posts and comments are hidden from you.
              </p>
            </div>
          </div>
          {blocked.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">You have not blocked anyone.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {blocked.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                    {member.nexusId && <p className="text-xs text-muted-foreground">ID: {member.nexusId}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnblock(member.id)}
                    disabled={unblocking === member.id}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
                  >
                    {unblocking === member.id && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground">Delete account</p>
            <p className="text-sm text-muted-foreground mt-1">
              This permanently removes your account and its data, including your profile, contacts, uploaded
              files, identity verification records, feed posts, and chats you own. This cannot be undone.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setError(''); setConfirmText(''); setShowConfirm(true) }}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 transition"
        >
          <Trash2 className="w-4 h-4" />
          Delete my account
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 max-h-[calc(100dvh_-_2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <h3 id="delete-account-title" className="text-lg font-semibold text-foreground">Delete your account?</h3>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Your account and its data will be permanently deleted. Type <strong className="text-foreground">{CONFIRM_WORD}</strong> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              disabled={busy}
              autoComplete="off"
              className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-destructive focus:outline-none"
              placeholder={CONFIRM_WORD}
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
            />
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={busy}
                className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
                className="inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition"
              >
                {busy && <LoaderCircle className="w-4 h-4 animate-spin" />}
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
