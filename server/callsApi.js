import { createClient } from '@supabase/supabase-js'
import { sendCallPush } from './callPush.js'

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

function createUserClient(url, key, token) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  return { url, key }
}

async function authenticate(req, res, configurationError) {
  const token = bearerToken(req)
  if (!token || token.length > 8192) {
    send(res, 401, { error: 'A valid session is required.' })
    return null
  }
  const { url, key } = getSupabaseConfig()
  if (!url || !key) {
    send(res, 503, { error: configurationError })
    return null
  }
  const client = createUserClient(url, key, token)
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !validUuid(user?.id)) {
    send(res, 401, { error: 'A valid session is required.' })
    return null
  }
  return { client, user }
}

async function notify(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const auth = await authenticate(req, res, 'Call notifications are not configured.')
  if (!auth) return

  const { client, user } = auth
  const { chatId, callId, expiresAt } = req.body || {}
  const callKind = req.body?.kind === 'video' ? 'video' : 'voice'
  const deadline = Number(expiresAt)
  if (!validUuid(chatId) || !validUuid(callId)
    || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 60000) {
    return send(res, 400, { error: 'The call request is invalid or expired.' })
  }

  const { data: chat, error: chatError } = await client
    .from('chats')
    .select('id, type, owner_id')
    .eq('id', chatId)
    .maybeSingle()
  if (chatError) {
    console.error('Could not authorize an incoming call notification.', chatError)
    return send(res, 503, { error: 'The call notification could not be authorized.' })
  }
  if (!chat || chat.type === 'group') return send(res, 404, { error: 'The one-to-one conversation is unavailable.' })

  const { data: participants, error: membersError } = await client
    .from('chat_members')
    .select('profile_id')
    .eq('chat_id', chatId)
  if (membersError) {
    console.error('Could not verify incoming call participants.', membersError)
    return send(res, 503, { error: 'The call participants could not be verified.' })
  }
  const participantIds = [...new Set((participants || []).map((row) => String(row.profile_id)))]
  if (!participantIds.includes(user.id)) return send(res, 403, { error: 'You are not a member of this conversation.' })
  const peers = participantIds.filter((id) => id !== user.id)
  if (peers.length !== 1) return send(res, 400, { error: 'Calls are only available in one-to-one conversations.' })

  const { data: caller, error: profileError } = await client
    .from('members')
    .select('full_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) {
    console.error('Could not load the call participant profile.', profileError)
    return send(res, 503, { error: 'The call notification could not be prepared.' })
  }

  try {
    const result = await sendCallPush(peers[0], {
      callId,
      chatId,
      expiresAt: deadline,
      fromUserId: user.id,
      fromName: caller?.full_name || 'Nexus user',
      fromAvatar: caller?.avatar_url || '',
      callKind,
    })
    if (!result.configured) return send(res, 503, { error: 'Background call push providers are not configured.' })
    return send(res, 200, { ok: true })
  } catch (error) {
    console.error('Background call notification failed.', error)
    return send(res, 503, { error: 'The background call notification could not be sent.' })
  }
}

async function subscribe(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const auth = await authenticate(req, res, 'Push subscription storage is not configured.')
  if (!auth) return

  const { client, user } = auth
  const { platform, endpoint, p256dh, auth: encryptionAuth } = req.body || {}
  if (!['web', 'android', 'ios'].includes(platform)
    || typeof endpoint !== 'string'
    || !endpoint.trim()
    || endpoint.length > 8192
    || (platform === 'web' && (
      typeof p256dh !== 'string' || p256dh.length > 512
      || typeof encryptionAuth !== 'string' || encryptionAuth.length > 512
    ))) {
    return send(res, 400, { error: 'The push subscription is invalid.' })
  }
  if (platform !== 'web' && (p256dh != null || encryptionAuth != null)) {
    return send(res, 400, { error: 'Native push subscriptions must not include web encryption keys.' })
  }

  const { error } = await client
    .from('call_push_subscriptions')
    .upsert({
      user_id: user.id,
      platform,
      endpoint: endpoint.trim(),
      p256dh: platform === 'web' ? p256dh : null,
      auth: platform === 'web' ? encryptionAuth : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform,endpoint' })
  if (error) {
    console.error('Could not save an authenticated call push subscription.', error)
    return send(res, 503, { error: 'Call notifications could not be enabled.' })
  }
  return send(res, 200, { ok: true })
}

export async function handleCallsApi(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  if (action === 'notify') return notify(req, res)
  if (action === 'push-subscription') return subscribe(req, res)
  return send(res, 404, { error: 'Not found.' })
}
