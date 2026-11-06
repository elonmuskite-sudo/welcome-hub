import Busboy from '@fastify/busboy'
import { authenticateKycRequest, kycErrorResponse, sendKycResponse } from '../../server/kycAuth.js'
import {
  decryptSessionToken,
  isKycUuid,
  KycError,
  validateKycFile,
  uploadProviderDocument,
  MAX_KYC_FILE_BYTES,
} from '../../server/idswyftKyc.js'
import { readKycSession, updateKycSession } from '../../server/kycStore.js'

export const config = { api: { bodyParser: false } }

const REQUIRED_STATUS = {
  front: 'AWAITING_FRONT',
  back: 'AWAITING_BACK',
  selfie: 'AWAITING_LIVE',
}

export function readKycMultipart(req) {
  return new Promise((resolve, reject) => {
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
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
