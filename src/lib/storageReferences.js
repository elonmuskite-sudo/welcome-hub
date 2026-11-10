// Pure helpers describing how attachments are routed between Supabase Storage
// (small files) and Cloudflare R2 (large files), plus the `r2://` reference
// format stored on messages and feed media. Kept free of browser and Supabase
// imports so the rules can be unit tested.

// Files at or below this size stay on Supabase Storage; anything larger is
// uploaded straight to R2 with a server-issued presigned PUT.
export const R2_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024

// Largest object the R2 path accepts. The server re-checks this on upload.
export const R2_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

// Large media is referenced as `r2://<objectKey>`: only the object key is
// persisted, and a short-lived signed GET URL is issued on demand.
export const R2_URL_PREFIX = 'r2://'

export function shouldUseR2(sizeBytes) {
  return Number(sizeBytes) > R2_UPLOAD_THRESHOLD_BYTES
}

export function r2Reference(objectKey) {
  return `${R2_URL_PREFIX}${objectKey}`
}

export function isR2Reference(value) {
  const text = String(value || '')
  return text.startsWith(R2_URL_PREFIX) && text.length > R2_URL_PREFIX.length
}

export function r2ObjectKeyOf(value) {
  return isR2Reference(value) ? String(value).slice(R2_URL_PREFIX.length) : null
}

// An object key is `<ownerId>/<scope>/<timestamp>-<name>`. The first segment is
// the uploader (used by the server to authorise signing and deletion) and the
// second is the chat id, the literal 'feed', or 'direct'.
export function r2KeyOwner(objectKey) {
  return String(objectKey || '').split('/')[0] || ''
}

export function r2KeyScope(objectKey) {
  return String(objectKey || '').split('/')[1] || ''
}
