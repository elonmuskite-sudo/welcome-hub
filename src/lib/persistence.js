import { findMemberByNexusId, supabase } from './supabase.js'
import { appwriteData, isAppwriteAuthEnabled } from './appwrite.js'
import { reactionContent, receiptContent } from './chatProtocol.js'
import { recordSyncTiming, withSync } from './syncStatus.js'

const STORAGE_KEY = 'nexus-chat-state-v1'
const CONTACTS_STORAGE_KEY = 'nexus-contacts-state-v1'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
export const isChatServiceAvailable = () => Boolean(supabase) || isAppwriteAuthEnabled()

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

function readJson(key) {
  if (typeof window === 'undefined') return []
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function writeJson(key, value) {
  if (typeof window === 'undefined') return value
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
  return value
}
const readLocalContacts = () => readJson(CONTACTS_STORAGE_KEY)
const writeLocalContacts = (c) => writeJson(CONTACTS_STORAGE_KEY, c)
const readLocalChats = () => readJson(STORAGE_KEY)
const writeLocalChats = (c) => writeJson(STORAGE_KEY, c)

function emit(name, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined))
}
const notifyContactsUpdate = () => emit('nexus-contacts:updated')
const notifyChatUpdate = () => emit('nexus-chat:updated')
const notifyChange = notifyChatUpdate

function mapMessage(row) {
  return {
    id: String(row.id), sender_id: row.sender_id ? String(row.sender_id) : 'other', content: row.content,
    type: row.type || 'text', file_url: row.file_url || null, file_name: row.file_name || null,
    duration: row.duration || null, encrypted: Boolean(row.encrypted), created_at: row.created_at,
  }
}

