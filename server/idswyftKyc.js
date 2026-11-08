import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const MAX_KYC_FILE_BYTES = 4 * 1024 * 1024
export const KYC_STATUSES = new Set([
  'AWAITING_FRONT',
  'AWAITING_BACK',
  'AWAITING_LIVE',
  'PROCESSING',
  'APPROVED',
  'HARD_REJECTED',
  'SOFT_REJECTED',
  'LIVENESS_FAILED',
  'REVIEW_REQUIRED',
  'FAILED',
  'EXPIRED',
])
const PROVIDER_STATUS_ALIASES = new Map([
  ['REVIEW', 'REVIEW_REQUIRED'],
  ['UNDER_REVIEW', 'REVIEW_REQUIRED'],
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])

export class KycError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'KycError'
    this.statusCode = status
  }
}

export function isKycUuid(value) {
  return UUID_PATTERN.test(String(value || ''))
}

function encryptionKey() {
  const raw = String(process.env.IDSWYFT_SESSION_ENCRYPTION_KEY || '').trim()
  const key = /^[\da-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64url')
  if (key.length !== 32) {
    throw new KycError('The KYC session encryption key is not configured correctly.', 503)
  }
  return key
}

export function encryptSessionToken(token) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 4096) {
    throw new KycError('The verification provider returned an invalid session.', 502)
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptSessionToken(envelope) {
  const [version, ivText, tagText, encryptedText] = String(envelope || '').split('.')
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new KycError('The stored verification session cannot be read. Start a new verification.', 409)
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new KycError('The stored verification session cannot be read. Start a new verification.', 409)
  }
}

function getProviderConfiguration() {
  const endpoint = String(process.env.IDSWYFT_API_URL || '').trim()
  const apiKey = String(process.env.IDSWYFT_API_KEY || '').trim()
  if (!endpoint || !apiKey) {
    throw new KycError('The identity verification provider is not configured.', 503)
  }
  let base
  try {
    base = new URL(endpoint)
  } catch {
    throw new KycError('The identity verification provider URL is invalid.', 503)
  }
  const localHttp = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    && base.protocol === 'http:'
  if (base.protocol !== 'https:' && !localHttp) {
    throw new KycError('The identity verification provider must use HTTPS.', 503)
  }
  return { base, apiKey }
}

function providerUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new KycError('The identity verification provider path is invalid.', 503)
  }
  const { base } = getProviderConfiguration()
  const url = new URL(path, base)
  if (url.origin !== base.origin || url.username || url.password) {
    throw new KycError('The identity verification provider path is invalid.', 503)
  }
  return url
}

function pathForSession(template, verificationId) {
  const path = String(template || '').replaceAll('{id}', encodeURIComponent(verificationId))
  if (path.includes('{id}')) throw new KycError('The identity verification provider path is invalid.', 503)
  return path
}

async function providerRequest(path, { method = 'GET', body, sessionToken } = {}) {
  const { apiKey } = getProviderConfiguration()
  const url = providerUrl(path)
  const headers = { Accept: 'application/json', 'X-API-Key': apiKey }
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
      signal: controller.signal,
      redirect: 'error',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new KycError('The identity provider did not respond in time.', 504)
    }
    throw new KycError('Could not reach the identity verification provider.', 502)
  } finally {
    clearTimeout(timeout)
  }

  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > 1024 * 1024) {
    throw new KycError('The identity verification provider returned an invalid response.', 502)
  }
  const text = await response.text()
  if (text.length > 1024 * 1024) {
    throw new KycError('The identity verification provider returned an invalid response.', 502)
  }
  let payload = {}
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new KycError('The identity verification provider returned an invalid response.', 502)
    }
  }
  if (!response.ok) {
    const providerStatus = String(
      payload?.status || payload?.code || payload?.data?.status || payload?.data?.code || '',
    ).toUpperCase()
    if (providerStatus !== 'LIVENESS_FAILED') {
      throw new KycError('The identity provider could not process this verification step.', 502)
    }
  }
  return payload
}

function providerData(payload) {
  const result = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  return result?.session && typeof result.session === 'object' ? result.session : result
}

export function normalizeProviderStatus(payload) {
  const record = providerData(payload)
  const rawStatus = String(record?.status || record?.code || record?.error_code || '').trim().toUpperCase()
  const status = PROVIDER_STATUS_ALIASES.get(rawStatus) || rawStatus
  if (!KYC_STATUSES.has(status)) {
    throw new KycError('The identity provider returned an unsupported verification status.', 502)
  }
  return status
}

export function kycStepForStatus(status) {
  if (status === 'AWAITING_FRONT') return 2
  if (status === 'AWAITING_BACK') return 3
  if (status === 'AWAITING_LIVE') return 4
  return 5
}

function safeScore(value) {
  const score = Number(value)
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null
}

function safeLabel(value) {
  const label = String(value || '').trim().toUpperCase()
  return /^[A-Z0-9 _-]{1,40}$/.test(label) ? label : null
}

