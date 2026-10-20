import { useState } from 'react'
import { Flag, LoaderCircle, X } from 'lucide-react'
import { REPORT_REASONS, reportContent } from '../lib/moderation'

// Reusable report dialog for user-generated content (posts, comments, members).
// Required by the Google Play and Apple App Store UGC policies.
export default function ReportDialog({ targetType, targetId, targetLabel = 'this content', onClose, onSubmitted }) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (busy) return
    if (!reason) {
      setError('Choose a reason for your report.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await reportContent({ targetType, targetId, reason, details })
      onSubmitted?.()
      onClose?.()
    } catch (err) {
      setError(err.message || 'Your report could not be submitted.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
      <div className="absolute inset-0" onClick={() => { if (!busy) onClose?.() }} />
      <div className="relative z-10 flex max-h-[calc(100dvh_-_2rem)] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-destructive" />
            <h3 id="report-dialog-title" className="text-lg font-semibold text-foreground">Report {targetLabel}</h3>
          </div>
          <button type="button" onClick={() => { if (!busy) onClose?.() }} disabled={busy} aria-label="Close" className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Tell us what is wrong. Reports are confidential and reviewed by our moderators.
        </p>

        <label className="mt-4 block text-sm font-medium text-foreground" htmlFor="report-reason">Reason</label>
        <select
          id="report-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Select a reason…</option>
          {REPORT_REASONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium text-foreground" htmlFor="report-details">Details (optional)</label>
        <textarea
          id="report-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          disabled={busy}
          rows={3}
          maxLength={2000}
          placeholder="Add any context that will help our review."
          className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        />

        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { if (!busy) onClose?.() }}
            disabled={busy}
            className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !reason}
            className="inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}
