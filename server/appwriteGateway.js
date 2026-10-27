import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { IdentityLinkError, linkAppwriteIdentity, verifyAppwriteSession } from './appwriteIdentity.js'
import { createDatabasePool, withAuthenticatedDatabaseTransaction } from './appwriteDatabase.js'
import { isFileScanConfigured, scanFileBuffer, unavailableScan } from './fileScan.js'
import { isEncryptedTextEnvelope, requiresE2EEEncryption } from '../src/lib/crypto/envelope.js'
import { storagePathFromChatFileUrl } from '../src/lib/chatFileUrl.js'
import { securityAlertEmail, sendSystemEmail } from './systemEmails.js'

let poolPromise
const POST_COMMIT = Symbol('postCommit')
const FIRST_VALID_UUID = '00000000-0000-1000-8000-000000000000'
// Every account gets the same fixed quota; storage is not a purchasable upgrade.
const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024

export class GatewayError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
  }
}

function getConfiguration() {
  const endpoint = String(process.env.APPWRITE_ENDPOINT || '').trim()
  const projectId = String(process.env.APPWRITE_PROJECT_ID || '').trim()
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const poolerUrl = String(process.env.SUPABASE_POOLER_URL || '').trim()
  if (!endpoint || !projectId || !supabaseUrl || !serviceRoleKey || !poolerUrl) return null

  let parsedEndpoint
  let parsedPooler
  try {
    parsedEndpoint = new URL(endpoint)
    parsedPooler = new URL(poolerUrl)
  } catch {
    return null
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsedEndpoint.hostname)
  const localHttpAllowed = process.env.NODE_ENV !== 'production' && isLocal && parsedEndpoint.protocol === 'http:'
  if (parsedEndpoint.protocol !== 'https:' && !localHttpAllowed) return null
  if (!['postgres:', 'postgresql:'].includes(parsedPooler.protocol)
    || !['require', 'verify-ca', 'verify-full'].includes(parsedPooler.searchParams.get('sslmode'))) return null

  return { endpoint: parsedEndpoint, projectId, supabaseUrl, serviceRoleKey, poolerUrl }
}

