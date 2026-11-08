import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { readKycJson, readKycMultipart } from '../api/kyc.js'
import {
  decryptSessionToken,
  encryptSessionToken,
  initializeProviderSession,
  MAX_KYC_FILE_BYTES,
  kycStepForStatus,
  normalizeProviderStatus,
  summarizeProviderMetadata,
  uploadProviderDocument,
  validateKycFile,
} from '../server/idswyftKyc.js'

test('session tokens are encrypted with an authenticated envelope', () => {
  const previousKey = process.env.IDSWYFT_SESSION_ENCRYPTION_KEY
  process.env.IDSWYFT_SESSION_ENCRYPTION_KEY = 'a'.repeat(64)
  try {
    const token = 'provider-session-secret'
    const encrypted = encryptSessionToken(token)
    assert.match(encrypted, /^v1\./)
    assert.equal(encrypted.includes(token), false)
    assert.equal(decryptSessionToken(encrypted), token)
    const [version, iv, tag, ciphertext] = encrypted.split('.')
    const changedCiphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`
    assert.throws(() => decryptSessionToken(`${version}.${iv}.${tag}.${changedCiphertext}`), /cannot be read/)
  } finally {
    if (previousKey === undefined) delete process.env.IDSWYFT_SESSION_ENCRYPTION_KEY
    else process.env.IDSWYFT_SESSION_ENCRYPTION_KEY = previousKey
  }
})

test('document validation accepts only supported MIME types with matching content', () => {
  assert.equal(validateKycFile(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'front'), 'image/jpeg')
  assert.equal(
    validateKycFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png', 'back'),
    'image/png',
  )
  assert.equal(validateKycFile(Buffer.from('%PDF-1.7'), 'application/pdf', 'front'), 'application/pdf')
  assert.throws(
    () => validateKycFile(Buffer.from('RIFF0000WEBP'), 'image/webp', 'front'),
    /WebP is not supported/,
  )
  assert.throws(
    () => validateKycFile(Buffer.from([0xff, 0xd8, 0xff]), 'image/png', 'selfie'),
    /contents do not match/,
  )
  assert.throws(
    () => validateKycFile(Buffer.from('%PDF-1.7'), 'application/pdf', 'selfie'),
    /WebP is not supported/,
  )
  const oversized = Buffer.alloc(MAX_KYC_FILE_BYTES + 1)
  oversized.set([0xff, 0xd8, 0xff])
  assert.throws(() => validateKycFile(oversized, 'image/jpeg', 'front'), /no larger than 4 MB/)
})

test('provider status is validated and KYC metadata excludes extracted personal values', () => {
  const providerResponse = {
    data: {
      status: 'APPROVED',
      ocr: {
        confidence: 98,
        fields: { document_number: 'ID-SECRET-123', full_name: 'Sensitive Name' },
      },
      liveness_score: 97,
      verdict: 'APPROVED',
    },
  }
  assert.equal(normalizeProviderStatus(providerResponse), 'APPROVED')
  assert.equal(normalizeProviderStatus({ code: 'LIVENESS_FAILED' }), 'LIVENESS_FAILED')
  assert.equal(normalizeProviderStatus({ status: 'REVIEW' }), 'REVIEW_REQUIRED')
  assert.equal(normalizeProviderStatus({ status: 'UNDER_REVIEW' }), 'REVIEW_REQUIRED')
  assert.equal(kycStepForStatus('AWAITING_FRONT'), 2)
  assert.equal(kycStepForStatus('AWAITING_BACK'), 3)
  assert.equal(kycStepForStatus('AWAITING_LIVE'), 4)
  assert.equal(kycStepForStatus('REVIEW_REQUIRED'), 5)
  assert.deepEqual(summarizeProviderMetadata({ liveness: null }), {})
  assert.throws(() => normalizeProviderStatus({ status: 'UNKNOWN_PROVIDER_STATE' }), /unsupported/)

  const metadata = summarizeProviderMetadata(providerResponse)
  assert.equal(metadata.ocr.confidence, 98)
  assert.deepEqual(metadata.ocr.fields, ['document_number', 'full_name'])
  assert.equal(metadata.liveness.score, 97)
  assert.equal(JSON.stringify(metadata).includes('ID-SECRET-123'), false)
  assert.equal(JSON.stringify(metadata).includes('Sensitive Name'), false)
})

test('provider initialization and uploads use the server API key and expected form fields', async () => {
  const previous = {
    apiUrl: process.env.IDSWYFT_API_URL,
    apiKey: process.env.IDSWYFT_API_KEY,
    encryptionKey: process.env.IDSWYFT_SESSION_ENCRYPTION_KEY,
    fetch: globalThis.fetch,
  }
  process.env.IDSWYFT_API_URL = 'https://idswyft.example.test'
  process.env.IDSWYFT_API_KEY = 'test-api-key'
  process.env.IDSWYFT_SESSION_ENCRYPTION_KEY = 'b'.repeat(64)
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    if (options.method === 'POST' && options.headers['Content-Type'] === 'application/json') {
      return new Response(JSON.stringify({
        verification_id: '123e4567-e89b-12d3-a456-426614174000',
        session_token: 'test-session-token',
        status: 'AWAITING_FRONT',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ status: 'AWAITING_BACK' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const initialized = await initializeProviderSession('123e4567-e89b-12d3-a456-426614174001')
    assert.equal(initialized.status, 'AWAITING_FRONT')
    assert.equal(decryptSessionToken(initialized.encryptedToken), 'test-session-token')
    assert.equal(requests[0].url, 'https://idswyft.example.test/api/v2/verify/sessions')
    assert.equal(requests[0].options.headers['X-API-Key'], 'test-api-key')
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    })

    const result = await uploadProviderDocument({
      id: initialized.id,
      sessionToken: 'test-session-token',
      stage: 'front',
      file: {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        fileName: 'front.jpg',
        mimeType: 'image/jpeg',
      },
    })
    assert.equal(result.status, 'AWAITING_BACK')
    assert.equal(requests[1].url, `https://idswyft.example.test/api/v2/verify/${initialized.id}/front-document`)
    assert.equal(requests[1].options.headers['X-API-Key'], 'test-api-key')
    assert.equal(requests[1].options.headers.Authorization, 'Bearer test-session-token')
    assert.equal(requests[1].options.body.has('document'), true)
    assert.equal(requests[1].options.body.has('selfie'), false)
  } finally {
    globalThis.fetch = previous.fetch
    for (const [name, value] of [
      ['IDSWYFT_API_URL', previous.apiUrl],
      ['IDSWYFT_API_KEY', previous.apiKey],
      ['IDSWYFT_SESSION_ENCRYPTION_KEY', previous.encryptionKey],
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('multipart KYC uploads parse the expected fields and file bytes', async () => {
  const boundary = 'kyc-upload-test'
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="verification_id"\r\n\r\n123e4567-e89b-12d3-a456-426614174000\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="stage"\r\n\r\nfront\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="front.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
  )
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`)
  const req = Readable.from([Buffer.concat([fileHeader, Buffer.from([0xff, 0xd8, 0xff]), ending])])
  req.method = 'POST'
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }

  const { fields, file } = await readKycMultipart(req)
  assert.deepEqual(fields, {
    verification_id: '123e4567-e89b-12d3-a456-426614174000',
    stage: 'front',
  })
  assert.equal(file.fieldName, 'document')
  assert.equal(file.mimeType, 'image/jpeg')
  assert.deepEqual(file.buffer, Buffer.from([0xff, 0xd8, 0xff]))
})

test('KYC initialization parses bounded JSON requests', async () => {
  const req = Readable.from([Buffer.from('{"consent":true}')])
  req.headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': '16',
  }
  assert.deepEqual(await readKycJson(req), { consent: true })

  const unsupported = Readable.from([Buffer.from('{}')])
  unsupported.headers = { 'content-type': 'text/plain' }
  await assert.rejects(readKycJson(unsupported), /must use JSON/)

  const malformed = Readable.from([Buffer.from('{')])
  malformed.headers = { 'content-type': 'application/json' }
  await assert.rejects(readKycJson(malformed), /invalid JSON/)

  const oversized = Readable.from([Buffer.alloc(16 * 1024 + 1)])
  oversized.headers = { 'content-type': 'application/json' }
  await assert.rejects(readKycJson(oversized), /too large/)
})

test('KYC multipart parser rejects non-multipart requests', async () => {
  const req = Readable.from([Buffer.from('{}')])
  req.headers = { 'content-type': 'application/json' }
  await assert.rejects(readKycMultipart(req), /must use multipart form data/)
})
