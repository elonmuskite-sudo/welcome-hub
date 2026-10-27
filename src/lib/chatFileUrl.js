export const CHAT_FILE_REFERENCE_PREFIX = 'storage://'

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
