import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HardDrive, Image, Video, Mic, Music, FileText, Sticker, Trash2, RefreshCw, LoaderCircle, ExternalLink } from 'lucide-react'
import { useAuth } from '../../../lib/AuthContext'
import {
  STORAGE_QUOTA_BYTES,
  STORAGE_USAGE_CHANGED_EVENT,
  getStorageUsage,
  deleteStorageFiles,
  formatBytes,
  createChatFileReference,
  openChatFile,
} from '../../../lib/storageManager'
import ChatButton from '../ChatButton'

const TYPE_META = {
  image: { label: 'Images', icon: Image },
  video: { label: 'Videos', icon: Video },
  voice: { label: 'Voice notes', icon: Mic },
  audio: { label: 'Audio clips', icon: Music },
  sticker: { label: 'GIF stickers', icon: Sticker },
  file: { label: 'Documents', icon: FileText },
}

export default function DataStorageSettings() {
  const { user } = useAuth()
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [openingFileId, setOpeningFileId] = useState(null)
  const [displayedBytes, setDisplayedBytes] = useState(0)
  const displayedBytesRef = useRef(0)
  const refreshInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!user?.id) { setLoading(false); return }
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const result = await getStorageUsage(user.id)
      setUsage(result)
      const currentFileIds = new Set((result.files || []).map((file) => file.id))
      setSelected((previous) => new Set([...previous].filter((id) => currentFileIds.has(id))))
      setError('')
    } catch (err) {
      setError(err.message || 'Storage usage could not be loaded.')
    } finally {
      refreshInFlight.current = false
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void refresh()
    const onStorageChanged = () => { void refresh() }
    window.addEventListener(STORAGE_USAGE_CHANGED_EVENT, onStorageChanged)
    const refreshTimer = window.setInterval(onStorageChanged, 15000)
    return () => {
      window.removeEventListener(STORAGE_USAGE_CHANGED_EVENT, onStorageChanged)
      window.clearInterval(refreshTimer)
    }
  }, [refresh])

  const usedBytes = usage?.usedBytes || 0
  const quotaBytes = usage?.quotaBytes || STORAGE_QUOTA_BYTES

  useEffect(() => {
    if (typeof window === 'undefined') {
      displayedBytesRef.current = usedBytes
      setDisplayedBytes(usedBytes)
      return undefined
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      displayedBytesRef.current = usedBytes
      setDisplayedBytes(usedBytes)
      return undefined
    }
    const startBytes = displayedBytesRef.current
    const startTime = window.performance.now()
    let frameId
    const animate = (now) => {
      const progress = Math.min(1, (now - startTime) / 650)
      const eased = 1 - ((1 - progress) ** 3)
      const currentBytes = Math.round(startBytes + ((usedBytes - startBytes) * eased))
      displayedBytesRef.current = currentBytes
      setDisplayedBytes(currentBytes)
      if (progress < 1) frameId = window.requestAnimationFrame(animate)
    }
    frameId = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frameId)
  }, [usedBytes])

  const displayedPercent = Math.min(100, (displayedBytes / quotaBytes) * 100)
  const usedPercent = Math.min(100, (usedBytes / quotaBytes) * 100)

  const files = usage?.files || []
  const allSelected = files.length > 0 && selected.size === files.length

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)))
  }

  const deleteSelected = async () => {
    if (!selected.size || deleting) return
    setDeleting(true)
    setError('')
    try {
      await deleteStorageFiles(user.id, [...selected])
      await refresh()
    } catch (err) {
      setError(err.message || 'Files could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  const openFile = async (file) => {
    if (openingFileId) return
    setError('')
    setOpeningFileId(file.id)
    try {
      await openChatFile(createChatFileReference(file.storage_path), file.chat_id)
    } catch (err) {
      setError(err.message || 'This file could not be opened.')
    } finally {
      setOpeningFileId(null)
    }
  }

  const breakdown = useMemo(() => {
    const entries = Object.entries(usage?.byType || {})
    return entries.sort((a, b) => b[1] - a[1])
  }, [usage])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoaderCircle className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-muted/30 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Cloud storage</p>
            <p className="text-sm text-muted-foreground">
              <span aria-live="polite">{formatBytes(displayedBytes)}</span> of {formatBytes(quotaBytes)} used
            </p>
          </div>
          <ChatButton title="Refresh usage" onClick={refresh} className="ml-auto w-9">
            <RefreshCw className="w-4 h-4" />
          </ChatButton>
        </div>
        <div
          className="h-3 rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-label={`${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} storage used`}
          aria-valuenow={Math.round(usedPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${usedPercent > 90 ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${displayedPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatBytes(Math.max(quotaBytes - usedBytes, 0))} free · Videos up to 45 seconds
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Shared files use your storage after you save a copy.
        </p>
      </div>

      {breakdown.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Usage by type</p>
          {breakdown.map(([type, bytes]) => {
            const meta = TYPE_META[type] || TYPE_META.file
            const Icon = meta.icon
            return (
              <div key={type} className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0">
                <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 text-sm text-foreground">{meta.label}</span>
                <span className="text-sm font-medium text-muted-foreground">{formatBytes(bytes)}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Files ({files.length})
          </p>
          {files.length > 0 && (
            <button onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition"
            >
              {deleting ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete {selected.size}
            </button>
          )}
        </div>

        {files.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-muted-foreground">No uploaded files yet. Files you send in chats will appear here.</p>
        ) : (
          <ul>
            {files.map((file) => {
              const meta = TYPE_META[file.file_type] || TYPE_META.file
              const Icon = meta.icon
              const checked = selected.has(file.id)
              return (
                <li key={file.id} className="border-t border-border first:border-t-0">
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(file.id)}
                      className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                      aria-label={`Select ${file.file_name}`}
                    />
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <button
                      type="button"
                      onClick={() => openFile(file)}
                      disabled={Boolean(openingFileId)}
                      className="flex flex-1 min-w-0 items-center gap-2 text-left disabled:opacity-60"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm text-foreground">{file.file_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {meta.label} · {formatBytes(file.size_bytes)}
                          {file.duration_seconds != null ? ` · ${Math.round(file.duration_seconds)}s` : ''}
                        </span>
                      </span>
                      {openingFileId === file.id
                        ? <LoaderCircle className="w-4 h-4 animate-spin flex-shrink-0" />
                        : <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
