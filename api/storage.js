import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// The three object-storage endpoints share a single Serverless Function so the
// deployment stays inside the Hobby plan's twelve-function ceiling. Vercel only
// route-matches bracket segments for Next.js projects, so `/api/storage/:action`
// is sent here by the rewrite in vercel.json, which turns the path segment into
// the `action` query parameter. The public paths are unchanged:
// /api/storage/presign, /api/storage/confirm and /api/storage/url.

const MAX_BYTES = 10737418240
const MAX_INLINE_BYTES = 2097152
const PRESIGN_TTL_SECONDS = 900
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

function slugify(fileName) {
  const base = String(fileName || 'file').split(/[\\/]/).pop()
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 120) || 'file'
}

async function authorize(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    send(res, 503, { error: 'Object storage is not configured on the server.' })
    return null
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) {
    send(res, 401, { error: 'Sign in required.' })
    return null
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    send(res, 401, { error: 'Sign in required.' })
    return null
  }

  return { admin, userId: data.user.id }
}

async function presignHandler(req, res, { admin, userId }, config) {
  const fileSize = Number(req.body?.fileSize)
  if (!Number.isFinite(fileSize) || fileSize <= 0) return send(res, 400, { error: 'A valid file size is required.' })
  if (fileSize <= MAX_INLINE_BYTES) {
    return send(res, 400, { error: 'Files up to 2 MB are stored inline; use /api/storage/inline for this file.' })
  }
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

async function confirmHandler(req, res, { admin, userId }, config) {
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

async function urlHandler(req, res, { admin, userId }, config) {
  const fileKey = req.body?.fileKey ? String(req.body.fileKey) : ''
  const attachmentId = req.body?.attachmentId ? String(req.body.attachmentId) : ''
  if (!fileKey && !attachmentId) {
    return send(res, 400, { error: 'A file key or attachment id is required.' })
  }

  // Authorise from the server-owned registry row, never the client-supplied
  // channelId, so a caller cannot claim membership to unlock another's file.
  let lookup = admin.from('attachments').select('user_id, channel_id, storage_type, file_data, mime_type')
  lookup = attachmentId ? lookup.eq('id', attachmentId) : lookup.eq('file_key', fileKey)
  const { data: attachment, error: lookupError } = await lookup.maybeSingle()
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

  if (attachment.storage_type === 'inline_base64') {
    if (!attachment.file_data) return send(res, 404, { error: 'This attachment is unavailable.' })
    return send(res, 200, {
      url: `data:${String(attachment.mime_type || 'application/octet-stream')};base64,${attachment.file_data}`,
    })
  }
  if (!config) return send(res, 503, { error: 'Object storage is not configured on the server.' })

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

function isValidBase64(value) {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

async function inlineHandler(req, res, { admin, userId }) {
  const fileName = String(req.body?.fileName || 'file').slice(0, 200)
  const mimeType = String(req.body?.fileType || req.body?.mimeType || 'application/octet-stream')
  const fileSize = Number(req.body?.fileSize)
  const channelId = req.body?.channelId ? String(req.body.channelId) : null
  const base64Data = String(req.body?.base64Data || '')

  if (!Number.isFinite(fileSize) || fileSize <= 0) return send(res, 400, { error: 'A valid file size is required.' })
  if (fileSize > MAX_INLINE_BYTES) {
    return send(res, 413, { error: 'This file is larger than 2 MB; use /api/storage/presign instead.' })
  }
  if (!base64Data || base64Data.length > MAX_INLINE_BYTES * 2) {
    return send(res, 400, { error: 'A valid inline payload is required.' })
  }
  if (!isValidBase64(base64Data)) return send(res, 400, { error: 'The inline payload is not valid Base64.' })

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

  const { data: inserted, error: insertError } = await admin
    .from('attachments')
    .insert({
      user_id: userId,
      channel_id: channelId,
      file_name: fileName,
      storage_type: 'inline_base64',
      file_data: base64Data,
      mime_type: mimeType,
      file_size: fileSize,
    })
    .select('id')
    .single()

  if (insertError) {
    // Reverse the deduction so a failed registry insert does not leak quota.
    await admin.rpc('commit_user_storage', { p_user_id: userId, p_file_size: -fileSize })
    return send(res, 500, { error: 'The attachment could not be registered.' })
  }

  return send(res, 200, {
    attachmentId: inserted.id,
    fileKey: null,
    fileSize,
    url: `data:${mimeType};base64,${base64Data}`,
  })
}

const ACTIONS = {
  presign: presignHandler,
  confirm: confirmHandler,
  inline: inlineHandler,
  url: urlHandler,
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const action = String(req.query?.action || '')
  const run = ACTIONS[action]
  if (!run) return send(res, 404, { error: 'Unknown storage action.' })

  const auth = await authorize(req, res)
  if (!auth) return

  // Inline attachments live in the database, so they must keep working even
  // when the bucket is unconfigured; only the bucket-backed actions need R2.
  const config = storageConfig()
  if (!config && (action === 'presign' || action === 'confirm')) {
    return send(res, 503, { error: 'Object storage is not configured on the server.' })
  }

  return run(req, res, auth, config)
}
