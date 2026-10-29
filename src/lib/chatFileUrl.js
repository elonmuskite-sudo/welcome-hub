export const CHAT_FILE_REFERENCE_PREFIX = 'storage://'
export const R2_FILE_REFERENCE_PREFIX = 'r2://'
export const INLINE_FILE_REFERENCE_PREFIX = 'inline://'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidStoragePath(path) {
  return Boolean(path)
    && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}

export function createChatFileReference(storagePath) {
  const path = String(storagePath || '')
  if (!isValidStoragePath(path)) throw new Error('The stored file path is invalid.')
  return `${CHAT_FILE_REFERENCE_PREFIX}${path}`
}

export function createR2FileReference(fileKey) {
  const key = String(fileKey || '')
  if (!isValidStoragePath(key)) throw new Error('The stored object key is invalid.')
  return `${R2_FILE_REFERENCE_PREFIX}${key}`
}

export function r2PathFromFileUrl(fileUrl) {
  const value = String(fileUrl || '')
  if (!value.startsWith(R2_FILE_REFERENCE_PREFIX)) return null
  const key = value.slice(R2_FILE_REFERENCE_PREFIX.length)
  return isValidStoragePath(key) ? key : null
}

// Inline attachments are addressed by their server-owned row id, never by the
// base64 payload, so the reference stays short and database-friendly.
export function createInlineFileReference(attachmentId) {
  const id = String(attachmentId || '')
  if (!UUID_RE.test(id)) throw new Error('The stored attachment id is invalid.')
  return `${INLINE_FILE_REFERENCE_PREFIX}${id}`
}

export function inlineIdFromFileUrl(fileUrl) {
  const value = String(fileUrl || '')
  if (!value.startsWith(INLINE_FILE_REFERENCE_PREFIX)) return null
  const id = value.slice(INLINE_FILE_REFERENCE_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

export function storagePathFromChatFileUrl(fileUrl) {
  const value = String(fileUrl || '')
  if (value.startsWith(CHAT_FILE_REFERENCE_PREFIX)) {
    const path = value.slice(CHAT_FILE_REFERENCE_PREFIX.length)
    return isValidStoragePath(path) ? path : null
  }

  let pathname
  try {
    pathname = new URL(value).pathname
  } catch {
    return null
  }

  const match = /\/object\/(?:sign|public)\/chat-files\/(.+)$/.exec(pathname)
  if (!match) return null
  let path
  try {
    path = decodeURIComponent(match[1])
  } catch {
    return null
  }
  return isValidStoragePath(path) ? path : null
}
