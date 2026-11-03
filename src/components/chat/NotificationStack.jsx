import { BellIcon } from '@heroicons/react/24/solid'
import { useEffect, useState } from 'react'
import { isChatMuted } from '../../lib/chatPreferences'

export default function NotificationStack() {
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    const handleNotification = (event) => {
      const detail = event.detail || {}
      if (detail.chatId && isChatMuted(detail.chatId)) return
      const id = detail.id || `${Date.now()}-${Math.random()}`
      const next = {
        id,
        title: detail.title || 'New activity',
        preview: detail.preview || detail.body || 'You received a new update.',
        avatarUrl: detail.avatarUrl || '/logo.png',
        type: detail.type || 'message',
      }

      setNotifications((prev) => [...prev, next].slice(-4))

      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((item) => item.id !== id))
      }, 3500)
    }

    window.addEventListener('nexus:incoming-notification', handleNotification)
    window.addEventListener('nexus:system-notification', handleNotification)

    return () => {
      window.removeEventListener('nexus:incoming-notification', handleNotification)
      window.removeEventListener('nexus:system-notification', handleNotification)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[70] flex items-center justify-end pr-3 sm:pr-6">
      <div className="flex w-80 flex-col gap-3">
        {notifications.map((notification, index) => (
          <div
            key={notification.id}
            className="animate-[slide-in_320ms_ease-out] rounded-[20px] border border-slate-800/70 bg-slate-950/95 p-3 text-slate-100 shadow-[0_24px_70px_rgba(2,6,23,0.42)] backdrop-blur"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                {notification.avatarUrl ? (
                  <img src={notification.avatarUrl} alt={notification.title} className="h-full w-full object-cover" />
                ) : (
                  <BellIcon className="h-5 w-5 text-sky-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{notification.title}</p>
                  <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-slate-400">
                    {notification.type}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-300">{notification.preview}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
