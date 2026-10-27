import { createClient } from '@supabase/supabase-js'

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

function bearerToken(req) {
  return String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || ''
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const token = bearerToken(req)
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()
  if (!token || token.length > 8192) return send(res, 401, { error: 'A valid session is required.' })
  if (!url || !key) return send(res, 503, { error: 'Push subscription storage is not configured.' })

  const { platform, endpoint, p256dh, auth } = req.body || {}
  if (!['web', 'android', 'ios'].includes(platform)
    || typeof endpoint !== 'string'
    || !endpoint.trim()
    || endpoint.length > 8192
    || (platform === 'web' && (
      typeof p256dh !== 'string' || p256dh.length > 512
      || typeof auth !== 'string' || auth.length > 512
    ))) {
    return send(res, 400, { error: 'The push subscription is invalid.' })
  }
  if (platform !== 'web' && (p256dh != null || auth != null)) {
    return send(res, 400, { error: 'Native push subscriptions must not include web encryption keys.' })
  }

  const userClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser(token)
  if (authError || !validUuid(user?.id)) return send(res, 401, { error: 'A valid session is required.' })

  const { error } = await userClient
    .from('call_push_subscriptions')
    .upsert({
      user_id: user.id,
      platform,
      endpoint: endpoint.trim(),
      p256dh: platform === 'web' ? p256dh : null,
      auth: platform === 'web' ? auth : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform,endpoint' })
  if (error) {
    console.error('Could not save an authenticated call push subscription.', error)
    return send(res, 503, { error: 'Call notifications could not be enabled.' })
  }
  return send(res, 200, { ok: true })
}
