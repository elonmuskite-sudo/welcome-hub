import { useEffect, useMemo, useCallback } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import ChatSidebar from '../components/chat/ChatSidebar'
import BottomNav, { getActiveTabFromPath } from '../components/chat/BottomNav'
import AppTopNav from '../components/chat/AppTopNav'
import NotificationStack from '../components/chat/NotificationStack'
import VoiceCallOverlay from '../components/chat/VoiceCallOverlay'
import Header from '../components/Header'
import { requestNotificationPermission, showSystemNotification } from '../lib/notifications'
import { startRealtimeListeners, stopRealtimeListeners } from '../lib/persistence'
import { useViewportInsets } from '../hooks/useViewportInsets'

export default function ChatLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  useViewportInsets()

  useEffect(() => {
    async function initNotifications() {
      const permission = await requestNotificationPermission()
      if (permission !== 'granted') {
        showSystemNotification({
          title: 'Notification permissions needed',
          preview: 'Enable browser notifications to stay informed of new messages and chat activity.',
        })
      }
    }

    initNotifications()
    const channel = startRealtimeListeners()
    return () => stopRealtimeListeners(channel)
  }, [])

  const activeTab = useMemo(() => getActiveTabFromPath(location.pathname), [location.pathname])

  const handleTabChange = useCallback((tab) => {
    const routes = {
      chats: '/app',
      feeds: '/app/feeds',
      contacts: '/app/contacts',
      settings: '/app/settings',
      admin: '/admin',
    }
    navigate(routes[tab] || '/app')
  }, [navigate])

  return (
    <div className="chat-shell relative flex flex-col bg-background overflow-hidden">
      <Header showSignIn={false}>
        <AppTopNav variant="user" />
      </Header>

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden pb-[var(--chat-bottom-offset,84px)] md:pb-0">
        <div className="hidden md:flex md:w-96 flex-col bg-card border-r border-border">
          <ChatSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        </div>

        <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <NotificationStack />

      {/* Rendered here rather than per-chat so an incoming call rings on any page. */}
      <VoiceCallOverlay />
    </div>
  )
}
