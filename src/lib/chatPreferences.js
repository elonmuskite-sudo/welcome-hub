const MUTED_CHATS_KEY = 'nexus-muted-chats-v1'

function readMutedChats() {
  if (typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(window.localStorage.getItem(MUTED_CHATS_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function isChatMuted(chatId) {
  return Boolean(chatId && readMutedChats()[String(chatId)])
}

export function setChatMuted(chatId, muted) {
  if (!chatId || typeof window === 'undefined') return
  const chats = readMutedChats()
  if (muted) chats[String(chatId)] = true
  else delete chats[String(chatId)]
  window.localStorage.setItem(MUTED_CHATS_KEY, JSON.stringify(chats))
  window.dispatchEvent(new CustomEvent('nexus-chat:preferences-updated', { detail: { chatId: String(chatId) } }))
}
