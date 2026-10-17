// Pluggable virus/malware scanning hook.
//
// Scanning is intentionally provider-agnostic: it only runs when a provider is
// configured through FILE_SCAN_API_URL + FILE_SCAN_API_KEY. The provider is
// expected to accept a multipart POST with a `file` field and answer with JSON
// including a verdict (`status`, `result`, `verdict`, and/or `infected`).
// When no provider is configured the hook reports `unavailable` so callers can
// surface an honest "not scanned" state instead of implying the file is clean.
const SCAN_TIMEOUT_MS = 20000
const MAX_SCAN_BYTES = 50 * 1024 * 1024

export function fileScanProvider() {
  const url = String(process.env.FILE_SCAN_API_URL || '').trim()
  const key = String(process.env.FILE_SCAN_API_KEY || '').trim()
  if (!url || !key) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return { url: parsed.toString(), host: parsed.host, key }
  } catch {
    return null
  }
}

export function isFileScanConfigured() {
  return fileScanProvider() !== null
}

export function unavailableScan(detail = 'No virus scanning provider is configured on the server.') {
  return { status: 'unavailable', detail, provider: null, scannedAt: new Date().toISOString() }
}

function interpretVerdict(payload) {
  const verdict = String(payload?.status || payload?.result || payload?.verdict || '').toLowerCase()
  const infected = payload?.infected === true || ['infected', 'malicious', 'unsafe', 'virus', 'threat'].includes(verdict)
  return infected ? 'infected' : 'clean'
}

export async function scanFileBuffer(buffer, { fileName = 'file', mimeType = 'application/octet-stream' } = {}) {
  const provider = fileScanProvider()
  if (!provider) return unavailableScan()
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (!bytes.byteLength) throw new Error('There is nothing to scan.')
  if (bytes.byteLength > MAX_SCAN_BYTES) {
    return { status: 'error', detail: 'The file is too large to scan.', provider: provider.host, scannedAt: new Date().toISOString() }
  }

  const body = new FormData()
  body.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), fileName)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}` },
      body,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return { status: 'error', detail: `The scanning provider rejected the request (HTTP ${response.status}).`, provider: provider.host, scannedAt: new Date().toISOString() }
    }
    return {
      status: interpretVerdict(payload),
      detail: payload?.detail || payload?.message || null,
      provider: provider.host,
      scannedAt: new Date().toISOString(),
    }
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    return {
      status: 'error',
      detail: aborted ? 'The scanning provider timed out.' : (error?.message || 'The scan failed.'),
      provider: provider.host,
      scannedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timer)
  }
}
