import { useSyncStatus } from '../hooks/useSyncStatus'

const SYNC_LABELS = {
  contacts: 'Syncing contacts…',
  chat: 'Syncing messages…',
  chats: 'Syncing chats…',
  realtime: 'Updating…',
}

// Several keys are usually in flight at once (the sidebar refetches the chat list
// whenever a conversation refetches). Report the most specific one so the label
// is deterministic instead of depending on which request happened to start first.
const SYNC_PRIORITY = ['chat', 'contacts', 'chats', 'realtime']

// Single, consistent spinner used by every sync surface (global indicator, chat
// page, sidebar, contacts) so the loading language stays uniform across the app.
export function SyncSpinner({ className = 'h-4 w-4', label = 'Loading' }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary ${className}`}
    />
  )
}

// Non-intrusive global activity indicator. Rendered once in the chat shell: a
// fixed indeterminate bar above the header plus a floating, click-through pill.
// Neither element participates in layout, so it never causes a layout shift.
export default function SyncIndicator() {
  const { syncing, keys } = useSyncStatus()
  if (!syncing) return null
  const activeKey = SYNC_PRIORITY.find((key) => keys.includes(key)) || keys[0]
  const label = SYNC_LABELS[activeKey] || 'Syncing…'
  return (
    <>
      <div className="sync-bar-track" data-sync-bar="true" aria-hidden="true">
        <span className="sync-bar-fill" />
      </div>
      <div
        role="status"
        aria-live="polite"
        data-sync-pill="true"
        className="pointer-events-none fixed right-4 top-16 z-40 flex items-center gap-2.5 rounded-full border border-primary/20 bg-card/90 px-4 py-2 text-xs font-semibold text-foreground shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-300 sm:top-[88px]"
      >
        <SyncSpinner className="h-3.5 w-3.5" label={label} />
        <span className="tracking-wide">{label}</span>
      </div>
    </>
  )
}
