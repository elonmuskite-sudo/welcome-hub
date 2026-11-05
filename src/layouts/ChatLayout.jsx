import { useEffect, useMemo, useCallback, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import ChatSidebar from '../components/chat/ChatSidebar'
import ChatButton from '../components/chat/ChatButton'
import BottomNav, { getActiveTabFromPath } from '../components/chat/BottomNav'
import AppTopNav from '../components/chat/AppTopNav'
import NotificationStack from '../components/chat/NotificationStack'
import VoiceCallOverlay from '../components/chat/VoiceCallOverlay'
import ErrorBoundary from '../components/ErrorBoundary'
import SyncIndicator from '../components/SyncIndicator'
import Header from '../components/Header'
import { requestNotificationPermission, showSystemNotification } from '../lib/notifications'
import { getChats, getContacts, startRealtimeListeners, stopRealtimeListeners } from '../lib/persistence'
import { useAuth } from '../lib/AuthContext'
import { publishMyPublicKey, applyE2EEDefaultForExistingAccount, shouldShowE2EEDefaultNotice, dismissE2EEDefaultNotice } from '../lib/crypto/e2ee'
import { syncE2EEStatus } from '../lib/persistence'
import { useViewportInsets } from '../hooks/useViewportInsets'

export default function ChatLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [showE2eeNotice, setShowE2eeNotice] = useState(false)
  const [initialSync, setInitialSync] = useState({ status: 'loading', error: '' })
  const [syncAttempt, setSyncAttempt] = useState(0)
  useViewportInsets()

  useEffect(() => {
    if (!user?.id) return undefined
    let active = true
    let timeoutId
    setInitialSync({ status: 'loading', error: '' })
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('Initial sync is taking longer than expected.')), 20000)
    })
    Promise.race([Promise.all([getChats(user.id), getContacts()]), timeout])
      .then(() => { if (active) setInitialSync({ status: 'ready', error: '' }) })
      .catch((error) => { if (active) setInitialSync({ status: 'failed', error: error?.message || 'Could not sync your workspace.' }) })
      .finally(() => window.clearTimeout(timeoutId))
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [user?.id, syncAttempt])

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
    applyE2EEDefaultForExistingAccount()
    // Republish the key and mirror mandatory encryption status for this device.
    void publishMyPublicKey()
      .then(() => syncE2EEStatus(true, true))
      .catch((error) => {
        console.error('Could not publish the device encryption key:', error)
        void syncE2EEStatus(true, false)
      })
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
            Text messages require end-to-end encryption on this device. Sending is blocked when encryption keys are unavailable. Your private key never leaves this device.
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

      {initialSync.status !== 'ready' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background px-6 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-sm text-center">
            {initialSync.status === 'loading' ? (
              <>
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" role="status" aria-label="Syncing workspace" />
                <h1 className="mt-5 text-lg font-semibold text-foreground">Syncing your workspace</h1>
                <p className="mt-2 text-sm text-muted-foreground">Loading your conversations and contacts…</p>
              </>
            ) : (
              <>
                <h1 className="text-lg font-semibold text-foreground">Initial sync didn’t finish</h1>
                <p role="alert" className="mt-2 text-sm text-muted-foreground">{initialSync.error}</p>
                <div className="mt-5 flex flex-col gap-2">
                  <button type="button" onClick={() => setSyncAttempt((attempt) => attempt + 1)} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Retry sync</button>
                  <button type="button" onClick={() => setInitialSync({ status: 'ready', error: '' })} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground">Continue with saved data</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
