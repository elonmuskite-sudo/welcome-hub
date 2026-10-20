// Framework-agnostic store that tracks in-flight data synchronization so a single
// shared indicator can reflect contact syncing, chat/content loading, and realtime
// updates. Counts are reference-counted per key so overlapping requests never clear
// the indicator before the last one settles.

const activeCounts = new Map()
const listeners = new Set()
let snapshot = []

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

// Runs `operation` while the indicator is active for the whole duration.
export async function withSync(key, operation) {
  const release = trackSync(key)
  try {
    return await operation()
  } finally {
    release()
  }
}
