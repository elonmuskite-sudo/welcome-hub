import { createClient } from '@supabase/supabase-js'
import { sendSystemEmail } from '../../server/systemEmails.js'
import { createSystemEmailService } from '../../supabase/functions/_shared/system-email-service.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return {}
}

function requestOriginIsValid(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (!origin || !host) return false
  try {
    const parsed = new URL(origin)
    return parsed.host === host && (parsed.protocol === 'https:' || parsed.hostname === 'localhost')
  } catch {
    return false
  }
}

function createAdminClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function createSystemEmailHandler({
  adminClientFactory = createAdminClient,
  emailSender = sendSystemEmail,
} = {}) {
  const sendNotification = createSystemEmailService({ adminClientFactory, emailSender })
  return async function systemEmailHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return send(res, 405, { error: 'Method not allowed.' })
    }
    if (!requestOriginIsValid(req)) return send(res, 403, { error: 'Invalid request origin.' })

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return send(res, 503, { error: 'System email delivery is not configured on the server.' })
    }

    let body
    try {
      body = readBody(req)
    } catch {
      return send(res, 400, { error: 'Invalid request body.' })
    }
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
    const result = await sendNotification({
      url: supabaseUrl,
      serviceRoleKey,
      token,
      action: String(body.action || ''),
      verificationId: String(body.verificationId || ''),
    })
    return send(res, result.status, result.body)
  }
}

export default createSystemEmailHandler()
