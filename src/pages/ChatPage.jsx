import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import ChatView from '../components/chat/ChatView'
import { getChatById } from '../data/mockChats'
import { useAuth } from '../lib/AuthContext'

export default function ChatPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [chat, setChat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
          setLoading(false)
        }
      } catch (err) {
        if (active && currentRequest === requestId) {
          setError(err.message)
          setLoading(false)
        }
      }
    }
    setChat(null)
    syncChat(true)
    
    const handleUpdate = () => {
      syncChat()
    }
    window.addEventListener('nexus-chat:updated', handleUpdate)
    return () => {
      active = false
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
      <div className="flex-1 flex items-center justify-center bg-background h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading chat...</p>
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
      autoStartCall={autoStartCall}
      onBack={() => navigate('/app')}
    />
  )
}
