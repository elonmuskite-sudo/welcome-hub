// Admin session cookie signing, shared by the Vercel function that issues it
// (api/admin/session.js) and the Edge Middleware that enforces it (middleware.js).
// Web Crypto is used so the same module runs in the Node and Edge runtimes.

const encoder = new TextEncoder()

export const ADMIN_SESSION_COOKIE = 'nexus_admin_session'
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function signaturesMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false
  if (expected.length !== provided.length || expected.length === 0) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
  }
  return difference === 0
}

export async function createAdminSessionToken(userId, secret, ttlSeconds = ADMIN_SESSION_TTL_SECONDS) {
  const expiresAt = Date.now() + ttlSeconds * 1000
  const payload = `${userId}.${expiresAt}`
  return `${payload}.${await sign(secret, payload)}`
}

// Returns { userId } for a valid, unexpired token and null for anything else.
export async function verifyAdminSessionToken(token, secret) {
  if (!token || !secret) return null
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [userId, expiresAt, signature] = parts
  if (!userId || !expiresAt) return null
  const expected = await sign(secret, `${userId}.${expiresAt}`)
  if (!signaturesMatch(expected, signature)) return null
  const expiry = Number(expiresAt)
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null
  return { userId }
}

export function readAdminSessionCookie(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === ADMIN_SESSION_COOKIE) {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

function cookieAttributes() {
  // Secure is dropped for local `vercel dev` over http; production is https-only.
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}

export function adminSessionSetCookie(token, ttlSeconds = ADMIN_SESSION_TTL_SECONDS) {
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${cookieAttributes()}; Max-Age=${ttlSeconds}`
}

export function adminSessionClearedCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${cookieAttributes()}; Max-Age=0`
}
