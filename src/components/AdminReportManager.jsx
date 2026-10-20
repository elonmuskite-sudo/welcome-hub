import { useCallback, useEffect, useState } from 'react'
import { useNow } from '../lib/useNow'
import { listReports, resolveReport, isModerationAvailable, REPORT_REASONS } from '../lib/moderation'
import { setFeedPostStatus, setFeedCommentStatus, formatTimeAgo, formatExactTime } from '../lib/feeds'

const STATUS_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'actioned', label: 'Actioned' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
]

function reasonLabel(reason) {
  return REPORT_REASONS.find((item) => item.value === reason)?.label || reason
}

// Admin moderation queue for member reports. Reviewers can action or dismiss a
// report and, for feed content, hide it straight from the queue.
export default function AdminReportManager() {
  const [reports, setReports] = useState([])
  const [status, setStatus] = useState('open')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const now = useNow()
  const available = isModerationAvailable()

  const load = useCallback(async () => {
    if (!available) return
    try {
      setReports(await listReports({ status }))
      setMsg('')
    } catch (error) {
      setMsg(error?.message || 'Reports could not be loaded.')
    }
  }, [available, status])

  useEffect(() => { load() }, [load])

  const resolve = async (id, nextStatus) => {
    setBusy(true)
    setMsg('')
    try {
      await resolveReport({ id, status: nextStatus })
      setMsg(`Report marked ${nextStatus}.`)
      await load()
    } catch (error) {
      setMsg(error?.message || 'The report could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  const hideContent = async (report) => {
    setBusy(true)
    setMsg('')
    try {
      if (report.targetType === 'post') await setFeedPostStatus({ id: report.targetId, status: 'removed' })
      else if (report.targetType === 'comment') await setFeedCommentStatus({ id: report.targetId, status: 'removed' })
      await resolveReport({ id: report.id, status: 'actioned' })
      setMsg('Content removed.')
      await load()
    } catch (error) {
      setMsg(error?.message || 'The content could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 rounded-[24px] border border-border bg-card p-6 text-card-foreground shadow-sm">
      <div>
        <h2 className="text-xl font-semibold">Content reports</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Member reports of offensive content. Review, remove the reported content, or dismiss false reports.
        </p>
      </div>

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}

      {!available ? (
        <p className="mt-4 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Reporting requires a connected database. Apply the Supabase migrations to enable the review queue.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  status === filter.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {reports.length === 0 && <p className="text-sm text-muted-foreground">No reports in this view.</p>}
            {reports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {reasonLabel(report.reason)}
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{report.targetType}</span>
                      <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{report.status}</span>
                    </p>
                    <p className="text-xs text-muted-foreground" title={`Reported ${formatExactTime(report.createdAt)}`}>
                      Reported by {report.reporterName} · {formatTimeAgo(report.createdAt, now)} · {formatExactTime(report.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {report.targetType !== 'member' && (
                      <button disabled={busy} onClick={() => hideContent(report)} className="rounded-xl border border-border px-3 py-1.5 text-sm text-destructive disabled:opacity-50">
                        Remove content
                      </button>
                    )}
                    <button disabled={busy} onClick={() => resolve(report.id, 'reviewed')} className="rounded-xl border border-border px-3 py-1.5 text-sm disabled:opacity-50">Reviewed</button>
                    <button disabled={busy} onClick={() => resolve(report.id, 'actioned')} className="rounded-xl border border-border px-3 py-1.5 text-sm disabled:opacity-50">Actioned</button>
                    <button disabled={busy} onClick={() => resolve(report.id, 'dismissed')} className="rounded-xl border border-border px-3 py-1.5 text-sm disabled:opacity-50">Dismiss</button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-foreground">{report.targetPreview}</p>
                {report.details && <p className="mt-1 text-xs text-muted-foreground">Reporter note: {report.details}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
