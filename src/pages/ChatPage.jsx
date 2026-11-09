import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import ChatView from '../components/chat/ChatView'
import { SyncSpinner } from '../components/SyncIndicator'
import { getCachedChatById, getChatById } from '../lib/persistence'
import { useAuth } from '../lib/AuthContext'

export default function ChatPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [chat, setChat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cacheWarning, setCacheWarning] = useState(false)
  // Capture once: the lookup "Call" action navigates here with a transient flag
  // that should start the call a single time and must not replay on history nav.
  const [autoStartCall] = useState(() => Boolean(location.state?.autoStartCall))

  useEffect(() => {
    if (location.state?.autoStartCall) {
      navigate(location.pathname, { replace: true, state: null })
    }
    // Only needs to strip the transient flag on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    let requestId = 0
    const syncChat = async (initial = false) => {
      const currentRequest = ++requestId
      try {
        if (initial) setLoading(true)
        setError(null)
        const nextChat = await getChatById(chatId, user?.id)
        if (active && currentRequest === requestId) {
          setChat(nextChat)
          setCacheWarning(false)
          setLoading(false)
        }
      } catch (err) {
        if (active && currentRequest === requestId) {
          const cachedChat = getCachedChatById(chatId, user?.id)
          if (cachedChat) {
            setChat(cachedChat)
            setCacheWarning(true)
            setError(null)
          } else {
            setError(err.message)
          }
          setLoading(false)
        }
      }
    }
    const cachedChat = getCachedChatById(chatId, user?.id)
    setChat(cachedChat)
    setCacheWarning(false)
    setLoading(!cachedChat)
    void syncChat(!cachedChat)

    // Bursts of updates (one sync tick can change several threads) collapse into
    // a single refetch instead of one full chat load per notification.
    let pending = null
    const handleUpdate = (event) => {
      if (event.detail?.cacheUpdated) {
        const cachedChat = getCachedChatById(chatId, user?.id)
        if (cachedChat) {
          setChat(cachedChat)
          setCacheWarning(false)
          setError(null)
        }
        return
      }
      if (pending) return
      pending = window.setTimeout(() => { pending = null; void syncChat() }, 150)
    }
    window.addEventListener('nexus-chat:updated', handleUpdate)
    return () => {
      active = false
      if (pending) window.clearTimeout(pending)
      window.removeEventListener('nexus-chat:updated', handleUpdate)
    }
  }, [chatId, user?.id])

  useEffect(() => {
    if (!loading && !chat && !error) {
      navigate('/app', { replace: true })
    }
  }, [chat, loading, error, navigate])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background h-full" aria-busy="true">
        <div className="flex flex-col items-center gap-3 text-center">
          <SyncSpinner className="h-8 w-8" label="Loading chat" />
          <p className="text-sm text-muted-foreground">Loading chat…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background h-full">
        <div className="text-center">
          <p className="text-sm text-destructive font-medium mb-2">Error loading chat</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate('/app')}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm"
          >
            Back to chats
          </button>
        </div>
      </div>
    )
  }

  if (!chat) return null

  return (
    <ChatView
      key={chat.id}
      chat={chat}
      cacheWarning={cacheWarning}
      autoStartCall={autoStartCall}
      onBack={() => navigate('/app')}
    />
  )
}