export function summarizeProviderMetadata(payload) {
  const record = providerData(payload) || {}
  const ocr = record.ocr || record.ocr_result || record.ocr_extraction
  const liveness = record.liveness || record.liveness_result
  const fieldSource = ocr?.fields && typeof ocr.fields === 'object' ? ocr.fields : ocr
  const fieldNames = fieldSource && typeof fieldSource === 'object'
    ? Object.keys(fieldSource)
      .filter((name) => /^[a-zA-Z0-9_-]{1,40}$/.test(name))
      .slice(0, 40)
    : []
  const livenessResult = liveness && typeof liveness === 'object' ? liveness : null
  const crossValidation = record.cross_validation || record.cross_validation_results
    || record.cross_validation_result
  const crossValidationResult = crossValidation && typeof crossValidation === 'object'
    ? crossValidation
    : null
  const rejectionCode = String(record.rejection_code || record.rejection_reason || '')
    .trim()
    .toUpperCase()
  const summary = {
    ocr: ocr ? {
      status: safeLabel(ocr.status || (fieldNames.length ? 'EXTRACTED' : 'UNAVAILABLE')),
      confidence: safeScore(ocr.confidence ?? ocr.score),
      fields: fieldNames,
    } : null,
    liveness: (liveness !== undefined && liveness !== null) || record.liveness_score !== undefined ? {
      score: safeScore(livenessResult ? livenessResult.score : liveness ?? record.liveness_score),
      verdict: safeLabel(livenessResult ? livenessResult.verdict : record.liveness_verdict),
    } : null,
    cross_validation: crossValidationResult ? {
      status: safeLabel(crossValidationResult.status),
      confidence: safeScore(crossValidationResult.confidence ?? crossValidationResult.score),
      verdict: safeLabel(crossValidationResult.verdict),
    } : null,
    verdict: safeLabel(record.verdict || record.decision),
    rejection_reason: /^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(rejectionCode) ? rejectionCode : null,
  }
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== null))
}

export async function initializeProviderSession(userId) {
  if (!isKycUuid(userId)) throw new KycError('The signed-in account is invalid.', 401)
  const payload = await providerRequest(process.env.IDSWYFT_INIT_PATH || '/api/v2/verify/sessions', {
    method: 'POST',
    body: { user_id: userId },
  })
  const record = providerData(payload)
  if (!isKycUuid(record?.verification_id) || typeof record?.session_token !== 'string') {
    throw new KycError('The identity provider returned an invalid verification session.', 502)
  }
  const status = normalizeProviderStatus(payload)
  if (status !== 'AWAITING_FRONT') {
    throw new KycError('The identity provider returned an unexpected initial status.', 502)
  }
  return {
    id: record.verification_id,
    encryptedToken: encryptSessionToken(record.session_token),
    status,
    metadata: summarizeProviderMetadata(payload),
  }
}

export async function uploadProviderDocument({ id, sessionToken, stage, file }) {
  const routeByStage = {
    front: 'front-document',
    back: 'back-document',
    selfie: 'live-capture',
  }
  const route = routeByStage[stage]
  if (!route) throw new KycError('The verification step is invalid.')
  const form = new FormData()
  const fieldName = stage === 'selfie' ? 'selfie' : 'document'
  form.append(fieldName, new Blob([file.buffer], { type: file.mimeType }), file.fileName)
  const path = `/api/v2/verify/${encodeURIComponent(id)}/${route}`
  const payload = await providerRequest(path, { method: 'POST', body: form, sessionToken })
  const record = providerData(payload)
  const remoteStatus = record?.status || record?.code || record?.error_code
    ? { status: normalizeProviderStatus(payload), metadata: {} }
    : await fetchProviderStatus(id, sessionToken)
  return {
    status: remoteStatus.status,
    metadata: {
      ...summarizeProviderMetadata(payload),
      ...remoteStatus.metadata,
    },
  }
}

export async function fetchProviderStatus(id, sessionToken) {
  const path = pathForSession(
    process.env.IDSWYFT_STATUS_PATH || '/api/v2/verify/{id}',
    id,
  )
  const payload = await providerRequest(path, { sessionToken })
  return {
    status: normalizeProviderStatus(payload),
    metadata: summarizeProviderMetadata(payload),
  }
}

export function validateKycFile(buffer, mimeType, stage) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_KYC_FILE_BYTES) {
    throw new KycError('Choose a file no larger than 4 MB.', 413)
  }
  const allowed = stage === 'selfie' ? ['image/jpeg', 'image/png'] : [...MIME_TYPES]
  if (!allowed.includes(mimeType)) {
    throw new KycError('Choose a JPEG, PNG, or PDF file. WebP is not supported.', 415)
  }
  const detectedType = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'image/jpeg'
    : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : buffer.subarray(0, 5).toString('ascii') === '%PDF-'
        ? 'application/pdf'
        : null
  if (detectedType !== mimeType) {
    throw new KycError('The file contents do not match the selected file type.', 415)
  }
  return detectedType
}
