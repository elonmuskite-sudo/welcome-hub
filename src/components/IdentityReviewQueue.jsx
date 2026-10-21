import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sendIdentityReviewEmail } from '../lib/supabase'
import { appwriteData, isAppwriteAuthEnabled } from '../lib/appwrite'
import { clearVerificationBadgeCache } from './chat/VerificationBadge'

export default function IdentityReviewQueue() {
  const [rows, setRows] = useState([])
  const [notes, setNotes] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notificationRetryId, setNotificationRetryId] = useState(null)
  const [notificationRetrying, setNotificationRetrying] = useState(false)

  const load = useCallback(async () => {
    try {
      if (isAppwriteAuthEnabled()) {
        const { verifications } = await appwriteData('verification.admin.queue')
        setRows(verifications || [])
      } else {
        const { data, error: queryError } = await supabase.from('identity_verifications')
          .select('*').eq('status', 'pending').order('created_at').limit(50)
        if (queryError) throw queryError
        const signed = await Promise.all((data || []).map(async (row) => {
          const [selfie, document] = await Promise.all([
            row.selfie_path ? supabase.storage.from('identity-docs').createSignedUrl(row.selfie_path, 600) : Promise.resolve({ data: null }),
            row.id_document_path ? supabase.storage.from('identity-docs').createSignedUrl(row.id_document_path, 600) : Promise.resolve({ data: null }),
          ])
          return { ...row, selfieUrl: selfie.data?.signedUrl || null, idUrl: document.data?.signedUrl || null }
        }))
        setRows(signed)
      }
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Could not load identity checks.')
    }
  }, [])

  useEffect(() => {
    if (!isAppwriteAuthEnabled() && !supabase) return undefined
    load()
    if (isAppwriteAuthEnabled()) {
      const timer = setInterval(load, 15000)
      return () => clearInterval(timer)
    }
    return undefined
  }, [load])

  const decide = async (row, status) => {
    const { id, user_id: userId } = row
    let notificationFailed = false
    try {
      if (isAppwriteAuthEnabled()) {
        const result = await appwriteData('verification.admin.review', { id, status, note: notes[id] || null })
        notificationFailed = result?.emailNotificationSent !== true
      } else {
        const { error: updateError } = await supabase.rpc('review_identity_verification', {
          _id: id, _approve: status === 'approved', _note: notes[id] || null,
        })
        if (updateError) throw updateError
        try {
          await sendIdentityReviewEmail(id)
        } catch (notificationError) {
          console.error('Identity review status email failed', notificationError)
          notificationFailed = true
        }
      }
      clearVerificationBadgeCache(userId)
      setRows((r) => r.filter((x) => x.id !== id))
      setError('')
      setNotice(notificationFailed
        ? 'The review was saved, but its status email could not be delivered.'
        : 'The review was saved and the status email was sent.')
      setNotificationRetryId(notificationFailed ? id : null)
    } catch (reviewError) {
      setError(reviewError.message || 'The identity check could not be reviewed.')
      setNotice('')
    }
  }

  const retryStatusEmail = async () => {
    if (!notificationRetryId || notificationRetrying) return
    setNotificationRetrying(true)
    try {
      await sendIdentityReviewEmail(notificationRetryId)
      setNotice('The identity review status email was sent.')
      setNotificationRetryId(null)
    } catch (notificationError) {
      console.error('Identity review status email retry failed', notificationError)
      setNotice('The review was saved, but its status email still could not be delivered.')
    } finally {
      setNotificationRetrying(false)
    }
  }

  return (
    <section className="mt-8 rounded-[24px] border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-foreground">ID checks waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">Manual submissions are held until an admin confirms the government ID matches the selfie. Instant checks are automated and never appear here.</p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
      {notificationRetryId && (
        <button
          type="button"
          onClick={retryStatusEmail}
          disabled={notificationRetrying}
          className="mt-2 rounded-full border border-border px-4 py-2 text-sm text-foreground disabled:opacity-50"
        >
          {notificationRetrying ? 'Retrying email…' : 'Retry status email'}
        </button>
      )}
      {!rows.length && !error && <p className="mt-4 text-sm text-muted-foreground">Nothing to review.</p>}
      <div className="mt-4 space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
                {r.tier === 'instant' ? 'Instant' : 'Manual'}
              </span>
              <span>Match score {r.match_score == null ? 'n/a' : Number(r.match_score).toFixed(2)}</span>
              <span>· {new Date(r.created_at).toLocaleString()}</span>
            </div>
            {(r.full_legal_name || r.date_of_birth || r.document_type || r.document_number || r.issuing_country) && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {r.full_legal_name && <><dt className="text-muted-foreground">Legal name</dt><dd className="text-foreground">{r.full_legal_name}</dd></>}
                {r.date_of_birth && <><dt className="text-muted-foreground">Date of birth</dt><dd className="text-foreground">{r.date_of_birth}</dd></>}
                {r.document_type && <><dt className="text-muted-foreground">Document</dt><dd className="text-foreground capitalize">{String(r.document_type).replace(/_/g, ' ')}</dd></>}
                {r.document_number && <><dt className="text-muted-foreground">Number</dt><dd className="text-foreground">{r.document_number}</dd></>}
                {r.issuing_country && <><dt className="text-muted-foreground">Issuing country</dt><dd className="text-foreground">{r.issuing_country}</dd></>}
              </dl>
            )}
            <div className="grid grid-cols-2 gap-3">
              {r.selfieUrl && <img src={r.selfieUrl} alt="Selfie" className="w-full rounded-xl" />}
              {r.idUrl && <img src={r.idUrl} alt="Government ID" className="w-full rounded-xl" />}
            </div>
            <input placeholder="Note (shown to the person if rejected)" value={notes[r.id] || ''}
              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => decide(r, 'approved')} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">Approve</button>
              <button onClick={() => decide(r, 'rejected')} className="rounded-full border border-border px-4 py-2 text-sm text-destructive">Reject</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
