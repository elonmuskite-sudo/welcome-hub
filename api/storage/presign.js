import { createClient } from '@supabase/supabase-js'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const MAX_BYTES = 10737418240
const PRESIGN_TTL_SECONDS = 900

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

function storageConfig() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  }
}

function slugify(fileName) {
  const base = String(fileName || 'file').split(/[\\/]/).pop()
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 120) || 'file'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return send(res, 503, { error: 'Object storage is not configured on the server.' })

  const config = storageConfig()
  if (!config) return send(res, 503, { error: 'Object storage is not configured on the server.' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return send(res, 401, { error: 'Sign in required.' })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return send(res, 401, { error: 'Sign in required.' })
  const userId = data.user.id

  const fileSize = Number(req.body?.fileSize)
  if (!Number.isFinite(fileSize) || fileSize <= 0) return send(res, 400, { error: 'A valid file size is required.' })
  if (fileSize > MAX_BYTES) {
    return send(res, 413, { error: 'Quota Exceeded: this file is larger than your 10 GB allocation.' })
  }

  // Server-side transactional quota check (locks the row) so parallel uploads
  // cannot race past the fixed 10GB limit.
  const { error: reserveError } = await admin.rpc('reserve_user_storage', {
    p_user_id: userId,
    p_file_size: fileSize,
  })
  if (reserveError) {
    if (String(reserveError.message || '').includes('STORAGE_QUOTA_EXCEEDED')) {
      return send(res, 413, { error: 'Quota Exceeded: not enough remaining space in your 10 GB allocation.' })
    }
    return send(res, 500, { error: 'The storage quota could not be checked.' })
  }

  const fileKey = `chat-attachments/${userId}/${Date.now()}-${slugify(req.body?.fileName)}`
  let uploadUrl
  try {
    uploadUrl = await getSignedUrl(
      config.client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
        ContentType: String(req.body?.fileType || 'application/octet-stream'),
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    )
  } catch (signError) {
    console.error('R2 presign failed', signError)
    return send(res, 500, { error: 'A secure upload link could not be created.' })
  }

  return send(res, 200, { uploadUrl, fileKey, maxAllowedSize: MAX_BYTES })
}
