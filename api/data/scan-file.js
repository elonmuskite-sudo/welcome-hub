import { createClient } from '@supabase/supabase-js'
import { isFileScanConfigured, scanFileBuffer, unavailableScan } from '../../server/fileScan.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(body)
}

const MAX_FETCH_BYTES = 50 * 1024 * 1024

// Only allow the server to fetch files from this project's own storage, so a
// signed-in user cannot turn the scan endpoint into an SSRF proxy.
function allowedStorageOrigins() {
  const origins = new Set()
  for (const value of [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL]) {
    if (!value) continue
    try { origins.add(new URL(value).origin) } catch { /* ignore malformed */ }
  }
  return origins
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return send(res, 503, { error: 'The scan service is not configured on the server.' })

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return send(res, 401, { error: 'Sign in required.' })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return send(res, 401, { error: 'Sign in required.' })

  // No provider configured: report an explicit, honest status.
  if (!isFileScanConfigured()) return send(res, 200, unavailableScan())

  const fileUrl = String(req.body?.fileUrl || '')
  if (!fileUrl) return send(res, 400, { error: 'A file URL is required.' })
  let parsed
  try {
    parsed = new URL(fileUrl)
  } catch {
    return send(res, 400, { error: 'The file URL is invalid.' })
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !allowedStorageOrigins().has(parsed.origin)) {
    return send(res, 400, { error: 'The file URL is not an approved storage location.' })
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    let response
    try {
      response = await fetch(parsed.toString(), { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return send(res, 200, { status: 'error', detail: `The uploaded file could not be read (HTTP ${response.status}).` })
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_FETCH_BYTES) return send(res, 200, { status: 'error', detail: 'The file is too large to scan.' })
    const result = await scanFileBuffer(buffer, {
      fileName: String(req.body?.fileName || 'file'),
      mimeType: String(req.body?.mimeType || 'application/octet-stream'),
    })
    return send(res, 200, result)
  } catch (scanError) {
    console.error('Chat file scan failed', scanError)
    return send(res, 200, { status: 'error', detail: scanError?.message || 'The scan could not be completed.' })
  }
}