export function startRealtimeListeners() {
  if (isAppwriteAuthEnabled()) {
    let active = true
    let timer = null
    let running = false
    let failures = 0
    let lastContactsSyncAt = 0
    let cursor = { since: new Date().toISOString(), afterId: '00000000-0000-1000-8000-000000000000' }
    // Poll tightly while the tab is in the foreground so new messages land well
    // inside the half-second budget, and back off when it is hidden so an idle
    // tab stops burning round trips.
    const ACTIVE_MS = 700
    const HIDDEN_MS = 4000

    const schedule = (delay) => {
      if (!active) return
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void poll() }, delay)
    }

    const poll = async () => {
      if (!active || running) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(HIDDEN_MS)
        return
      }
      running = true
      const started = nowMs()
      try {
        // The chat list and the message cursor are independent, so one tick costs
        // a single pair of round trips instead of a serial chain.
        const [{ messages = [], cursor: nextCursor }, { chats = [] }] = await Promise.all([
          appwriteData('events.poll', { since: cursor.since, afterId: cursor.afterId }),
          appwriteData('chats.list'),
        ])
        cursor = nextCursor || cursor

        const remoteChats = chats.map(({ chat_members: members, ...chat }) => ({
          ...chat,
          id: String(chat.id),
          participant_ids: (members || []).map((member) => String(member.profile_id)),
        }))

        const { notifications } = applyChatSyncBatch(remoteChats, messages)
        for (const notification of notifications) emit('nexus:incoming-notification', notification)

        // Contacts are independent of messages: refresh them on a slower cadence
        // so a tight message poll does not multiply the contact round trips.
        if (Date.now() - lastContactsSyncAt > 8000) {
          lastContactsSyncAt = Date.now()
          void syncContactsFromCloud('appwrite')
        }

        failures = 0
        recordSyncTiming('realtime', nowMs() - started)
        schedule(ACTIVE_MS)
      } catch (error) {
        failures += 1
        console.error('Appwrite data sync failed', error)
        schedule(Math.min(ACTIVE_MS * 2 ** Math.min(failures, 4), 15000))
      } finally {
        running = false
      }
    }

    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }
  if (!supabase) return null
  let currentUserId = null
  supabase.auth.getSession().then(({ data }) => { currentUserId = data?.session?.user?.id || null }).catch(() => {})

  const channel = supabase
    .channel('nexus-chat-sync')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async ({ new: row }) => withSync('realtime', async () => {
      if (!row?.chat_id) return
      const known = readLocalChats().some((c) => String(c.id) === String(row.chat_id))
      if (!known) { await readChats(currentUserId); notifyChatUpdate() }
      await appendMessage(String(row.chat_id), mapMessage(row))
      if (row.type !== 'reaction' && row.type !== 'receipt' && String(row.sender_id || '') !== String(currentUserId || '')) {
        emit('nexus:incoming-notification', {
          title: 'New message',
          preview: row.encrypted ? 'Encrypted message' : row.type === 'text' ? row.content : 'New attachment received',
          avatarUrl: '/logo.png', type: 'message',
        })
      }
    }))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old: row }) => {
      if (!row?.id) return
      writeLocalChats(readLocalChats().map((chat) => ({ ...chat, messages: (chat.messages || []).filter((m) => m.id !== String(row.id)) })))
      notifyChatUpdate()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, async () => {
      await readChats(currentUserId); notifyChatUpdate()
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export function stopRealtimeListeners(unsubscribe) {
  if (typeof unsubscribe === 'function') unsubscribe()
}

export async function readChats(userId) {
  return withSync('chats', () => readChatsFromSource(userId))
}

async function readChatsFromSource(userId) {
  if (isAppwriteAuthEnabled()) {
    const { chats = [] } = await appwriteData('chats.list')
    const mappedChats = chats.map(({ chat_members: members, ...chat }) => ({
      ...chat,
      id: String(chat.id),
      participant_ids: (members || []).map((member) => String(member.profile_id)),
    }))
    const localById = new Map(readLocalChats().map((chat) => [String(chat.id), chat]))
    const merged = mappedChats.map((chat) => {
      const existing = localById.get(chat.id)
      return { ...existing, ...chat, messages: existing?.messages || [] }
    })
    writeLocalChats(merged)
    return merged
  }
  let remoteChats = null
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, type, avatar_url, encrypted, owner_id, created_at, participant_names, chat_members(profile_id)')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      remoteChats = (data || []).map(({ chat_members: members, ...chat }) => ({
        ...chat, id: String(chat.id), participant_ids: (members || []).map((m) => String(m.profile_id)),
      }))
    } catch {
      remoteChats = null
    }
  }

  const local = readLocalChats()
  if (!remoteChats) {
    if (!userId) return local
    return local.filter((c) => String(c.owner_id || '') === String(userId) || (c.participant_ids || []).map(String).includes(String(userId)))
  }
  const localById = new Map(local.map((c) => [String(c.id), c]))
  const merged = remoteChats.map((chat) => {
    const existing = localById.get(chat.id)
    return { ...existing, ...chat, messages: existing?.messages || [] }
  })
  writeLocalChats(merged)
  return merged
}

export async function writeChats(chats) {
  const localChats = writeLocalChats(chats)
  notifyChange()
  return localChats
}

export async function getChats(userId) {
  return readChats(userId)
}

