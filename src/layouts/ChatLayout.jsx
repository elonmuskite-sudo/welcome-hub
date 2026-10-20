import { useEffect, useMemo, useCallback, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import ChatSidebar from '../components/chat/ChatSidebar'
import BottomNav, { getActiveTabFromPath } from '../components/chat/BottomNav'
import AppTopNav from '../components/chat/AppTopNav'
import NotificationStack from '../components/chat/NotificationStack'
import VoiceCallOverlay from '../components/chat/VoiceCallOverlay'
import ErrorBoundary from '../components/ErrorBoundary'
import SyncIndicator from '../components/SyncIndicator'
import Header from '../components/Header'
import { requestNotificationPermission, showSystemNotification } from '../lib/notifications'
import { startRealtimeListeners, stopRealtimeListeners } from '../lib/persistence'
import { isE2EEEnabled, publishMyPublicKey, applyE2EEDefaultForExistingAccount, shouldShowE2EEDefaultNotice, dismissE2EEDefaultNotice } from '../lib/crypto/e2ee'
import { useViewportInsets } from '../hooks/useViewportInsets'

export default function ChatLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [showE2eeNotice, setShowE2eeNotice] = useState(false)
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
    // Accounts that predate automatic enablement keep their existing opt-in
    // status; only accounts provisioned at signup run encrypted by default.
    applyE2EEDefaultForExistingAccount()
    // Republish the device public key on launch so contacts can always find it.
    // Best-effort: a failure never blocks the chat UI.
    if (isE2EEEnabled()) publishMyPublicKey().catch(() => {})
    setShowE2eeNotice(shouldShowE2EEDefaultNotice())
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

      <SyncIndicator />

      {showE2eeNotice && (
        <div role="status" className="flex items-start gap-3 border-b border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
          <p className="flex-1">
            Your messages are end-to-end encrypted by default on this device. Your private key never leaves this browser.
          </p>
          <ChatButton
            type="button"
            onClick={() => { dismissE2EEDefaultNotice(); setShowE2eeNotice(false) }}
            className="font-semibold text-primary hover:underline"
          >
            Got it
          </ChatButton>
        </div>
      )}

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden pb-[var(--chat-bottom-offset,72px)] md:pb-0">
        <div className="hidden md:flex md:w-96 flex-col bg-card border-r border-border">
          <ChatSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        </div>

        <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
          <ErrorBoundary label="chat" resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <NotificationStack />

      {/* Rendered here rather than per-chat so an incoming call rings on any page. */}
      <VoiceCallOverlay />
    </div>
  )
}
