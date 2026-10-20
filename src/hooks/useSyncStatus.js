import { useSyncExternalStore } from 'react'
import { getSyncSnapshot, subscribeToSync } from '../lib/syncStatus'

// Subscribes a component to the global sync store.
// `syncing` is true while any tracked data-sync operation is in flight.
export function useSyncStatus() {
  const keys = useSyncExternalStore(subscribeToSync, getSyncSnapshot, getSyncSnapshot)
  return { syncing: keys.length > 0, keys }
}
