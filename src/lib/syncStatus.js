// Framework-agnostic store that tracks in-flight data synchronization so a single
// shared indicator can reflect contact syncing, chat/content loading, and realtime
// updates. Counts are reference-counted per key so overlapping requests never clear
// the indicator before the last one settles.

const activeCounts = new Map()
const listeners = new Set()
let snapshot = []

// Emitted on `window` after every tracked sync operation settles, carrying its
// duration. Lets the app (and the performance harness) measure the real sync
// workflow instead of guessing from the spinner.
export const SYNC_TIMING_EVENT = 'nexus:sync-timing'

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

export function recordSyncTiming(key, durationMs) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(SYNC_TIMING_EVENT, { detail: { key, durationMs } }))
  } catch {
    // Timing is diagnostic only; a dispatcher failure must never break a sync.
  }
}

function rebuild() {
  snapshot = [...activeCounts.keys()]
  for (const listener of listeners) listener(snapshot)
}

export function getSyncSnapshot() {
  return snapshot
}

export function subscribeToSync(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Marks `key` as syncing and returns an idempotent disposer that clears it.
export function trackSync(key) {
  activeCounts.set(key, (activeCounts.get(key) || 0) + 1)
  rebuild()
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (activeCounts.get(key) || 0) - 1
    if (remaining > 0) activeCounts.set(key, remaining)
    else activeCounts.delete(key)
    rebuild()
  }
}

// Runs `operation` while the indicator is active for the whole duration, and
// reports how long the sync actually took.
export async function withSync(key, operation) {
  const release = trackSync(key)
  const started = nowMs()
  try {
    return await operation()
  } finally {
    release()
    recordSyncTiming(key, nowMs() - started)
  }
}
