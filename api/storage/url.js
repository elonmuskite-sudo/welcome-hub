import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const READ_TTL_SECONDS = 3600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!fileKey) return send(res, 400, { error: 'A file key is required.' })

  // Authorise from the server-owned registry row, never the client-supplied
  // channelId, so a caller cannot claim membership to unlock another's file.
  const { data: attachment, error: lookupError } = await admin
    .from('attachments')
    .select('user_id, channel_id')
    .eq('file_key', fileKey)
    .maybeSingle()
  if (lookupError) return send(res, 500, { error: 'The attachment could not be resolved.' })
  if (!attachment) return send(res, 404, { error: 'This attachment is unavailable.' })

  const isOwner = attachment.user_id === userId
  const channelId = attachment.channel_id ? String(attachment.channel_id) : null

  if (!isOwner) {
    if (channelId === 'feed') {
      // Feed media is public to any signed-in member.
    } else if (channelId && UUID_RE.test(channelId)) {
      const { data: member } = await admin
        .from('chat_members')
        .select('chat_id')
        .eq('chat_id', channelId)
        .eq('profile_id', userId)
        .maybeSingle()
      if (!member) return send(res, 403, { error: 'You do not have access to this attachment.' })
    } else {
      return send(res, 403, { error: 'You do not have access to this attachment.' })
    }
  }

  // Feed media gets a stable public URL when a public base is configured so
  // <img>/<video> keep working; otherwise fall back to a signed link.
  const publicBase = String(process.env.R2_PUBLIC_BASE_URL || process.env.VITE_R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (channelId === 'feed' && publicBase) {
    return send(res, 200, { url: `${publicBase}/${fileKey}` })
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

  return send(res, 200, { url: downloadUrl })
}
