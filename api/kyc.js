import { createHash } from 'node:crypto'
import Busboy from '@fastify/busboy'
import {
  authenticateKycRequest,
  kycErrorResponse,
  sendKycResponse,
  withKycUserTransaction,
} from '../server/kycAuth.js'
import {
  decryptSessionToken,
  fetchProviderStatus,
  initializeProviderSession,
  isKycUuid,
  KycError,
  MAX_KYC_FILE_BYTES,
  uploadProviderDocument,
  validateKycFile,
} from '../server/idswyftKyc.js'
import {
  createKycSession,
  getKycSessionToken,
  readKycSession,
  updateKycSession,
} from '../server/kycStore.js'
import { handleIdswyftWebhook } from '../server/idswyftWebhook.js'

// Route KYC operations and the provider webhook through one function to stay
// within Vercel Hobby's Serverless Function deployment limit.
export const config = { api: { bodyParser: false } }

const MAX_KYC_JSON_BYTES = 16 * 1024
const REQUIRED_STATUS = {
  front: 'AWAITING_FRONT',
  back: 'AWAITING_BACK',
  selfie: 'AWAITING_LIVE',
}

export async function readKycJson(req) {
  const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new KycError('The request must use JSON.', 415)
  }

  const declaredLength = Number(req.headers?.['content-length'] || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_KYC_JSON_BYTES) {
    throw new KycError('The request body is too large.', 413)
  }

  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_KYC_JSON_BYTES) throw new KycError('The request body is too large.', 413)
    chunks.push(chunk)
  }
  if (req.aborted) throw new KycError('The request was interrupted.', 400)

  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
  } catch {
    throw new KycError('The request body is invalid JSON.')
  }
}

export function readKycMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'multipart/form-data') {
      reject(new KycError('The upload must use multipart form data.', 415))
      return
    }
    const fields = {}
    let uploadedFile = null
    let parseError = null
    const parser = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_KYC_FILE_BYTES,
        files: 1,
        fields: 2,
        fieldSize: 256,
        parts: 3,
      },
    })

    const fail = (error) => {
      if (!parseError) parseError = error
    }

    parser.on('field', (name, value) => {
      if (!['verification_id', 'stage'].includes(name) || fields[name] !== undefined) {
        fail(new KycError('The upload form is invalid.'))
        return
      }
      fields[name] = value
    })
    parser.on('file', (name, stream, filename, _encoding, mimeType) => {
      if (uploadedFile || !['document', 'selfie'].includes(name)) {
        fail(new KycError('The upload form is invalid.'))
        stream.resume()
        return
      }

      const chunks = []
      let size = 0
      stream.on('data', (chunk) => {
        size += chunk.length
        chunks.push(chunk)
      })
      stream.on('limit', () => fail(new KycError('Choose a file no larger than 4 MB.', 413)))
      stream.on('end', () => {
        if (!stream.truncated) {
          uploadedFile = {
            fieldName: name,
            fileName: String(filename || '').slice(0, 120),
            mimeType: String(mimeType || '').toLowerCase(),
            buffer: Buffer.concat(chunks, size),
          }
        }
      })
    })
    parser.on('fieldsLimit', () => fail(new KycError('The upload form has too many fields.')))
    parser.on('filesLimit', () => fail(new KycError('Only one document may be uploaded at a time.')))
    parser.on('partsLimit', () => fail(new KycError('The upload form has too many parts.')))
    parser.on('error', reject)
    parser.on('finish', () => {
      if (parseError) return reject(parseError)
      if (!fields.verification_id || !fields.stage || !uploadedFile) {
        return reject(new KycError('Choose a document and verification step.'))
      }
      resolve({ fields, file: uploadedFile })
    })
    req.on('error', reject)
    req.on('aborted', () => reject(new KycError('The upload was interrupted.', 400)))
    req.pipe(parser)
  })
}

async function initialize(req, res) {
  if (req.method !== 'POST') return sendKycResponse(res, 405, { error: 'Method not allowed.' })
  try {
    const body = await readKycJson(req)
    if (body?.consent !== true) throw new KycError('Consent is required before starting verification.')
    const auth = await authenticateKycRequest(req)
    const allowed = await withKycUserTransaction(auth, async ({ userId, admin }) => {
      const bucketKey = createHash('sha256').update(`idswyft-kyc-init:${userId}`).digest('hex')
      const { data, error } = await admin.rpc('consume_auth_email_code_limit', {
        p_bucket_key: bucketKey,
        p_window_seconds: 86400,
        p_limit: 5,
      })
      if (error) throw new KycError('Verification rate limiting is unavailable.', 503)
      return data === true
    })
    if (!allowed) throw new KycError('You have started the maximum number of verification sessions for today.', 429)
    const session = await initializeProviderSession(auth.userId)
    await createKycSession(auth, session)
    return sendKycResponse(res, 201, {
      session: { id: session.id, status: session.status, metadata: session.metadata },
    })
  } catch (error) {
    return kycErrorResponse(res, error)
  }
}

async function upload(req, res) {
  if (req.method !== 'POST') return sendKycResponse(res, 405, { error: 'Method not allowed.' })
  try {
    const auth = await authenticateKycRequest(req)
    const { fields, file } = await readKycMultipart(req)
    const id = String(fields.verification_id)
    const stage = String(fields.stage)
    if (!isKycUuid(id) || !Object.hasOwn(REQUIRED_STATUS, stage)) {
      throw new KycError('The verification session or step is invalid.')
    }
    const expectedField = stage === 'selfie' ? 'selfie' : 'document'
    if (file.fieldName !== expectedField) throw new KycError('The upload form is invalid.')
    validateKycFile(file.buffer, file.mimeType, stage)

    const current = await readKycSession(auth, id)
    if (!current) throw new KycError('The verification session is unavailable.', 404)
    if (current.status !== REQUIRED_STATUS[stage]) {
      throw new KycError('This verification step is not currently available.', 409)
    }

    const result = await uploadProviderDocument({
      id,
      sessionToken: decryptSessionToken(current.session_token),
      stage,
      file: {
        ...file,
        fileName: `${stage}.${file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg'}`,
      },
    })
    const session = await updateKycSession(auth, id, result)
    if (!session) throw new KycError('The verification session is no longer available.', 404)
    return sendKycResponse(res, 200, { session })
  } catch (error) {
    return kycErrorResponse(res, error)
  }
}

async function status(req, res) {
  if (req.method !== 'GET') return sendKycResponse(res, 405, { error: 'Method not allowed.' })
  try {
    const auth = await authenticateKycRequest(req)
    const id = typeof req.query?.id === 'string' ? req.query.id : ''
    if (id && !isKycUuid(id)) throw new KycError('The verification session ID is invalid.')
    const current = await readKycSession(auth, id || undefined)
    if (!current) return sendKycResponse(res, 200, { session: null })

    const providerStatus = await fetchProviderStatus(current.id, getKycSessionToken(current))
    const session = await updateKycSession(auth, current.id, providerStatus)
    if (!session) throw new KycError('The verification session is no longer available.', 404)
    return sendKycResponse(res, 200, { session })
  } catch (error) {
    return kycErrorResponse(res, error)
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  if (action === 'init' || action === 'initialize') return initialize(req, res)
  if (action === 'upload') return upload(req, res)
  if (action === 'status') return status(req, res)
  if (action === 'webhook') return handleIdswyftWebhook(req, res)
  return sendKycResponse(res, 404, { error: 'Not found.' })
}