export async function sendChatMessage(chatId, message) {
  if (isAppwriteAuthEnabled()) {
    if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 65535) throw new Error('Message must contain between 1 and 65,535 characters.')
    if (message.file_url?.startsWith('blob:')) throw new Error('Attachment storage is not connected. This file has not been sent.')
    const { message: savedMessage } = await appwriteData('messages.send', {
      id: UUID_REGEX.test(String(message.id || '')) ? message.id : newId(),
      chatId: String(chatId),
      content: message.content,
      type: message.type || 'text',
      fileUrl: message.file_url || null,
      fileName: message.file_name || null,
      duration: message.duration || null,
      encrypted: Boolean(message.encrypted),
      createdAt: message.created_at || new Date().toISOString(),
    })
    const saved = mapMessage(savedMessage)
    await appendMessage(chatId, saved)
    return saved
  }
  if (!supabase) throw new Error('The chat service is unavailable. The message was not sent.')
  if (!message.sender_id || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 65535) throw new Error('Message must contain between 1 and 65,535 characters.')
  if (message.file_url?.startsWith('blob:')) throw new Error('Attachment storage is not connected. This file has not been sent.')
  const id = UUID_REGEX.test(String(message.id || '')) ? message.id : newId()
  const { error } = await supabase.from('messages').insert({
    id, chat_id: String(chatId), sender_id: String(message.sender_id), content: message.content,
    type: message.type || 'text', file_url: message.file_url || null, file_name: message.file_name || null,
    duration: message.duration || null, encrypted: Boolean(message.encrypted),
    created_at: message.created_at || new Date().toISOString(),
  })
  if (error) throw new Error(error.message || 'Message was not saved. Please try again.')
  const saved = { ...message, id }
  await appendMessage(chatId, saved)
  return saved
}

export async function toggleMessageReaction(chatId, messageId, emoji, userId, active) {
  if (!userId) throw new Error('Sign in to react to messages.')
  return sendChatMessage(chatId, { id: newId(), sender_id: String(userId), type: 'reaction', content: reactionContent(messageId, emoji, active), created_at: new Date().toISOString() })
}

// Acknowledges a batch of received messages. Best-effort: delivery/read state is
// an enhancement, so callers swallow failures rather than surfacing an error.
export async function sendReadReceipt(chatId, userId, messageIds, status) {
  if (!userId) return null
  return sendChatMessage(chatId, {
    id: newId(),
    sender_id: String(userId),
    type: 'receipt',
    content: receiptContent(messageIds, status),
    created_at: new Date().toISOString(),
  })
}

// Folds a batch of messages into one chat without touching storage. Kept pure so
// a whole poll result can be applied with a single read and a single write.
function applyMessagesToChats(chats, chatId, messages) {
  const index = chats.findIndex((item) => String(item.id) === String(chatId))
  if (index === -1) return chats
  const chat = chats[index]
  const existing = Array.isArray(chat.messages) ? chat.messages : []
  // A Map keeps existing messages in place while upserting, so an update never
  // reorders the thread and new messages append in arrival order.
  const byId = new Map(existing.map((m) => [m.id, m]))
  let lastMessage = chat.last_message
  let lastMessageTime = chat.last_message_time

  for (const message of messages) {
    const nextMessage = {
      id: message.id || `${Date.now()}`, sender_id: message.sender_id || 'me', content: message.content || '',
      type: message.type || 'text', encrypted: Boolean(message.encrypted), file_url: message.file_url || null,
      file_name: message.file_name || null, duration: message.duration || null,
      created_at: message.created_at || new Date().toISOString(),
    }
    byId.set(nextMessage.id, nextMessage)
    // Reactions and receipts are protocol control rows: they never become the
    // conversation's last message preview.
    if (nextMessage.type !== 'reaction' && nextMessage.type !== 'receipt') {
      lastMessage = nextMessage.encrypted ? 'Encrypted message' : nextMessage.content
      lastMessageTime = nextMessage.created_at
    }
  }

  const updatedChat = {
    ...chat,
    messages: [...byId.values()],
    last_message: lastMessage,
    last_message_time: lastMessageTime,
    unread_count: 0,
  }
  const nextChats = chats.slice()
  nextChats[index] = updatedChat
  return nextChats
}

// Persists a batch of messages for one chat with a single storage write and a
// single update notification. A burst of N messages therefore costs one
// parse/write/notify cycle instead of N, which is what kept sync slow.
export async function appendMessages(chatId, messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean)
  if (!list.length) return null
  const chats = readLocalChats()
  const nextChats = applyMessagesToChats(chats, chatId, list)
  if (nextChats === chats) return null
  writeLocalChats(nextChats)
  notifyChatUpdate()
  return nextChats.find((item) => String(item.id) === String(chatId)) || null
}

