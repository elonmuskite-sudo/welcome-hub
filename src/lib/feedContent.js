// Validation and sanitisation for user generated feed content. Posts and
// comments are always rendered as text, so the risks here are over-long input,
// invisible control characters and media URLs pointing at an unsafe scheme.
// Kept dependency-free so it can be unit tested without a Supabase client.

export const FEED_POST_MAX_LENGTH = 5000
export const FEED_COMMENT_MAX_LENGTH = 3000
export const FEED_MEDIA_MAX_ITEMS = 10
export const FEED_MEDIA_NAME_MAX_LENGTH = 200

// Control characters except tab/newline, plus runaway blank lines.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export function sanitizeFeedText(value, maxLength, label = 'post') {
  const cleaned = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  if (cleaned.length > maxLength) {
    throw new Error(`Keep your ${label} under ${maxLength} characters.`)
  }
  return cleaned
}

export function sanitizeMediaName(value) {
  if (!value) return null
  const cleaned = String(value).replace(CONTROL_CHARACTERS, '').trim().slice(0, FEED_MEDIA_NAME_MAX_LENGTH)
  return cleaned || null
}

// Media is rendered in <img>/<video> sources, so only same-origin paths and
// http(s) URLs are accepted; anything else (javascript:, data:, file:) is dropped.
export function isSafeMediaUrl(value) {
  const url = String(value || '').trim()
  if (!url) return false
  if (url.startsWith('/') && !url.startsWith('//')) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeFeedMedia(media) {
  if (!Array.isArray(media)) return []
  return media
    .filter((item) => item && isSafeMediaUrl(item.url))
    .map((item) => ({
      url: String(item.url).trim(),
      type: item.type === 'video' ? 'video' : 'image',
      name: sanitizeMediaName(item.name),
    }))
    .slice(0, FEED_MEDIA_MAX_ITEMS)
}

// A PostgREST filter describing every post the viewer is allowed to read: all
// public (active) posts belong to every signed-in member, authors keep sight of
// their own moderated posts, and admins read the whole table.
export function feedVisibilityFilter({ viewerId, isAdmin }) {
  if (isAdmin) return null
  const id = String(viewerId || '').trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  return isUuid ? `status.eq.active,author_id.eq.${id}` : 'status.eq.active'
}
