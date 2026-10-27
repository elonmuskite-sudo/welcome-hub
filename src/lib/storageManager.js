import { supabase, isSupabaseConfigured } from './supabase'
import { appwriteData, isAppwriteAuthEnabled } from './appwrite'
import { UNSUPPORTED_FILE_MESSAGE, classifyFileType, formatBytes, isSupportedFile } from './chatAttachments'
import { createChatFileReference, storagePathFromChatFileUrl } from './chatFileUrl'

export { ATTACHMENT_ACCEPT, UNSUPPORTED_FILE_MESSAGE, classifyFileType, formatBytes, isSupportedFile } from './chatAttachments'
export { createChatFileReference, storagePathFromChatFileUrl } from './chatFileUrl'

export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB per user
export const MAX_VIDEO_DURATION_SECONDS = 45
export const STORAGE_USAGE_CHANGED_EVENT = 'nexus:storage-usage-changed'
const BUCKET = 'chat-files'
const SIGNED_URL_TTL_SECONDS = 60 * 60

function announceStorageUsageChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STORAGE_USAGE_CHANGED_EVENT))
  }
}

export function probeMediaDuration(file) {
  return new Promise((resolve) => {
    const mime = String(file?.type || '')
    if (!mime.startsWith('video/') && !mime.startsWith('audio/')) return resolve(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement(mime.startsWith('video/') ? 'video' : 'audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : null
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    el.src = url
  })
}

export async function getStorageUsage(userId) {
  if (isAppwriteAuthEnabled()) {
    if (!userId) throw new Error('Sign in to view storage usage.')
    const {
      files = [],
      quotaBytes = STORAGE_QUOTA_BYTES,
      usedBytes = 0,
      byType = {},
    } = await appwriteData('storage.usage')
    return { usedBytes, quotaBytes, byType, files }
  }
  if (!isSupabaseConfigured() || !userId) {
    return { usedBytes: 0, quotaBytes: STORAGE_QUOTA_BYTES, byType: {}, files: [] }
  }
  const { data: fileList, error: fileListError } = await supabase
    .from('storage_files')
    .select('id, chat_id, file_name, file_type, mime_type, size_bytes, duration_seconds, storage_path, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1000)
  if (fileListError) throw fileListError
  const files = fileList || []
  const byType = {}
  let usedBytes = 0
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('storage_files')
      .select('file_type, size_bytes')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error

    const page = data || []
    for (const file of page) {
      const size = Number(file.size_bytes) || 0
      usedBytes += size
      byType[file.file_type] = (byType[file.file_type] || 0) + size
    }
    if (page.length < pageSize) break
  }
  // Every account has the same fixed quota; storage is not a purchasable upgrade.
  return { usedBytes, quotaBytes: STORAGE_QUOTA_BYTES, byType, files }
}

export async function validateUpload(file, { userId, durationSeconds = null, kind = 'file' } = {}) {
  if (!file) throw new Error('No file selected.')
  if (!isSupportedFile(file)) throw new Error(UNSUPPORTED_FILE_MESSAGE)
  const mime = String(file.type || '').toLowerCase()

  const fileType = classifyFileType(mime, kind)
  let duration = durationSeconds
  if ((fileType === 'video' || fileType === 'audio' || fileType === 'voice') && duration == null) {
    duration = await probeMediaDuration(file)
  }
  if (fileType === 'video' && duration != null && duration > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(`Videos can be at most ${MAX_VIDEO_DURATION_SECONDS} seconds long. This video is ${Math.round(duration)} seconds.`)
  }

  const usage = await getStorageUsage(userId)
  const remaining = usage.quotaBytes - usage.usedBytes
  if (file.size > remaining) {
    throw new Error(`Not enough storage space. This file is ${formatBytes(file.size)} but only ${formatBytes(Math.max(remaining, 0))} of your ${formatBytes(usage.quotaBytes)} is free. Delete files in Settings → Storage to free up space.`)
  }

  return { fileType, durationSeconds: duration }
}

function safeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

const SCAN_ENDPOINT = '/api/data/scan-file'

// Pluggable virus scan. The server hook only runs a provider when one is
// configured, and reports a clear "unavailable" status otherwise, so uploads
// are never silently presented as scanned.
async function scanUploadedFile({ fileUrl, fileName, mimeType }) {
  if (!isSupabaseConfigured()) return { status: 'unavailable', detail: 'Virus scanning is not available.' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { status: 'unavailable', detail: 'Sign in again to enable virus scanning.' }
    const response = await fetch(SCAN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileUrl, fileName, mimeType }),
    })
    if (!response.ok) return { status: 'unavailable', detail: `The scan service responded ${response.status}.` }
    const payload = await response.json().catch(() => null)
    const status = payload?.status
    return ['clean', 'infected', 'unavailable', 'error'].includes(status)
      ? { status, detail: payload?.detail || null }
      : { status: 'unavailable', detail: 'The scan service returned an unexpected response.' }
  } catch (error) {
    return { status: 'unavailable', detail: error?.message || 'The scan service could not be reached.' }
  }
}

