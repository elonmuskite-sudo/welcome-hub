import { createClient } from '@supabase/supabase-js'
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionClearedCookie,
  adminSessionSetCookie,
  createAdminSessionToken,
} from '../../server/adminSession.js'

// Issues the signed HttpOnly cookie that middleware.js requires for /admin*
// requests. The browser session itself lives in localStorage, which Edge
// Middleware cannot read, so an admin proves the role here once and the server
// gate then trusts only the cookie it signed.
function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', adminSessionClearedCookie())
    return send(res, 200, { admin: false })
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const secret = String(process.env.ADMIN_SESSION_SECRET || '').trim()
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return send(res, 503, { error: 'Admin sessions are not configured: set ADMIN_SESSION_SECRET on the server.' })
  if (!url || !serviceKey) return send(res, 503, { error: 'Vercel is missing its Supabase server settings.' })

  const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return send(res, 401, { error: 'Sign in required.' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return send(res, 401, { error: 'Sign in required.' })

  const { data: isAdmin, error: roleError } = await admin.rpc('has_role', { _user_id: data.user.id, _role: 'admin' })
  if (roleError) {
    console.error('Admin role check failed', roleError)
    return send(res, 503, { error: 'Admin access could not be verified.' })
  }
  if (isAdmin !== true) return send(res, 403, { error: 'Admins only.' })

  const sessionToken = await createAdminSessionToken(data.user.id, secret)
  res.setHeader('Set-Cookie', adminSessionSetCookie(sessionToken))
  return send(res, 200, { admin: true, expiresIn: ADMIN_SESSION_TTL_SECONDS })
}
