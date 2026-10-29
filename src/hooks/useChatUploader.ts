import { useCallback, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { createR2FileReference, createInlineFileReference } from '../lib/chatFileUrl'

export const USER_STORAGE_MAX_BYTES = 10737418240
export const MAX_INLINE_BYTES = 2097152

type UploadInput = {
  file: File
  channelId?: string | null
  onProgress?: (percent: number) => void
}

type UploadResult = {
  reference: string
  fileSize: number
  url: string
}

// Inline attachments are stored as raw Base64 (no data: prefix) so the server can
// validate the payload, then handed back to the client as a data URL for instant
// rendering. FileReader.readAsDataURL returns the full data URL, so strip it.
function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma === -1) {
        reject(new Error('The file could not be read.'))
        return
      }
      resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('The file could not be read.'))
  })
}

async function authContext(): Promise<{ token: string; userId: string }> {
  if (!isSupabaseConfigured()) throw new Error('File storage is not configured.')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  const userId = session?.user?.id
  if (!token || !userId) throw new Error('Sign in to upload files.')
  return { token, userId }
}

function putWithProgress(url: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`The file could not be uploaded (HTTP ${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('The upload failed. Check the bucket CORS settings.'))
    xhr.send(file)
  })
}

async function postJson(path: string, token: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    const error: Error & { status?: number } = new Error(payload?.error || 'The request failed.')
    error.status = response.status
    throw error
  }
  return payload
}

export function useChatUploader() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const getStorageRemaining = useCallback(async (): Promise<number> => {
    const { userId } = await authContext()
    const { data, error: readError } = await supabase
      .from('user_storage')
      .select('used_bytes, max_bytes')
      .eq('user_id', userId)
      .maybeSingle()
    if (readError) throw readError
    const max = Number(data?.max_bytes) || USER_STORAGE_MAX_BYTES
    const used = Number(data?.used_bytes) || 0
    return Math.max(0, max - used)
  }, [])

  const uploadFile = useCallback(async ({ file, channelId, onProgress }: UploadInput): Promise<UploadResult> => {
    setError(null)
    setProgress(0)
    setUploading(true)
    try {
      const remaining = await getStorageRemaining()
      if (file.size > remaining) {
        const needMb = (file.size / 1048576).toFixed(1)
        const leftMb = (remaining / 1048576).toFixed(1)
        throw new Error(`Quota Exceeded: You need ${needMb} MB, but only have ${leftMb} MB left of your 10 GB allocation.`)
      }

      const { token } = await authContext()

      if (file.size <= MAX_INLINE_BYTES) {
        const base64Data = await convertFileToBase64(file)
        const inlined = await postJson('/api/storage/inline', token, {
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          base64Data,
          channelId: channelId ?? null,
        })
        setProgress(100)
        onProgress?.(100)
        return {
          reference: createInlineFileReference(inlined.attachmentId),
          fileSize: file.size,
          url: inlined.url,
        }
      }

      const presign = await postJson('/api/storage/presign', token, {
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
      })

      await putWithProgress(presign.uploadUrl, file, (percent) => {
        setProgress(percent)
        onProgress?.(percent)
      })

      const confirmed = await postJson('/api/storage/confirm', token, {
        fileKey: presign.fileKey,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        channelId: channelId ?? null,
      })
      return { reference: createR2FileReference(confirmed.fileKey), fileSize: file.size, url: confirmed.url }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'The file could not be uploaded.'
      setError(message)
      throw uploadError
    } finally {
      setUploading(false)
    }
  }, [getStorageRemaining])

  return { uploadFile, getStorageRemaining, uploading, progress, error }
}