// XHR exposes upload progress events that the supabase-js fetch client does not.
function uploadWithProgress(url, file, { onProgress, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else reject(new Error(`The upload failed (HTTP ${request.status}).`))
    }
    request.onerror = () => reject(new Error('The upload failed because the network connection was interrupted.'))
    request.onabort = () => reject(new Error('The upload was cancelled.'))
    request.ontimeout = () => reject(new Error('The upload timed out. Check your connection and try again.'))
    request.send(file)
  })
}

export async function uploadChatFile({ userId, chatId, file, kind = 'file', durationSeconds = null, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('File storage is not configured.')
  if (!userId) throw new Error('Sign in to send files.')

  const report = typeof onProgress === 'function' ? onProgress : () => {}
  const { fileType, durationSeconds: duration } = await validateUpload(file, { userId, durationSeconds, kind })

  if (isAppwriteAuthEnabled()) {
    if (!supabase) throw new Error('Secure direct uploads require the Supabase project URL and publishable key.')
    const { fileId, path, token } = await appwriteData('storage.upload.prepare', {
      chatId: chatId ? String(chatId) : null,
      fileName: file.name || 'file',
      fileType,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      durationSeconds: duration,
    })
    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type || 'application/octet-stream' })
      if (uploadError) throw new Error(uploadError.message || 'The file could not be uploaded.')
      report(100)
      // The gateway verifies the object and runs the server-side scan hook,
      // so it fails the call when a configured scanner flags the file.
      const { scanStatus = 'unavailable' } = await appwriteData('storage.upload.finish', { fileId })
      announceStorageUsageChanged()
      return {
        fileUrl: createChatFileReference(path),
        fileName: file.name || 'file',
        fileType,
        durationSeconds: duration,
        storagePath: path,
        scanStatus,
      }
    } catch (error) {
      try {
        await appwriteData('storage.upload.cancel', { fileId })
      } catch (cleanupError) {
        console.error('Failed to clean up an incomplete Appwrite-backed file upload', cleanupError)
      }
      throw error
    }
  }
  const path = `${userId}/${chatId || 'direct'}/${Date.now()}-${safeFileName(file.name)}`
  const contentType = file.type || 'application/octet-stream'

  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path)
  if (!signedUploadError && signedUpload?.signedUrl) {
    // Signed-URL uploads allow real progress reporting; fall back to the plain
    // client upload when the bucket does not issue signed upload URLs.
    try {
      await uploadWithProgress(signedUpload.signedUrl, file, { onProgress: report, headers: { 'x-upsert': 'false' } })
    } catch (error) {
      throw error instanceof Error ? error : new Error('The file could not be uploaded.')
    }
  } else {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType, upsert: false })
    if (uploadError) throw new Error(uploadError.message || 'The file could not be uploaded.')
    report(100)
  }

  const { error: insertError } = await supabase.from('storage_files').insert({
    user_id: userId,
    chat_id: chatId ? String(chatId) : null,
    file_name: file.name || 'file',
    file_type: fileType,
    mime_type: file.type || null,
    size_bytes: file.size,
    duration_seconds: duration,
    storage_path: path,
  })
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(insertError.message || 'The file could not be registered.')
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signError) throw new Error(signError.message || 'The file link could not be created.')

  const scan = await scanUploadedFile({ fileUrl: signed.signedUrl, fileName: file.name || 'file', mimeType: file.type || '' })
  if (scan.status === 'infected') {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    await supabase.from('storage_files').delete().eq('storage_path', path).eq('user_id', userId).catch(() => {})
    throw new Error('This file was rejected because the virus scan flagged it as unsafe.')
  }

  announceStorageUsageChanged()
  return {
    fileUrl: createChatFileReference(path),
    fileName: file.name || 'file',
    fileType,
    durationSeconds: duration,
    storagePath: path,
    scanStatus: scan.status,
  }
}

