import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const READ_TTL_SECONDS = 3600

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

  const fileKey = String(req.body?.fileKey || '')
  const fileSize = Number(req.body?.fileSize)
  const mimeType = String(req.body?.mimeType || 'application/octet-stream')
  const channelId = req.body?.channelId ? String(req.body.channelId) : null
  if (!fileKey || !Number.isFinite(fileSize) || fileSize <= 0) {
    return send(res, 400, { error: 'A file key and size are required.' })
  }
  // The object key must live under the caller's own folder; a client cannot
  // confirm (and therefore bill) another user's upload.
  if (!fileKey.startsWith(`chat-attachments/${userId}/`)) {
    return send(res, 403, { error: 'This upload does not belong to your account.' })
  }

  const { error: commitError } = await admin.rpc('commit_user_storage', {
    p_user_id: userId,
    p_file_size: fileSize,
  })
  if (commitError) {
    if (String(commitError.message || '').includes('STORAGE_QUOTA_EXCEEDED')) {
      return send(res, 413, { error: 'Quota Exceeded: not enough remaining space in your 10 GB allocation.' })
    }
    return send(res, 500, { error: 'Storage usage could not be recorded.' })
  }

  const { error: insertError } = await admin
    .from('attachments')
    .insert({ user_id: userId, channel_id: channelId, file_key: fileKey, mime_type: mimeType, file_size: fileSize })

  if (insertError && insertError.code !== '23505') {
    // Reverse the deduction so a failed registry insert does not leak quota.
    await admin.rpc('commit_user_storage', { p_user_id: userId, p_file_size: -fileSize })
    return send(res, 500, { error: 'The attachment could not be registered.' })
  }

  let downloadUrl
  try {
    downloadUrl = await getSignedUrl(
      config.client,
      new GetObjectCommand({ Bucket: config.bucket, Key: fileKey }),
      { expiresIn: READ_TTL_SECONDS },
    )
  } catch (signError) {
    console.error('R2 object link failed', signError)
    return send(res, 500, { error: 'A secure attachment link could not be created.' })
  }

  return send(res, 200, { fileKey, fileSize, url: downloadUrl })
}
