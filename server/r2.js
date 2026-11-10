// Cloudflare R2 (S3-compatible) access for the >2 MB attachment path.
//
// Credentials are server-only. The browser only ever receives short-lived
// presigned URLs (PUT for uploads, GET for reads), so the R2 keys never leave
// the server. Read-back is signed on demand; nothing public is exposed, which
// is why the bucket's r2.dev public access stays disabled.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const R2_URL_PREFIX = 'r2://'
export const R2_UPLOAD_URL_TTL_SECONDS = 15 * 60
export const R2_READ_URL_TTL_SECONDS = 60 * 60
export const R2_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const R2_MAX_SCAN_BYTES = 50 * 1024 * 1024

export function r2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim()
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: `https://${accountId}.r2.cloudflarestorage.com` }
}

export function isR2Configured() {
  return r2Config() !== null
}

export function isR2Reference(value) {
  const text = String(value || '')
  return text.startsWith(R2_URL_PREFIX) && text.length > R2_URL_PREFIX.length
}

export function r2ObjectKeyOf(value) {
  return isR2Reference(value) ? String(value).slice(R2_URL_PREFIX.length) : null
}

// The client is cached per configuration so warm serverless invocations reuse
// connections, while a changed endpoint or key still gets a fresh client.
let cachedClient = null
let cachedSignature = ''

function r2Client() {
  const config = r2Config()
  if (!config) throw new Error('R2 storage is not configured on the server.')
  const signature = `${config.endpoint}|${config.accessKeyId}|${config.bucket}`
  if (!cachedClient || signature !== cachedSignature) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
    cachedSignature = signature
  }
  return { client: cachedClient, config }
}

export async function presignUploadUrl(objectKey, { contentType } = {}) {
  const { client, config } = r2Client()
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      ContentType: contentType || 'application/octet-stream',
    }),
    { expiresIn: R2_UPLOAD_URL_TTL_SECONDS },
  )
}

export async function presignDownloadUrl(objectKey) {
  const { client, config } = r2Client()
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    { expiresIn: R2_READ_URL_TTL_SECONDS },
  )
}

export async function headR2Object(objectKey) {
  const { client, config } = r2Client()
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }))
    return { size: Number(result.ContentLength) || 0, contentType: result.ContentType || null }
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null
    throw error
  }
}

export async function readR2Object(objectKey, { maxBytes = R2_MAX_SCAN_BYTES } = {}) {
  const { client, config } = r2Client()
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }))
  const declared = Number(result.ContentLength) || 0
  if (declared && declared > maxBytes) throw new Error('The file is too large to read back.')
  const bytes = await result.Body.transformToByteArray()
  if (bytes.byteLength > maxBytes) throw new Error('The file is too large to read back.')
  return Buffer.from(bytes)
}

export async function deleteR2Object(objectKey) {
  const { client, config } = r2Client()
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }))
}