export async function executeUserDataOperation(client, identity, body, admin, account = {}) {
  const { supabaseUserId } = identity
  const action = String(body?.action || '')
  if (action.startsWith('admin.') || action.startsWith('verification.admin.')) {
    throw new GatewayError('Privileged actions require the Supabase MFA workflow.', 403)
  }
  switch (action) {
    case 'profile.get': {
      const { rows } = await client.query(
        `select id, member_id, first_name, last_name, full_name, email, email_verified,
                avatar_url, bio, interests, created_at,
                public.has_role(id, 'admin'::public.app_role) as is_admin
           from public.members
          where id = $1`,
        [supabaseUserId],
      )
      if (!rows[0]) throw new GatewayError('The linked profile is unavailable.', 404)
      const { is_admin: isAdmin, ...profile } = rows[0]
      return { profile: { ...profile, role: isAdmin ? 'admin' : 'user' } }
    }
    case 'profile.update': {
      const allowed = {
        firstName: ['first_name', 100],
        lastName: ['last_name', 100],
        fullName: ['full_name', 201],
        avatarUrl: ['avatar_url', 2048],
        bio: ['bio', 1500],
        interests: ['interests', null],
      }
      const updates = Object.entries(allowed).filter(([key]) => body.updates?.[key] !== undefined)
      if (!updates.length) throw new GatewayError('No profile fields were provided.')
      const values = []
      const assignments = updates.map(([key, [column, max]]) => {
        const value = body.updates[key]
        if (key === 'interests') {
          if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || item.length > 80)) {
            throw new GatewayError('Interests are invalid.')
          }
          values.push(value)
        } else {
          values.push(optionalString(value, column, max))
        }
        return `${column} = $${values.length}`
      })
      values.push(supabaseUserId)
      const { rows } = await client.query(
        `update public.members set ${assignments.join(', ')} where id = $${values.length}
         returning id, member_id, first_name, last_name, full_name, email, email_verified,
                   avatar_url, bio, interests, created_at`,
        values,
      )
      if (!rows[0]) throw new GatewayError('The profile could not be updated.', 404)
      const { rows: roles } = await client.query(
        `select public.has_role($1, 'admin'::public.app_role) as is_admin`,
        [supabaseUserId],
      )
      return { profile: { ...rows[0], role: roles[0]?.is_admin ? 'admin' : 'user' } }
    }
    case 'profile.setE2ee': {
      // Status mirror only: the private key stays on the device, so this records
      // the provisioning outcome for audit and never governs how messages send.
      await client.query(
        `select public.set_my_e2ee_status($1, $2)`,
        [body.enabled === true, body.keyPublished === true],
      )
      return { ok: true }
    }
    case 'directory.lookup': {
      const memberId = String(body.memberId || '').replace(/\D/g, '')
      if (!/^10\d{8}$/.test(memberId)) throw new GatewayError('Recipient ID is invalid.')
      const { rows } = await client.query(
        `select id, member_id, first_name, last_name, full_name, avatar_url
           from public.lookup_member_by_nexus_id($1)`,
        [memberId],
      )
      return { member: rows[0] || null }
    }
    case 'chats.list': {
      // Scoped to the caller's own conversations (owner or member). RLS already
      // filters this, but an explicit predicate keeps the aggregate honest. The
      // newest non-control message rides along so the contact list can preview
      // conversations that were never opened, without a second round trip.
      const { rows } = await client.query(
        `select c.id, c.title, c.type, c.avatar_url, c.encrypted, c.owner_id, c.created_at,
                c.participant_names,
                (select json_build_object(
                          'content', m.content, 'created_at', m.created_at, 'sender_id', m.sender_id,
                          'type', m.type, 'encrypted', m.encrypted)
                   from public.messages m
                  where m.chat_id = c.id and m.type not in ('reaction', 'receipt')
                  order by m.created_at desc
                  limit 1) as latest,
                coalesce(json_agg(json_build_object('profile_id', cm.profile_id))
                  filter (where cm.profile_id is not null), '[]'::json) as chat_members
           from public.chats c
           left join public.chat_members cm on cm.chat_id = c.id
          where c.owner_id = $1
             or exists (select 1 from public.chat_members me
                         where me.chat_id = c.id and me.profile_id = $1)
          group by c.id
          order by c.created_at desc
          limit 500`,
        [supabaseUserId],
      )
      return { chats: rows }
    }
    case 'chats.get': {
      const chatId = requiredString(body.chatId, 'Chat ID', 64)
      if (!validUuid(chatId)) throw new GatewayError('Chat ID is invalid.')
      const { rows: chats } = await client.query(
        `select c.id, c.title, c.type, c.avatar_url, c.encrypted, c.owner_id, c.created_at,
                c.participant_names,
                coalesce(json_agg(json_build_object('profile_id', cm.profile_id))
                  filter (where cm.profile_id is not null), '[]'::json) as chat_members
           from public.chats c
           left join public.chat_members cm on cm.chat_id = c.id
          where c.id = $1
            and (c.owner_id = $2
                 or exists (select 1 from public.chat_members me
                             where me.chat_id = c.id and me.profile_id = $2))
          group by c.id`,
        [chatId, supabaseUserId],
      )
      if (!chats[0]) return { chat: null }
      const messages = []
      for (let offset = 0; ; offset += 1000) {
        const { rows } = await client.query(
          `select id, chat_id, sender_id, content, type, file_url, file_name,
                  duration, encrypted, created_at
             from public.messages
            where chat_id = $1
            order by created_at asc, id asc
            limit 1000 offset $2`,
          [chatId, offset],
        )
        messages.push(...rows)
        if (rows.length < 1000) break
      }
      return { chat: { ...chats[0], messages } }
    }
    case 'chats.create': {
      const title = optionalString(body.title ?? 'New Chat', 'Chat title', 200)
      const type = optionalString(body.type ?? 'private', 'Chat type', 40)
      const avatarUrl = optionalString(body.avatarUrl, 'Chat avatar URL', 2048)
      const encrypted = body.encrypted === true
      const chatId = validUuid(body.chatId) ? body.chatId : undefined
      const suppliedParticipants = Array.isArray(body.participantIds) ? body.participantIds : []
      if (suppliedParticipants.length > 200 || suppliedParticipants.some((id) => !validUuid(id))) {
        throw new GatewayError('Chat participants are invalid.')
      }
      // Per-viewer display names, so each participant sees the *other* person
      // instead of the shared title (which is fixed to whoever created the chat).
      const rawNames = body.participantNames
      const participantNames = rawNames && typeof rawNames === 'object' && !Array.isArray(rawNames)
        ? Object.fromEntries(
            Object.entries(rawNames)
              .filter(([id, name]) => validUuid(id) && typeof name === 'string' && name.trim())
              .slice(0, 200)
              .map(([id, name]) => [id, name.trim().slice(0, 200)]),
          )
        : null
      const { rows } = await client.query(
        `insert into public.chats (id, title, type, avatar_url, encrypted, owner_id, participant_names)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb)
         returning id, title, type, avatar_url, encrypted, owner_id, participant_names, created_at`,
        [
          chatId || null,
          title,
          type,
          avatarUrl,
          encrypted,
          supabaseUserId,
          participantNames && Object.keys(participantNames).length ? JSON.stringify(participantNames) : null,
        ],
      )
      const participants = [...new Set([supabaseUserId, ...suppliedParticipants])]
      for (const participantId of participants) {
        await client.query(
          `insert into public.chat_members (chat_id, profile_id) values ($1, $2)`,
          [rows[0].id, participantId],
        )
      }
      return { chat: { ...rows[0], participant_ids: participants } }
    }
    case 'messages.send': {
      const chatId = requiredString(body.chatId, 'Chat ID', 64)
      if (!validUuid(chatId)) throw new GatewayError('Chat ID is invalid.')
      const content = requiredString(body.content, 'Message content', 65535)
      if (!content.trim()) throw new GatewayError('Message content is required.')
      const type = optionalString(body.type || 'text', 'Message type', 40)
      if (requiresE2EEEncryption(type) && (body.encrypted !== true || !isEncryptedTextEnvelope(content))) {
        throw new GatewayError('Text and sticker messages must be end-to-end encrypted.')
      }
      const messageId = validUuid(body.id) ? body.id : undefined
      const duration = body.duration == null ? null : Number(body.duration)
      if (duration !== null && (!Number.isFinite(duration) || duration < 0)) throw new GatewayError('Message duration is invalid.')
      const { rows } = await client.query(
        `insert into public.messages
           (id, chat_id, sender_id, content, type, file_url, file_name, duration, encrypted, created_at)
         values
           (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))
         returning id, chat_id, sender_id, content, type, file_url, file_name, duration, encrypted, created_at`,
        [
          messageId || null,
          chatId,
          supabaseUserId,
          content,
          type,
          optionalString(body.fileUrl, 'File URL', 4096),
          optionalString(body.fileName, 'File name', 255),
          duration,
          body.encrypted === true,
          body.createdAt || null,
        ],
      )
      return { message: rows[0] }
    }
    case 'events.poll': {
      const since = body.since == null ? new Date().toISOString() : String(body.since)
      if (!Number.isFinite(Date.parse(since))) throw new GatewayError('The event cursor is invalid.')
      const afterId = body.afterId == null ? FIRST_VALID_UUID : String(body.afterId)
      if (!validUuid(afterId)) throw new GatewayError('The event cursor is invalid.')
      const { rows } = await client.query(
        `select m.id, m.chat_id, m.sender_id, m.content, m.type, m.file_url, m.file_name,
                m.duration, m.encrypted, m.created_at
           from public.messages m
          where (m.created_at, m.id) > ($1::timestamptz, $2::uuid)
          order by m.created_at asc, m.id asc
          limit 500`,
        [since, afterId],
      )
      const lastMessage = rows.at(-1)
      return {
        messages: rows,
        cursor: lastMessage
          ? { since: lastMessage.created_at, afterId: lastMessage.id }
          : { since, afterId },
      }
    }
    case 'contacts.list': {
      // Scoped to the caller: without this filter every account rendered the
      // same rows, which is how unrelated people appeared with an identical name.
      const { rows } = await client.query(
        `select id, name, nexus_id, avatar_url, created_at
           from public.contacts
          where user_id = $1
          order by created_at desc
          limit 500`,
        [supabaseUserId],
      )
      return { contacts: rows }
    }
    case 'contacts.save': {
      const name = requiredString(body.name, 'Contact name', 200)
      const nexusId = String(body.nexusId || '').replace(/\D/g, '')
      if (!/^10\d{8}$/.test(nexusId)) throw new GatewayError('Contact Nexus ID is invalid.')
      const avatarUrl = optionalString(body.avatarUrl, 'Contact avatar URL', 2048)
      const { rows } = await client.query(
        `insert into public.contacts (user_id, name, nexus_id, avatar_url)
         values ($1, $2, $3, $4)
         on conflict (user_id, nexus_id) do update
           set name = excluded.name, avatar_url = excluded.avatar_url
         returning id, name, nexus_id, avatar_url, created_at`,
        [supabaseUserId, name, nexusId, avatarUrl],
      )
      return { contact: rows[0] }
    }
    case 'storage.usage': {
      const { rows: files } = await client.query(
        `select id, chat_id, file_name, file_type, mime_type, size_bytes, duration_seconds,
                storage_path, created_at
           from public.storage_files
          order by created_at desc
          limit 1000`,
      )
      const { rows: usage } = await client.query(
        `select coalesce(sum(size_bytes), 0)::bigint as used_bytes
           from public.storage_files`,
      )
      return {
        files,
        quotaBytes: STORAGE_QUOTA_BYTES,
        usedBytes: Number(usage[0]?.used_bytes || 0),
      }
    }
    case 'storage.upload.prepare': {
      const fileName = requiredString(body.fileName, 'File name', 255)
      const mimeType = requiredString(body.mimeType, 'File type', 255).toLowerCase()
      const sizeBytes = Number(body.sizeBytes)
      const durationSeconds = body.durationSeconds == null ? null : Number(body.durationSeconds)
      const fileType = requiredString(body.fileType, 'File category', 40)
      if (!['image', 'video', 'audio', 'voice', 'sticker', 'file'].includes(fileType)) {
        throw new GatewayError('The file category is invalid.')
      }
      const allowedMime = /^(image\/|video\/|audio\/)/.test(mimeType)
        || ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'text/plain',
          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType)
      if (!allowedMime || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 50 * 1024 * 1024) {
        throw new GatewayError('The selected file type or size is not supported.')
      }
      if (durationSeconds != null && (!Number.isFinite(durationSeconds) || durationSeconds < 0
        || (fileType === 'video' && durationSeconds > 45))) {
        throw new GatewayError('The media duration is invalid.')
      }
      const chatId = body.chatId == null ? null : String(body.chatId)
      if (chatId != null) {
        if (!validUuid(chatId)) throw new GatewayError('Chat ID is invalid.')
        const { rows: chats } = await client.query('select id from public.chats where id = $1', [chatId])
        if (!chats[0]) throw new GatewayError('You are not a member of this conversation.', 403)
      }
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [supabaseUserId])
      const { rows: usage } = await client.query(
        `select coalesce(sum(size_bytes), 0)::bigint as used_bytes
           from public.storage_files`,
      )
      if (Number(usage[0]?.used_bytes || 0) + sizeBytes > STORAGE_QUOTA_BYTES) {
        throw new GatewayError('There is not enough storage space for this file.', 413)
      }
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file'
      const path = `${supabaseUserId}/${chatId || 'direct'}/${randomUUID()}-${safeName}`
      const { rows } = await client.query(
        `insert into public.storage_files
          (user_id, chat_id, file_name, file_type, mime_type, size_bytes, duration_seconds, storage_path)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [supabaseUserId, chatId, fileName, fileType, mimeType, sizeBytes, durationSeconds, path],
      )
      const { data, error } = await admin.storage.from('chat-files').createSignedUploadUrl(path, { upsert: false })
      if (error || !data?.token) {
        await client.query('delete from public.storage_files where id = $1', [rows[0].id])
        throw new GatewayError('Could not prepare the secure upload.', 503)
      }
      return { fileId: rows[0].id, path, token: data.token }
    }
    case 'storage.upload.finish': {
      const fileId = requiredString(body.fileId, 'File ID', 64)
      if (!validUuid(fileId)) throw new GatewayError('File ID is invalid.')
      const { rows } = await client.query(
        `select id, storage_path, size_bytes, mime_type, file_name from public.storage_files where id = $1`,
        [fileId],
      )
      if (!rows[0]) throw new GatewayError('The uploaded file is unavailable.', 404)
      const { data: objectInfo, error: infoError } = await admin.storage.from('chat-files').info(rows[0].storage_path)
      const actualSize = Number(objectInfo?.size ?? objectInfo?.metadata?.size)
      const actualMime = String(objectInfo?.content_type || objectInfo?.metadata?.mimetype || '').toLowerCase()
      if (infoError || !Number.isSafeInteger(actualSize) || actualSize !== Number(rows[0].size_bytes)
        || actualMime !== String(rows[0].mime_type || '').toLowerCase()) {
        throw new GatewayError('The uploaded file did not match its reserved type and size.', 400)
      }
      // Pluggable scan hook: only runs when a provider is configured. A flagged
      // file is removed and never gets a link; otherwise the status is reported
      // so clients can show an honest "not scanned" state.
      let scan = unavailableScan()
      if (isFileScanConfigured()) {
        const { data: objectBlob, error: downloadError } = await admin.storage.from('chat-files').download(rows[0].storage_path)
        if (downloadError || !objectBlob) {
          scan = { status: 'error', detail: 'The uploaded file could not be read for scanning.' }
        } else {
          scan = await scanFileBuffer(await objectBlob.arrayBuffer(), {
            fileName: rows[0].file_name || 'file',
            mimeType: rows[0].mime_type || 'application/octet-stream',
          })
        }
        if (scan.status === 'infected') {
          await admin.storage.from('chat-files').remove([rows[0].storage_path])
          await client.query('delete from public.storage_files where id = $1', [fileId])
          throw new GatewayError('This file was rejected because the virus scan flagged it as unsafe.', 422)
        }
      }
      return { scanStatus: scan.status }
    }
    case 'storage.file.url': {
      const chatId = requiredString(body.chatId, 'Chat ID', 64)
      if (!validUuid(chatId)) throw new GatewayError('Chat ID is invalid.')
      const storagePath = requiredString(body.storagePath, 'Storage path', 1024)
      const fileUrl = requiredString(body.fileUrl, 'Attachment reference', 4096)
      if (storagePathFromChatFileUrl(fileUrl) !== storagePath) {
        throw new GatewayError('The attachment reference is invalid.')
      }
      const { rows } = await client.query(
        `select sf.storage_path
           from public.storage_files sf
           join public.chat_members cm on cm.chat_id = sf.chat_id
          where sf.chat_id = $1
            and sf.storage_path = $2
            and cm.profile_id = $3
            and exists (
              select 1 from public.messages m
               where m.chat_id = sf.chat_id and m.file_url = $4
            )
          limit 1`,
        [chatId, storagePath, supabaseUserId, fileUrl],
      )
      if (!rows[0]) throw new GatewayError('You no longer have access to this attachment.', 404)
      const { data, error } = await admin.storage.from('chat-files').createSignedUrl(storagePath, 60 * 60)
      if (error || !data?.signedUrl) throw new GatewayError('Could not create a secure file link.', 503)
      return { fileUrl: data.signedUrl }
    }
    case 'storage.upload.cancel': {
      const fileId = requiredString(body.fileId, 'File ID', 64)
      if (!validUuid(fileId)) throw new GatewayError('File ID is invalid.')
      const { rows } = await client.query(
        `select id, storage_path from public.storage_files where id = $1`,
        [fileId],
      )
      if (!rows[0]) return { deleted: false }
      const { error } = await admin.storage.from('chat-files').remove([rows[0].storage_path])
      if (error) throw new GatewayError('The incomplete upload could not be removed.', 503)
      await client.query('delete from public.storage_files where id = $1', [fileId])
      return { deleted: true }
    }
    case 'storage.delete': {
      const ids = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.map(String))] : []
      if (ids.length > 100 || ids.some((id) => !validUuid(id))) throw new GatewayError('File IDs are invalid.')
      if (!ids.length) return { deleted: 0 }
      const { rows } = await client.query(
        `select id, storage_path from public.storage_files where id = any($1::uuid[])`,
        [ids],
      )
      const paths = rows.map((row) => row.storage_path).filter(Boolean)
      if (paths.length) {
        const { error } = await admin.storage.from('chat-files').remove(paths)
        if (error) throw new GatewayError('The files could not be removed from storage.', 503)
      }
      const { rowCount } = await client.query(
        `delete from public.storage_files where id = any($1::uuid[])`,
        [rows.map((row) => row.id)],
      )
      return { deleted: rowCount }
    }
    case 'admin.verify': {
      const { rows } = await client.query(
        `select public.has_role($1, 'admin'::public.app_role) as is_admin`,
        [supabaseUserId],
      )
      if (!rows[0]?.is_admin) throw new GatewayError('Administrator access is required.', 403)
      return { isAdmin: true }
    }
    case 'security.alert.send': {
      if (account.emailVerification !== true || !account.email) {
        throw new GatewayError('A verified account email is required.', 403)
      }
      const { rows: roles } = await client.query(
        `select public.has_role($1, 'admin'::public.app_role) as is_admin`,
        [supabaseUserId],
      )
      if (roles[0]?.is_admin) {
        throw new GatewayError('Admin sign-in alerts require the Supabase MFA workflow.', 403)
      }
      const bucketKey = createHash('sha256').update(`security-alert:${supabaseUserId}`).digest('hex')
      const { data: allowed, error: limitError } = await admin.rpc('consume_auth_email_code_limit', {
        p_bucket_key: bucketKey,
        p_window_seconds: 3600,
        p_limit: 3,
      })
      if (limitError) throw new GatewayError('Sign-in alert rate limiting is unavailable.', 503)
      if (allowed !== true) throw new GatewayError('Sign-in alert email rate limit exceeded.', 429)
      return {
        [POST_COMMIT]: async () => {
          try {
            await sendSystemEmail({
              to: account.email,
              ...securityAlertEmail(),
              idempotencyKey: `security-alert/${supabaseUserId}/${account.authSessionFingerprint || randomUUID()}`,
            })
            return true
          } catch (error) {
            console.error('Appwrite sign-in alert email failed', error)
            return false
          }
        },
        response: { ok: true },
      }
    }
    case 'admin.dashboard': {
      await requireAdmin(client, supabaseUserId)
      const [{ rows: members }, { rows: messages }] = await Promise.all([
        client.query(
          `select id, member_id, full_name, created_at from public.members
            order by created_at desc limit 20`,
        ),
        client.query(
          `select id, chat_id, type, content, created_at from public.messages
            order by created_at desc limit 20`,
        ),
      ])
      return { members, messages }
    }
    case 'admin.members.list': {
      await requireAdmin(client, supabaseUserId)
      const term = String(body.query || '').trim().slice(0, 100)
      const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
      const [{ rows: members }, { rows: admins }, { rows: premium }] = await Promise.all([
        client.query(
          `select id, member_id, first_name, last_name, full_name, email, email_verified, bio, created_at
             from public.members
            where $1 = '' or full_name ilike $2 escape '\\'
              or email ilike $2 escape '\\' or member_id ilike $2 escape '\\'
            order by created_at desc limit 100`,
          [term, pattern],
        ),
        client.query(`select user_id from public.admin_list_admins()`),
        client.query(`select user_id from public.premium_members`),
      ])
      return { members, admins, premium }
    }
    case 'admin.member.update': {
      const memberId = requiredString(body.memberId, 'Member ID', 64)
      if (!validUuid(memberId)) throw new GatewayError('Member ID is invalid.')
      const firstName = optionalString(body.firstName, 'First name', 80)
      const lastName = optionalString(body.lastName, 'Last name', 80)
      const bio = optionalString(body.bio, 'Bio', 500)
      await client.query(
        `select public.admin_update_member($1, $2, $3, $4)`,
        [memberId, firstName, lastName, bio],
      )
      return { ok: true }
    }
    case 'admin.role.set': {
      const memberId = requiredString(body.memberId, 'Member ID', 64)
      if (!validUuid(memberId)) throw new GatewayError('Member ID is invalid.')
      await client.query(
        `select public.admin_set_admin_role($1, $2)`,
        [memberId, body.grant === true],
      )
      return { ok: true }
    }
    case 'admin.premium.set': {
      await requireAdmin(client, supabaseUserId)
      const memberId = requiredString(body.memberId, 'Member ID', 64)
      if (!validUuid(memberId)) throw new GatewayError('Member ID is invalid.')
      const note = optionalString(body.note, 'Note', 500)
      await client.query(
        `select public.admin_set_premium_member($1, $2, $3)`,
        [memberId, body.grant === true, note],
      )
      return { ok: true }
    }
    case 'verification.badge': {
      const memberId = requiredString(body.userId, 'Member ID', 64)
      if (!validUuid(memberId)) throw new GatewayError('Member ID is invalid.')
      const { rows } = await client.query(
        `select public.get_verification_badge($1) as badge`,
        [memberId],
      )
      return { badge: rows[0]?.badge || 'none' }
    }
    case 'verification.badges': {
      const memberIds = Array.isArray(body.memberIds)
        ? body.memberIds.slice(0, 500).map((id) => String(id).replace(/\D/g, '')).filter(Boolean)
        : []
      if (!memberIds.length) return { badges: [] }
      const { rows } = await client.query(
        `select member_id, badge from public.get_verification_badges($1::text[])`,
        [memberIds],
      )
      return { badges: rows }
    }
    case 'verification.get': {
      const { rows } = await client.query(
        `select status, tier, match_score, reviewer_note, created_at
           from public.identity_verifications where user_id = $1`,
        [supabaseUserId],
      )
      return { record: rows[0] || null }
    }
    case 'verification.instant': {
      const selfiePath = requiredString(body.selfiePath, 'Selfie path', 255)
      if (!selfiePath.startsWith(`${supabaseUserId}/`)) {
        throw new GatewayError('Identity document paths are invalid.')
      }
      const score = Number(body.matchScore)
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new GatewayError('Face match score is invalid.')
      const selfie = await admin.storage.from('identity-docs').info(selfiePath)
      const selfieSize = Number(selfie.data?.size ?? selfie.data?.metadata?.size)
      const selfieType = String(selfie.data?.content_type || selfie.data?.metadata?.mimetype || '').toLowerCase()
      if (selfie.error || !Number.isSafeInteger(selfieSize) || selfieSize < 1 || selfieSize > 15 * 1024 * 1024
        || !['image/jpeg', 'image/png', 'image/webp'].includes(selfieType)) {
        throw new GatewayError('The uploaded selfie is invalid or exceeds 15 MB.')
      }
      // Routed through the security-definer RPC so only the caller's own row can
      // be auto-approved, exactly like the Supabase path.
      await client.query(
        `select public.submit_instant_identity_verification($1, $2)`,
        [selfiePath, Number(score.toFixed(3))],
      )
      return { record: { status: 'approved', tier: 'instant', match_score: Number(score.toFixed(3)) } }
    }
    case 'verification.submit': {
      const selfiePath = requiredString(body.selfiePath, 'Selfie path', 255)
      const idPath = requiredString(body.idPath, 'Identity document path', 255)
      if (!selfiePath.startsWith(`${supabaseUserId}/`) || !idPath.startsWith(`${supabaseUserId}/`)) {
        throw new GatewayError('Identity document paths are invalid.')
      }
      const score = Number(body.matchScore)
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new GatewayError('Face match score is invalid.')
      const fullLegalName = requiredString(body.fullLegalName, 'Full legal name', 200)
      const dateOfBirth = requiredString(body.dateOfBirth, 'Date of birth', 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw new GatewayError('Date of birth is invalid.')
      const documentType = requiredString(body.documentType, 'Document type', 40)
      const documentNumber = requiredString(body.documentNumber, 'Document number', 120)
      const issuingCountry = requiredString(body.issuingCountry, 'Issuing country', 120)
      const [selfie, document] = await Promise.all([
        admin.storage.from('identity-docs').info(selfiePath),
        admin.storage.from('identity-docs').info(idPath),
      ])
      const selfieSize = Number(selfie.data?.size ?? selfie.data?.metadata?.size)
      const documentSize = Number(document.data?.size ?? document.data?.metadata?.size)
      const selfieType = String(selfie.data?.content_type || selfie.data?.metadata?.mimetype || '').toLowerCase()
      const documentType2 = String(document.data?.content_type || document.data?.metadata?.mimetype || '').toLowerCase()
      const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp']
      if (selfie.error || document.error || !Number.isSafeInteger(selfieSize) || selfieSize < 1
        || selfieSize > 15 * 1024 * 1024 || !Number.isSafeInteger(documentSize) || documentSize < 1
        || documentSize > 15 * 1024 * 1024 || !acceptedTypes.includes(selfieType)
        || !acceptedTypes.includes(documentType2)) {
        throw new GatewayError('The uploaded identity images are invalid or exceed 15 MB.')
      }
      const { rows } = await client.query(
        `insert into public.identity_verifications
          (user_id, status, tier, match_score, selfie_path, id_document_path,
           full_legal_name, date_of_birth, document_type, document_number, issuing_country,
           reviewer_note, reviewed_by, reviewed_at)
         values ($1, 'pending', 'manual', $2, $3, $4, $5, $6, $7, $8, $9, null, null, null)
         on conflict (user_id) do update set status = 'pending', tier = 'manual', match_score = excluded.match_score,
           selfie_path = excluded.selfie_path, id_document_path = excluded.id_document_path,
           full_legal_name = excluded.full_legal_name, date_of_birth = excluded.date_of_birth,
           document_type = excluded.document_type, document_number = excluded.document_number,
           issuing_country = excluded.issuing_country,
           reviewer_note = null, reviewed_by = null, reviewed_at = null
         returning status, tier, match_score, reviewer_note, created_at`,
        [supabaseUserId, Number(score.toFixed(3)), selfiePath, idPath, fullLegalName, dateOfBirth, documentType, documentNumber, issuingCountry],
      )
      return { record: rows[0] }
    }
    case 'verification.admin.queue': {
      await requireAdmin(client, supabaseUserId)
      const { rows } = await client.query(
        `select id, user_id, status, tier, match_score, selfie_path, id_document_path,
                full_legal_name, date_of_birth, document_type, document_number, issuing_country,
                reviewer_note, created_at
           from public.identity_verifications
          where status = 'pending'
          order by created_at asc limit 50`,
      )
      const signedRows = await Promise.all(rows.map(async (row) => {
        const [selfie, document] = await Promise.all([
          row.selfie_path ? admin.storage.from('identity-docs').createSignedUrl(row.selfie_path, 600) : Promise.resolve({ data: null }),
          row.id_document_path ? admin.storage.from('identity-docs').createSignedUrl(row.id_document_path, 600) : Promise.resolve({ data: null }),
        ])
        if (selfie.error || document.error) throw new GatewayError('Could not create a secure review link.', 503)
        return { ...row, selfieUrl: selfie.data?.signedUrl || null, idUrl: document.data?.signedUrl || null }
      }))
      return { verifications: signedRows }
    }
    case 'verification.upload.prepare': {
      const fileName = requiredString(body.fileName, 'File name', 255)
      const mimeType = requiredString(body.mimeType, 'Image type', 100).toLowerCase()
      const sizeBytes = Number(body.sizeBytes)
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
        || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 15 * 1024 * 1024) {
        throw new GatewayError('Identity images must be JPEG, PNG, or WebP and under 15 MB.')
      }
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
      const path = `${supabaseUserId}/${randomUUID()}-${safeName}`
      const { data, error } = await admin.storage.from('identity-docs').createSignedUploadUrl(path, { upsert: false })
      if (error || !data?.token) throw new GatewayError('Could not prepare a secure identity image upload.', 503)
      return { path, token: data.token }
    }
    case 'admin.diagnostics': {
      await requireAdmin(client, supabaseUserId)
      const checks = [
        ['APPWRITE_ENDPOINT', process.env.APPWRITE_ENDPOINT],
        ['APPWRITE_PROJECT_ID', process.env.APPWRITE_PROJECT_ID],
        ['SUPABASE_URL', process.env.SUPABASE_URL],
        ['SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY],
        ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
        ['SUPABASE_POOLER_URL', process.env.SUPABASE_POOLER_URL],
        ['RESEND_API_KEY', process.env.RESEND_API_KEY],
        ['RESEND_FROM', process.env.RESEND_FROM],
      ].map(([key, value]) => ({ key, configured: Boolean(String(value || '').trim()) }))
      const tableNames = [
        'members',
        'chats',
        'messages',
        'identity_verifications',
        'appwrite_identity_links',
      ]
      const { rows: tables } = await client.query(
        `select name as table, to_regclass('public.' || name) is not null as ok
           from unnest($1::text[]) as names(name)`,
        [tableNames],
      )
      return { checks, tables }
    }
    default:
      throw new GatewayError('Unsupported data operation.', 404)
  }
}

async function requireAdmin(client, userId) {
  const { rows } = await client.query(
    `select public.has_role($1, 'admin'::public.app_role) as is_admin`,
    [userId],
  )
  if (!rows[0]?.is_admin) throw new GatewayError('Administrator access is required.', 403)
}

export function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function requiredString(value, label, maxLength) {
  const text = String(value ?? '')
  if (!text || text.length > maxLength) throw new GatewayError(`${label} is invalid.`)
  return text
}

function optionalString(value, label, maxLength) {
  if (value == null) return null
  const text = String(value)
  if (text.length > maxLength) throw new GatewayError(`${label} is too long.`)
  return text
}

function getAdminClient(config) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getPool(config) {
  poolPromise ||= createDatabasePool(config.poolerUrl).catch((error) => {
    poolPromise = null
    throw error
  })
  return poolPromise
}

async function inUserTransaction(config, account, operation) {
  const admin = getAdminClient(config)
  const identity = await linkAppwriteIdentity(admin, account)
  const pool = await getPool(config)
  const result = await withAuthenticatedDatabaseTransaction(
    pool,
    identity.supabaseUserId,
    (client) => operation(client, identity, admin, account),
  )
  if (typeof result?.[POST_COMMIT] !== 'function') return result
  const emailNotificationSent = await result[POST_COMMIT]()
  return { ...result.response, emailNotificationSent }
}

export async function dispatchUserData(config, account, body) {
  return inUserTransaction(config, account, async (client, identity, admin) => {
    return executeUserDataOperation(client, identity, body, admin, account)
  })
}

export async function authenticateGatewayRequest(req) {
  const config = getConfiguration()
  if (!config) throw new GatewayError('The Appwrite data gateway is not configured on the server.', 503)
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token || token.length > 8192) throw new GatewayError('A valid Appwrite session is required.', 401)
  const verifiedAccount = await verifyAppwriteSession({
    endpoint: config.endpoint,
    projectId: config.projectId,
    token,
  })
  const account = {
    ...verifiedAccount,
    authSessionFingerprint: createHash('sha256').update(token).digest('hex'),
  }
  return { config, account }
}

export { IdentityLinkError }
