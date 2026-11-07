import { createClient } from '@supabase/supabase-js'
import {
  authenticateGatewayRequest,
  withAuthenticatedAppwriteTransaction,
  GatewayError,
  IdentityLinkError,
} from './appwriteGateway.js'

function getBearerToken(req) {
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
  return token && token.length <= 8192 ? token : null
}

function createSupabaseAdmin() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !serviceKey) {
    throw new GatewayError('The KYC service is not configured on the server.', 503)
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function authenticateKycRequest(req) {
  const token = getBearerToken(req)
  if (!token) throw new GatewayError('Sign in to continue.', 401)

  const admin = createSupabaseAdmin()
  const { data, error } = await admin.auth.getUser(token)
  if (!error && data?.user?.id) {
    return { kind: 'supabase', userId: data.user.id, admin }
  }

  try {
    const appwrite = await authenticateGatewayRequest(req)
    const userId = await withAuthenticatedAppwriteTransaction(
      appwrite.config,
      appwrite.account,
      (_client, identity) => identity.supabaseUserId,
    )
    return { kind: 'appwrite', userId, ...appwrite }
  } catch (gatewayError) {
    if (gatewayError instanceof IdentityLinkError) throw gatewayError
    if (gatewayError instanceof GatewayError && gatewayError.status === 503) throw gatewayError
    throw new GatewayError('Sign in to continue.', 401)
  }
}

export function withKycUserTransaction(auth, operation) {
  if (auth.kind === 'supabase') {
    return operation({ userId: auth.userId, admin: auth.admin })
  }

  return withAuthenticatedAppwriteTransaction(auth.config, auth.account, (client, identity, admin) => (
    operation({ userId: identity.supabaseUserId, client, admin })
  ))
}

export function sendKycResponse(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

export function kycErrorResponse(res, error) {
  if (error instanceof GatewayError || error instanceof IdentityLinkError) {
    return sendKycResponse(res, error.status, { error: error.message })
  }
  if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return sendKycResponse(res, error.statusCode, { error: error.message })
  }
  console.error('KYC request failed', error)
  return sendKycResponse(res, 503, { error: 'The verification service is temporarily unavailable.' })
}
