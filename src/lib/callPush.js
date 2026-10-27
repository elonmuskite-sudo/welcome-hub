import { Capacitor } from '@capacitor/core'
import { appwriteData, isAppwriteAuthEnabled } from './appwrite'
import { supabase } from './supabase'

const WEB_PUSH_PUBLIC_KEY = String(import.meta.env?.VITE_WEB_PUSH_PUBLIC_KEY || '').trim()
let nativeListenersReady
let nativeRegistration

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function incomingCallUrl(data = {}) {
  const chatId = String(data.chatId || '')
  if (!chatId) return '/app'
  const query = new URLSearchParams({
    incomingCall: String(data.callId || ''),
    expiresAt: String(data.expiresAt || ''),
    fromUserId: String(data.fromUserId || ''),
    fromName: String(data.fromName || 'Contact'),
    fromAvatar: String(data.fromAvatar || ''),
  })
  return `/app/chat/${encodeURIComponent(chatId)}?${query}`
}

function openIncomingCall(data) {
  window.location.assign(incomingCallUrl(data))
}

async function saveSubscription(payload) {
  if (isAppwriteAuthEnabled()) {
    await appwriteData('calls.push.register', payload)
    return
  }
  if (!supabase) throw new Error('Push notifications are not configured.')
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('Sign in again to enable call alerts.')
  const response = await fetch('/api/calls/push-subscription', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error || 'Call alerts could not be enabled.')
}

export async function notifyCallPush({ chatId, callId, expiresAt }) {
  if (isAppwriteAuthEnabled()) {
    return appwriteData('calls.push.notify', { chatId, callId, expiresAt })
  }
  if (!supabase) throw new Error('Call notifications are not configured.')
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('Sign in again to notify the other participant.')
  const response = await fetch('/api/calls/notify', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, callId, expiresAt }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error || 'The background call alert could not be sent.')
  return result
}

async function installNativeListeners(PushNotifications) {
  if (nativeListenersReady) return nativeListenersReady
  nativeListenersReady = (async () => {
    await PushNotifications.addListener('registration', (token) => {
      const subscription = {
        platform: Capacitor.getPlatform(),
        endpoint: token.value,
      }
      if (!nativeRegistration) {
        if (window.localStorage.getItem('nexus-call-alerts-enabled') === 'true') {
          saveSubscription(subscription).catch((error) => console.error('Could not refresh the native call push registration.', error))
        }
        return
      }
      const current = nativeRegistration
      nativeRegistration = null
      window.clearTimeout(current.timeoutId)
      saveSubscription(subscription).then(current.resolve, current.reject)
    })
    await PushNotifications.addListener('registrationError', (event) => {
      if (!nativeRegistration) return
      const current = nativeRegistration
      nativeRegistration = null
      window.clearTimeout(current.timeoutId)
      current.reject(new Error(event?.error || 'Device push registration failed.'))
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      const data = event?.notification?.data
      if (data?.callId && data?.chatId) openIncomingCall(data)
    })
  })().catch((error) => {
    nativeListenersReady = null
    throw error
  })
  return nativeListenersReady
}

export async function initializeNativeCallPush() {
  if (!Capacitor.isNativePlatform()) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await installNativeListeners(PushNotifications)
  if (window.localStorage.getItem('nexus-call-alerts-enabled') === 'true') {
    await PushNotifications.register()
  }
}

export async function enableCallAlerts() {
  if (Capacitor.isNativePlatform()) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const permission = await PushNotifications.requestPermissions()
    if (permission.receive !== 'granted') throw new Error('Allow notifications in device settings to receive calls.')
    await installNativeListeners(PushNotifications)
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: 'incoming-calls',
        name: 'Incoming calls',
        description: 'Alerts for incoming voice calls',
        importance: 5,
        visibility: 1,
        vibration: true,
      })
    }
    const registered = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (!nativeRegistration) return
        nativeRegistration = null
        reject(new Error('Device push registration timed out.'))
      }, 15000)
      nativeRegistration = { resolve, reject, timeoutId }
    })
    try {
      await PushNotifications.register()
    } catch (error) {
      if (nativeRegistration) {
        window.clearTimeout(nativeRegistration.timeoutId)
        const current = nativeRegistration
        nativeRegistration = null
        current.reject(error)
      }
    }
    await registered
    return
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser does not support background call notifications.')
  }
  if (!WEB_PUSH_PUBLIC_KEY) throw new Error('Web push is not configured on this deployment yet.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Allow browser notifications to receive calls.')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(WEB_PUSH_PUBLIC_KEY),
  })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.')
  }
  await saveSubscription({
    platform: 'web',
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
}