export async function appendMessage(chatId, message) {
  return appendMessages(chatId, [message])
}

// Applies one sync result to local storage in a single pass: chat metadata is
// refreshed, then every chat's messages are folded in before the storage write
// and the update notification happen once. This is the whole client-side sync
// workflow, so it is exported to keep it directly benchmarkable.
export function applyChatSyncBatch(remoteChats, messages) {
  const localChats = readLocalChats()
  const localById = new Map(localChats.map((chat) => [String(chat.id), chat]))
  const knownIds = new Set(remoteChats.map((chat) => String(chat.id)))

  const byChat = new Map()
  const notifications = []
  for (const row of (Array.isArray(messages) ? messages : [])) {
    const chatId = String(row.chat_id)
    if (!knownIds.has(chatId)) continue
    const bucket = byChat.get(chatId)
    if (bucket) bucket.push(row)
    else byChat.set(chatId, [row])
    if (row.type !== 'reaction' && row.type !== 'receipt') {
      notifications.push({
        title: 'New message',
        preview: row.encrypted ? 'Encrypted message' : row.type === 'text' ? row.content : 'New attachment received',
        avatarUrl: '/logo.png',
        type: 'message',
      })
    }
  }

  let nextChats = remoteChats.map((chat) => {
    const existing = localById.get(String(chat.id))
    return { ...existing, ...chat, messages: existing?.messages || [] }
  })
  for (const [chatId, rows] of byChat) {
    nextChats = applyMessagesToChats(nextChats, chatId, rows.map(mapMessage))
  }

  writeLocalChats(nextChats)
  notifyChatUpdate()
  return { chats: nextChats, notifications }
}

export async function getChatById(chatId, userId) {
  return withSync('chat', () => loadChatById(chatId, userId))
}

async function loadChatById(chatId, userId) {
  if (isAppwriteAuthEnabled() && UUID_REGEX.test(String(chatId))) {
    const { chat } = await appwriteData('chats.get', { chatId: String(chatId) })
    if (!chat) return null
    const { chat_members: members, ...rest } = chat
    const hydrated = {
      ...rest,
      id: String(rest.id),
      participant_ids: (members || []).map((member) => String(member.profile_id)),
      messages: (rest.messages || []).map(mapMessage),
    }
    writeLocalChats([hydrated, ...readLocalChats().filter((item) => String(item.id) !== hydrated.id)])
    return hydrated
  }
  if (supabase && UUID_REGEX.test(String(chatId))) {
    const { data: chatData, error } = await supabase
      .from('chats').select('id, title, type, avatar_url, encrypted, owner_id, created_at, participant_names, chat_members(profile_id)')
      .eq('id', chatId).maybeSingle()
    if (error) throw new Error(error.message || 'Could not load this conversation. Please try again.')
    if (!chatData) return null
    const messages = []
    for (let from = 0; ; from += 1000) {
      const { data, error: msgError } = await supabase.from('messages').select('*')
        .eq('chat_id', chatId).order('created_at', { ascending: true }).range(from, from + 999)
      if (msgError) throw new Error(msgError.message || 'Could not load messages.')
      messages.push(...(data || []).map(mapMessage))
      if (!data || data.length < 1000) break
    }
    const { chat_members: members, ...rest } = chatData
    const hydrated = { ...rest, id: String(rest.id), participant_ids: (members || []).map((m) => String(m.profile_id)), messages }
    writeLocalChats([hydrated, ...readLocalChats().filter((c) => String(c.id) !== hydrated.id)])
    return hydrated
  }
  const chats = await getChats(userId)
  return chats.find((chat) => String(chat.id) === String(chatId)) || null
}

