// Chat attachment types and validation.
//
// Kept free of browser and Supabase imports so the rules can be unit tested.

// Accepted categories: images (JPG, PNG, GIF, WebP), videos (MP4, MOV, AVI),
// audio (MP3, WAV, AAC), PDF and Microsoft Office documents (DOC, DOCX, XLS, XLSX).
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/']
const ALLOWED_EXTRA_MIME = new Set([
  'application/pdf',
  'text/plain',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
])
// Mobile pickers often hand Office files (and a few audio containers) an empty
// or generic MIME type, so the extension is checked before rejecting them.
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'mp4', 'mov', 'avi',
  'mp3', 'wav', 'aac',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
])
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'])

// `accept` restricts the native chooser to the supported set. Extensions are
// listed alongside MIME types because Android's chooser honours them more
// reliably than MIME types for Office documents.
export const ATTACHMENT_ACCEPT = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/mp4',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.mov', '.avi',
  '.mp3', '.wav', '.aac',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
].join(',')

export const UNSUPPORTED_FILE_MESSAGE =
  'This file type is not supported. Send images (JPG, PNG, GIF, WebP), videos (MP4, MOV, AVI), audio (MP3, WAV, AAC), PDFs, or Word/Excel documents.'

export function fileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

export function isSupportedFile(file) {
  const mime = String(file?.type || '').toLowerCase()
  if (ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true
  if (ALLOWED_EXTRA_MIME.has(mime)) return true
  if (GENERIC_MIME.has(mime)) return ALLOWED_EXTENSIONS.has(fileExtension(file?.name))
  return false
}

export function classifyFileType(mimeType, fallback = 'file') {
  const mime = String(mimeType || '').toLowerCase()
  if (mime === 'image/gif') return 'sticker'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return fallback === 'voice' ? 'voice' : 'audio'
  return 'file'
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}
