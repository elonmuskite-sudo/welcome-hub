import { createClient } from '@supabase/supabase-js'
import { sendCallPush } from '../../server/callPush.js'

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || ''
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()
  if (!token || token.length > 8192) return send(res, 401, { error: 'A valid session is required.' })
  if (!url || !key) return send(res, 503, { error: 'Call notifications are not configured.' })

  const { chatId, callId, expiresAt } = req.body || {}
  const deadline = Number(expiresAt)
  if (!validUuid(chatId) || !validUuid(callId)
    || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 60000) {
    return send(res, 400, { error: 'The call request is invalid or expired.' })
  }

  const userClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser(token)
  if (authError || !validUuid(user?.id)) return send(res, 401, { error: 'A valid session is required.' })

  const { data: chat, error: chatError } = await userClient
    .from('chats')
    .select('id, type, owner_id')
    .eq('id', chatId)
    .maybeSingle()
  if (chatError) {
    console.error('Could not authorize an incoming call notification.', chatError)
    return send(res, 503, { error: 'The call notification could not be authorized.' })
  }
  if (!chat || chat.type === 'group') return send(res, 404, { error: 'The one-to-one conversation is unavailable.' })

  const { data: participants, error: membersError } = await userClient
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

  const { data: caller, error: profileError } = await userClient
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
    })
    if (!result.configured) return send(res, 503, { error: 'Background call push providers are not configured.' })
    return send(res, 200, { ok: true })
  } catch (error) {
    console.error('Background call notification failed.', error)
    return send(res, 503, { error: 'The background call notification could not be sent.' })
  }
}
