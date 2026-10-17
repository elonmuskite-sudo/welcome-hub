import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { appwriteData, isAppwriteAuthEnabled } from '../../lib/appwrite'

const cache = new Map()

// Fired after an admin changes badge status so mounted badges reload.
export const BADGE_REFRESH_EVENT = 'nexus-verification:refresh'

export function clearVerificationBadgeCache(userId) {
  if (userId) cache.delete(String(userId))
  else cache.clear()
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BADGE_REFRESH_EVENT))
}

export function useVerificationBadge(userId) {
  const [level, setLevel] = useState(() => cache.get(String(userId)) || 'none')
  useEffect(() => {
    if ((!supabase && !isAppwriteAuthEnabled()) || !userId) {
      setLevel('none')
      return undefined
    }
    const key = String(userId)
    let active = true
    setLevel(cache.get(key) || 'none')

    const load = async () => {
      if (cache.has(key)) {
        if (active) setLevel(cache.get(key))
        return
      }
      try {
        const badge = isAppwriteAuthEnabled()
          ? (await appwriteData('verification.badge', { userId: key })).badge
          : (await supabase.rpc('get_verification_badge', { _user_id: userId })).data
        const value = badge || 'none'
        cache.set(key, value)
        if (active) setLevel(value)
      } catch (error) {
        console.error('Could not load verification badge', error)
        if (active) setLevel('none')
      }
    }

    load()
    const onRefresh = () => { cache.delete(key); load() }
    window.addEventListener(BADGE_REFRESH_EVENT, onRefresh)
    return () => {
      active = false
      window.removeEventListener(BADGE_REFRESH_EVENT, onRefresh)
    }
  }, [userId])
  return level
}

// Resolves badges for many members (Nexus IDs) in a single request so user
// directories never fan out into one query per row.
export async function fetchVerificationBadges(memberIds) {
  const ids = [...new Set((memberIds || []).map(String).filter(Boolean))].slice(0, 500)
  const badges = new Map()
  if (!ids.length || (!supabase && !isAppwriteAuthEnabled())) return badges
  const rows = isAppwriteAuthEnabled()
    ? (await appwriteData('verification.badges', { memberIds: ids })).badges
    : (await supabase.rpc('get_verification_badges', { _member_ids: ids })).data
  for (const row of rows || []) badges.set(String(row.member_id), row.badge || 'none')
  return badges
}

// eslint-disable-next-line react/prop-types
export function VerificationBadgeIcon({ level, className = 'w-4 h-4' }) {
  // The blue verified check is shown for Premium Members (admin-granted) and for
  // members who passed either identity-verification tier (instant or manual).
  if (level === 'premium') {
    return <BadgeCheck aria-label="Premium Member" className={`${className} fill-badge-blue text-background`} />
  }
  if (level === 'authenticated') {
    return <BadgeCheck aria-label="Identity verified" className={`${className} fill-badge-blue text-background`} />
  }
  return null
}

// eslint-disable-next-line react/prop-types
export default function VerificationBadge({ userId, className = 'w-4 h-4' }) {
  const level = useVerificationBadge(userId)
  return <VerificationBadgeIcon level={level} className={className} />
}