export async function createChat(chatData) {
  const participantIds = [...new Set((chatData.participantIds || []).map(String).filter(Boolean))]
  if (participantIds.length && !supabase && !isAppwriteAuthEnabled()) throw new Error('Recipient delivery is unavailable because the chat database is not connected.')

  const newChat = {
    id: newId(), title: chatData.title || 'New Chat', type: chatData.type || 'private',
    avatar_url: chatData.avatar_url || null, last_message: chatData.last_message || 'New conversation',
    last_message_time: new Date().toISOString(), unread_count: 0, encrypted: Boolean(chatData.encrypted),
    owner_id: chatData.owner_id ? String(chatData.owner_id) : null, participant_ids: participantIds,
    participant_names: chatData.participantNames || null,
    messages: chatData.messages || [], created_at: new Date().toISOString(),
  }

  if (isAppwriteAuthEnabled()) {
    const { chat } = await appwriteData('chats.create', {
      chatId: newChat.id,
      title: newChat.title,
      type: newChat.type,
      avatarUrl: newChat.avatar_url,
      encrypted: newChat.encrypted,
      participantIds,
      participantNames: newChat.participant_names,
    })
    newChat.id = String(chat.id)
    newChat.created_at = chat.created_at
    newChat.owner_id = chat.owner_id
  } else if (supabase && newChat.owner_id) {
    const { error } = await supabase.from('chats').insert({
      id: newChat.id, title: newChat.title, type: newChat.type, avatar_url: newChat.avatar_url,
      encrypted: newChat.encrypted, owner_id: newChat.owner_id, created_at: newChat.created_at,
      participant_names: newChat.participant_names,
    })
    if (error) throw new Error(error.message || 'Could not create the conversation.')
    const memberIds = [...new Set([newChat.owner_id, ...participantIds])]
    const { error: memberError } = await supabase.from('chat_members').insert(memberIds.map((profile_id) => ({ chat_id: newChat.id, profile_id })))
    if (memberError) throw new Error(memberError.message || 'Could not add people to the conversation.')
  }

  writeLocalChats([newChat, ...readLocalChats().filter((c) => c.id !== newChat.id)])
  notifyChange()
  return newChat
}


async function getSessionUserId() {
  if (isAppwriteAuthEnabled()) {
    const { profile } = await appwriteData('profile.get')
    return profile?.id || null
  }
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
  } catch {
    return null
  }
}

// Mirrors the device's E2EE provisioning outcome onto the account record so the
// server keeps an auditable status. Best-effort by design: the device stays the
// source of truth for whether messages are encrypted, so a failure here must
// never block the user from using the account.
export async function syncE2EEStatus(enabled, keyPublished) {
  const payload = { enabled: enabled === true, keyPublished: keyPublished === true }
  try {
    if (isAppwriteAuthEnabled()) {
      await appwriteData('profile.setE2ee', payload)
      return true
    }
    if (!supabase) return false
    const { error } = await supabase.rpc('set_my_e2ee_status', {
      p_enabled: payload.enabled,
      p_key_published: payload.keyPublished,
    })
    if (error) throw error
    return true
  } catch (error) {
    console.warn('Could not record the E2EE status:', error)
    return false
  }
}

let contactsChannel = null
let inFlightContactsSync = null

function mapCloudContact(row) {
  return {
    id: row.id,
    name: row.name,
    nexusId: row.nexus_id,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
  }
}

async function syncContactsFromCloud(userId) {
  if (inFlightContactsSync) return inFlightContactsSync
  inFlightContactsSync = withSync('contacts', async () => {
    try {
      return await loadContactsFromCloud(userId)
    } finally {
      inFlightContactsSync = null
    }
  })
  return inFlightContactsSync
}

