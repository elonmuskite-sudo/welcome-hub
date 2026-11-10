// Server endpoints for the >2 MB attachment path (Cloudflare R2).
//
// The browser authenticates with its Supabase access token; the server resolves
// the caller, then issues short-lived presigned URLs so the R2 credentials stay
// on the server. Actions:
//   prepare  → validate + presign a PUT for a new object
//   finish   → verify the object, virus-scan it, and register it
//   sign     → issue short-lived signed GET URLs for media the caller may read
//   delete   → remove the caller's objects
import { createClient } from '@supabase/supabase-js'
import { isFileScanConfigured, scanFileBuffer } from '../server/fileScan.js'
import {
  R2_MAX_UPLOAD_BYTES,
  R2_MAX_SCAN_BYTES,
  R2_URL_PREFIX,
  deleteR2Object,
  headR2Object,
  isR2Configured,
  presignDownloadUrl,
  presignUploadUrl,
  readR2Object,
} from '../server/r2.js'

const MAX_SIGN_KEYS = 50
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Feed media is readable by every signed-in member, so object keys under the
// 'feed' scope need no per-object check. Chat attachments stay restricted to the
// chats that reference them.
const PUBLIC_SCOPES = new Set(['feed'])

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function authenticate(admin, req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

function safeObjectName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

function objectKeyFor(userId, chatId, fileName) {
  const scope = chatId ? String(chatId) : 'direct'
  return `${userId}/${scope}/${Date.now()}-${safeObjectName(fileName)}`
}

function keyOwner(objectKey) {
  return String(objectKey || '').split('/')[0]
}

function keyScope(objectKey) {
  return String(objectKey || '').split('/')[1]
}

// A caller may read an object when they own it, when it belongs to public feed
// media, when it is referenced by a message in one of their chats, or when they
// are an admin. Anything else is silently withheld from the response.
async function canReadKey(admin, userId, objectKey) {
  if (keyOwner(objectKey) === userId) return true
  if (PUBLIC_SCOPES.has(keyScope(objectKey))) return true

  const reference = `${R2_URL_PREFIX}${objectKey}`
  const { data: message } = await admin
    .from('messages')
    .select('chat_id')
    .eq('file_url', reference)
    .limit(1)
    .maybeSingle()
  if (message?.chat_id) {
    const { data: membership } = await admin
      .from('chat_members')
      .select('chat_id')
      .eq('chat_id', message.chat_id)
      .eq('profile_id', userId)
      .limit(1)
      .maybeSingle()
    if (membership) return true
  }

  try {
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' })
    if (isAdmin === true) return true
  } catch {
    /* admin lookup is best-effort */
  }
  return false
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item && item.length <= 512).slice(0, MAX_SIGN_KEYS)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const admin = serviceClient()
  if (!admin) return send(res, 503, { error: 'The storage service is not configured on the server.' })

  const user = await authenticate(admin, req)
  if (!user) return send(res, 401, { error: 'Sign in required.' })

  const action = String(req.body?.action || '')

  if (action === 'sign') {
    if (!isR2Configured()) return send(res, 503, { error: 'R2 storage is not configured on the server.' })
    const keys = stringList(req.body?.keys)
    const urls = {}
    for (const key of keys) {
      if (!(await canReadKey(admin, user.id, key))) continue
      try {
        urls[key] = await presignDownloadUrl(key)
      } catch {
        /* skip objects that cannot be signed */
      }
    }
    return send(res, 200, { urls })
  }

  if (!isR2Configured()) return send(res, 503, { error: 'R2 storage is not configured on the server.' })

  if (action === 'prepare') {
    const size = Number(req.body?.sizeBytes) || 0
    if (!size || size <= 0) return send(res, 400, { error: 'A file size is required.' })
    if (size > R2_MAX_UPLOAD_BYTES) {
      return send(res, 413, { error: `Files larger than ${Math.round(R2_MAX_UPLOAD_BYTES / (1024 * 1024))} MB cannot be uploaded.` })
    }
    const objectKey = objectKeyFor(user.id, req.body?.chatId, req.body?.fileName)
    const uploadUrl = await presignUploadUrl(objectKey, { contentType: req.body?.mimeType || 'application/octet-stream' })
    return send(res, 200, { objectKey, uploadUrl, reference: `${R2_URL_PREFIX}${objectKey}` })
  }

  if (action === 'finish') {
    const objectKey = String(req.body?.objectKey || '')
    if (!objectKey.startsWith(`${user.id}/`)) return send(res, 403, { error: 'This upload does not belong to your account.' })

    const head = await headR2Object(objectKey)
    if (!head) return send(res, 400, { error: 'The uploaded file could not be found in storage.' })
    if (head.size > R2_MAX_UPLOAD_BYTES) {
      await deleteR2Object(objectKey).catch(() => {})
      return send(res, 413, { error: 'The uploaded file is larger than the allowed limit.' })
    }

    let scanStatus = 'unavailable'
    if (isFileScanConfigured() && head.size <= R2_MAX_SCAN_BYTES) {
      try {
        const buffer = await readR2Object(objectKey)
        const scan = await scanFileBuffer(buffer, {
          fileName: String(req.body?.fileName || 'file'),
          mimeType: String(req.body?.mimeType || head.contentType || 'application/octet-stream'),
        })
        scanStatus = scan.status
        if (scan.status === 'infected') {
          await deleteR2Object(objectKey).catch(() => {})
          return send(res, 422, { error: 'This file was rejected because the virus scan flagged it as unsafe.' })
        }
      } catch {
        scanStatus = 'error'
      }
    }

    const storagePath = `${R2_URL_PREFIX}${objectKey}`
    const fileName = String(req.body?.fileName || 'file')
    const fileType = String(req.body?.fileType || 'file')
    const durationSeconds = req.body?.durationSeconds ?? null
    const { error } = await admin.from('storage_files').insert({
      user_id: user.id,
      chat_id: req.body?.chatId ? String(req.body.chatId) : null,
      file_name: fileName,
      file_type: fileType,
      mime_type: req.body?.mimeType || null,
      size_bytes: head.size,
      duration_seconds: durationSeconds,
      storage_path: storagePath,
    })
    if (error) {
      await deleteR2Object(objectKey).catch(() => {})
      return send(res, 500, { error: 'The file could not be registered.' })
    }
    return send(res, 200, { fileUrl: storagePath, fileName, fileType, durationSeconds, scanStatus })
  }

  if (action === 'delete') {
    const keys = stringList(req.body?.keys).filter((key) => key.startsWith(`${user.id}/`))
    const deleted = []
    for (const key of keys) {
      try {
        await deleteR2Object(key)
        deleted.push(key)
      } catch {
        /* keep going so one failure does not block the rest */
      }
    }
    if (deleted.length) {
      await admin
        .from('storage_files')
        .delete()
        .eq('user_id', user.id)
        .in('storage_path', deleted.map((key) => `${R2_URL_PREFIX}${key}`))
    }
    return send(res, 200, { deleted: deleted.length })
  }

  return send(res, 400, { error: 'Unknown storage action.' })
}