export async function resolveChatFileUrl(fileUrl, chatId) {
  const path = storagePathFromChatFileUrl(fileUrl)
  if (!path) return fileUrl

  if (isAppwriteAuthEnabled()) {
    if (!chatId) throw new Error('The conversation for this attachment is unavailable.')
    const { fileUrl: signedUrl } = await appwriteData('storage.file.url', {
      chatId: String(chatId),
      storagePath: path,
      fileUrl,
    })
    if (!signedUrl) throw new Error('A secure attachment link could not be created.')
    return signedUrl
  }

  if (!supabase) throw new Error('File storage is not configured.')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message || 'Could not verify access to this attachment.')
  if (!user) throw new Error('Sign in to open this attachment.')

  const { data: ownedFile, error: ownedFileError } = await supabase
    .from('storage_files')
    .select('id')
    .eq('user_id', user.id)
    .eq('storage_path', path)
    .limit(1)
    .maybeSingle()
  if (ownedFileError) throw new Error(ownedFileError.message || 'Could not verify access to this attachment.')

  let hasAccess = Boolean(ownedFile)
  if (!hasAccess) {
    if (!chatId) throw new Error('The conversation for this attachment is unavailable.')
    const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id')
    .eq('chat_id', String(chatId))
    .eq('file_url', fileUrl)
    .limit(1)
    .maybeSingle()
    if (messageError) throw new Error(messageError.message || 'Could not verify access to this attachment.')
    hasAccess = Boolean(message)
  }
  if (!hasAccess) throw new Error('You no longer have access to this attachment.')

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'A secure attachment link could not be created.')
  return data.signedUrl
}

export async function openChatFile(fileUrl, chatId) {
  if (typeof window === 'undefined') throw new Error('Attachments can only be opened in a browser.')
  const viewer = window.open('about:blank', '_blank')
  if (!viewer) throw new Error('Allow pop-ups to open this attachment.')
  viewer.opener = null

  try {
    const url = await resolveChatFileUrl(fileUrl, chatId)
    viewer.location.replace(url)
  } catch (error) {
    viewer.close()
    throw error
  }
}

export async function saveReceivedChatFile({
  userId,
  chatId,
  fileUrl,
  fileName,
  kind = 'file',
  durationSeconds = null,
  onProgress,
}) {
  if (!userId) throw new Error('Sign in to save this attachment.')
  const signedUrl = await resolveChatFileUrl(fileUrl, chatId)
  const response = await fetch(signedUrl)
  if (!response.ok) throw new Error(`The attachment download failed (HTTP ${response.status}).`)
  const blob = await response.blob()
  if (!blob.size) throw new Error('The downloaded attachment is empty.')
  const file = new File([blob], String(fileName || 'saved-file'), {
    type: blob.type || 'application/octet-stream',
  })
  return uploadChatFile({
    userId,
    chatId: null,
    file,
    kind,
    durationSeconds,
    onProgress,
  })
}

export async function deleteStorageFiles(userId, fileIds) {
  if (!isSupabaseConfigured() || !userId) throw new Error('File storage is not configured.')
  const ids = (fileIds || []).filter(Boolean)
  if (!ids.length) return { deleted: 0 }
  if (isAppwriteAuthEnabled()) {
    const result = await appwriteData('storage.delete', { fileIds: ids })
    if (result?.deleted) announceStorageUsageChanged()
    return result
  }

  const { data: rows, error: readError } = await supabase
    .from('storage_files')
    .select('id, storage_path')
    .eq('user_id', userId)
    .in('id', ids)
  if (readError) throw readError

  const paths = (rows || []).map((row) => row.storage_path).filter(Boolean)
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths)
    if (removeError) throw new Error(removeError.message || 'Files could not be deleted from storage.')
  }

  const { error: deleteError } = await supabase
    .from('storage_files')
    .delete()
    .eq('user_id', userId)
    .in('id', ids)
  if (deleteError) throw deleteError

  if (rows?.length) announceStorageUsageChanged()
  return { deleted: rows?.length || 0 }
}