async function loadContactsFromCloud(userId) {
  if (isAppwriteAuthEnabled()) {
    const { contacts = [] } = await appwriteData('contacts.list')
    const mapped = contacts.map(mapCloudContact)
    const local = readLocalContacts()
    // Only update and notify if the data actually changed to prevent event loops.
    if (JSON.stringify(mapped) === JSON.stringify(local)) return mapped
    writeLocalContacts(mapped)
    notifyContactsUpdate()
    return mapped
  }
  if (!supabase || !userId) return null
  try {
    // Prefer the directory-authoritative view so a stale stored snapshot can
    // never show the wrong name; fall back to the raw table before the
    // list_my_contacts migration is applied.
    let rows = null
    const { data: resolved, error: rpcError } = await supabase.rpc('list_my_contacts')
    if (!rpcError && Array.isArray(resolved)) rows = resolved
    if (!rows) {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, nexus_id, avatar_url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      rows = data || []
    }
    const contacts = rows.map(mapCloudContact)
    const local = readLocalContacts()
    if (JSON.stringify(contacts) === JSON.stringify(local)) return contacts
    writeLocalContacts(contacts)
    notifyContactsUpdate()
    return contacts
  } catch (err) {
    console.error('Contact sync failed:', err)
    emit('nexus:sync-error', {
      key: 'contacts',
      message: 'Failed to sync contacts with the cloud.',
      error: err
    })
    return null
  }
}

function ensureContactsRealtime(userId) {
  if (isAppwriteAuthEnabled()) return
  if (!supabase || !userId || contactsChannel) return
  contactsChannel = supabase
    .channel('nexus-contacts-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `user_id=eq.${userId}` }, () => {
      void syncContactsFromCloud(userId)
    })
    .subscribe()
}

export async function getContacts(forceSync = false) {
  const userId = await getSessionUserId()
  if (userId) {
    ensureContactsRealtime(userId)
    if (forceSync) {
      const cloud = await syncContactsFromCloud(userId)
      if (cloud) return cloud
    } else {
      // Start background sync if not forced, but return local data immediately.
      void syncContactsFromCloud(userId)
    }
  }
  return readLocalContacts()
}

export async function addContact(contactData) {
  const userId = await getSessionUserId()
  if (isAppwriteAuthEnabled()) {
    const { contact: row } = await appwriteData('contacts.save', {
      name: contactData.name,
      nexusId: String(contactData.nexusId || '').replace(/\D/g, ''),
      avatarUrl: contactData.avatarUrl || null,
    })
    const contact = mapCloudContact(row)
    const contacts = [contact, ...readLocalContacts().filter((item) => item.id !== contact.id && item.nexusId !== contact.nexusId)]
    writeLocalContacts(contacts)
    notifyContactsUpdate()
    return contact
  }
  if (userId && supabase) {
    const { data, error } = await supabase
      .from('contacts')
      .upsert({
        user_id: userId,
        name: contactData.name,
        nexus_id: String(contactData.nexusId || '').replace(/\D/g, ''),
        avatar_url: contactData.avatarUrl || null,
      }, { onConflict: 'user_id,nexus_id' })
      .select('id, name, nexus_id, avatar_url, created_at')
      .single()
    if (!error && data) {
      const contact = mapCloudContact(data)
      const contacts = [contact, ...readLocalContacts().filter(c => c.id !== contact.id && c.nexusId !== contact.nexusId)]
      writeLocalContacts(contacts)
      notifyContactsUpdate()
      return contact
    }
  }

  const contacts = readLocalContacts()
  const newContact = {
    id: `${Date.now()}`,
    name: contactData.name,
    nexusId: contactData.nexusId,
    avatarUrl: contactData.avatarUrl || null,
    createdAt: new Date().toISOString(),
  }
  const updatedContacts = [newContact, ...contacts]
  await writeLocalContacts(updatedContacts)
  notifyContactsUpdate()
  return newContact
}

export async function isContactSaved(nexusId) {
  const digits = String(nexusId || '').replace(/\D/g, '')
  if (!digits) return false
  const contacts = await getContacts()
  return contacts.some((contact) => String(contact.nexusId || '').replace(/\D/g, '') === digits)
}

export function formatNexusId(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 10) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`
  }
  return raw
}

export async function searchUserByNexusId(nexusId) {
  const normalizedId = String(nexusId || '').replace(/\D/g, '')
  if (!/^10\d{8}$/.test(normalizedId)) return null
  return findMemberByNexusId(normalizedId)
}
