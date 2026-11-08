import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { isKycUuid, kycStepForStatus, normalizeProviderStatus } from './idswyftKyc.js'

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export class IdswyftWebhookError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'IdswyftWebhookError'
    this.statusCode = statusCode
  }
}

export function verifyIdswyftSignature(header, rawBody, secret, now = Date.now()) {
  if (typeof header !== 'string' || !secret || !Buffer.isBuffer(rawBody)) return false

  const parts = header.split(',').map((part) => part.trim())
  const timestampParts = parts.filter((part) => part.startsWith('t='))
  const signatureParts = parts.filter((part) => part.startsWith('v1='))
  if (parts.length !== 2 || timestampParts.length !== 1 || signatureParts.length !== 1) return false

  const timestamp = timestampParts[0].slice(2)
  const signature = signatureParts[0].slice(3)
  if (!/^\d{10}$/.test(timestamp) || !/^[\da-f]{64}$/i.test(signature)) return false
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false

  const expected = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest()
  const received = Buffer.from(signature, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function readIdswyftRawBody(req) {
  const declaredLength = Number(req.headers?.['content-length'] || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new IdswyftWebhookError('Webhook body is too large.', 413)
  }

  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      throw new IdswyftWebhookError('Webhook body is too large.', 413)
    }
    chunks.push(bytes)
  }
  if (req.aborted) throw new IdswyftWebhookError('Webhook request was interrupted.', 400)
  return Buffer.concat(chunks, size)
}

export function buildIdswyftSessionUpdate(payload, updatedAt = new Date().toISOString()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new IdswyftWebhookError('Webhook payload is invalid.')
  }
  const eventType = payload.type || payload.event
  if (eventType !== 'verification.completed') return null

  const data = payload.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new IdswyftWebhookError('Webhook verification data is invalid.')
  }
  const sessionId = data.session_id
  if (!isKycUuid(sessionId)) throw new IdswyftWebhookError('Webhook session ID is invalid.')

  let status
  try {
    status = normalizeProviderStatus({ status: data.status })
  } catch {
    throw new IdswyftWebhookError('Webhook verification status is invalid.')
  }

  const liveness = data.liveness
  if (!liveness || typeof liveness !== 'object' || Array.isArray(liveness)
    || typeof liveness.passed !== 'boolean'
    || typeof liveness.score !== 'number'
    || !Number.isFinite(liveness.score)
    || liveness.score < 0
    || liveness.score > 100) {
    throw new IdswyftWebhookError('Webhook liveness result is invalid.')
  }

  return {
    sessionId,
    update: {
      status,
      current_step: kycStepForStatus(status),
      liveness_results: {
        passed: liveness.passed,
        score: liveness.score,
      },
      updated_at: updatedAt,
    },
  }
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

export async function handleIdswyftWebhook(req, res, { createSupabaseClient = createClient } = {}) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const secret = String(process.env.IDSWYFT_WEBHOOK_SECRET || '')
  if (!secret) return send(res, 503, { error: 'The verification webhook is not configured.' })

  try {
    const rawBody = await readIdswyftRawBody(req)
    if (!verifyIdswyftSignature(req.headers?.['x-idswyft-signature'], rawBody, secret)) {
      return send(res, 401, { error: 'Webhook signature is invalid or expired.' })
    }

    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new IdswyftWebhookError('Webhook payload is invalid JSON.')
    }
    const event = buildIdswyftSessionUpdate(payload)
    if (!event) return send(res, 200, { success: true, ignored: true })

    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!supabaseUrl || !serviceRoleKey) {
      return send(res, 503, { error: 'The verification database is not configured.' })
    }

    const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase
      .from('kyc_sessions')
      .update(event.update)
      .eq('id', event.sessionId)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Idswyft webhook database update failed', { code: error.code || 'unknown' })
      return send(res, 500, { error: 'The verification result could not be saved.' })
    }
    if (!data) return send(res, 404, { error: 'The verification session was not found.' })
    return send(res, 200, { success: true })
  } catch (error) {
    if (error instanceof IdswyftWebhookError) {
      return send(res, error.statusCode, { error: error.message })
    }
    console.error('Idswyft webhook processing failed')
    return send(res, 500, { error: 'The verification event could not be processed.' })
  }
}
