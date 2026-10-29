import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

let supabaseAdmin

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin
  const url = String(process.env.SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) throw new Error('Push delivery is missing server-side Supabase configuration.')
  supabaseAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return supabaseAdmin
}

function firebaseMessaging() {
  const serviceAccountValue = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()
  if (!serviceAccountValue) return null
  let serviceAccount
  try {
    serviceAccount = JSON.parse(serviceAccountValue)
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.')
  }
  const app = getApps().find((entry) => entry.name === 'nexus-call-push')
    || initializeApp({ credential: cert(serviceAccount) }, 'nexus-call-push')
  return getMessaging(app)
}

function configureWebPush() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim()
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim()
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT || '').trim()
  if (!publicKey || !privateKey || !subject) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

function pushData(call) {
  return {
    callId: String(call.callId),
    chatId: String(call.chatId),
    fromUserId: String(call.fromUserId),
    fromName: String(call.fromName || 'Nexus user').slice(0, 100),
    fromAvatar: String(call.fromAvatar || '').slice(0, 2048),
    expiresAt: String(call.expiresAt),
  }
}

function isExpiredPushError(error) {
  return error?.statusCode === 404 || error?.statusCode === 410
    || error?.code === 'messaging/registration-token-not-registered'
    || error?.code === 'messaging/invalid-registration-token'
}

export async function sendCallPush(recipientId, call) {
  const expiresAt = Number(call.expiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return { sent: 0, configured: false }
  }
  let webReady = false
  let messaging = null
  try {
    webReady = configureWebPush()
  } catch (error) {
    console.error('Web Push configuration is invalid.', error)
  }
  try {
    messaging = firebaseMessaging()
  } catch (error) {
    console.error('Firebase Cloud Messaging configuration is invalid.', error)
  }
  const configured = webReady || Boolean(messaging)
  if (!configured) return { sent: 0, configured: false }

  const admin = getSupabaseAdmin()
  const { data: subscriptions, error } = await admin
    .from('call_push_subscriptions')
    .select('id, platform, endpoint, p256dh, auth')
    .eq('user_id', recipientId)
  if (error) throw new Error('Could not load call push destinations.')
  if (!subscriptions?.length) return { sent: 0, configured: true }
  const canDeliver = subscriptions.some((subscription) => (
    (subscription.platform === 'web' && webReady)
    || (subscription.platform !== 'web' && messaging)
  ))
  if (!canDeliver) return { sent: 0, configured: false }
  const data = pushData(call)
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))
  const ttlMilliseconds = Math.max(1000, expiresAt - Date.now())
  const notification = {
    title: 'Incoming voice call',
    body: `${data.fromName} is calling you. Tap to answer.`,
    data,
  }
  const expiredIds = []
  let sent = 0

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      if (subscription.platform === 'web' && webReady) {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(notification),
          { TTL: ttlSeconds, urgency: 'high' },
        )
        sent += 1
      } else if (subscription.platform !== 'web' && messaging) {
        await messaging.send({
          token: subscription.endpoint,
          notification: { title: notification.title, body: notification.body },
          data,
          android: { priority: 'high', ttl: ttlMilliseconds, notification: { channelId: 'incoming-calls', sound: 'default' } },
          apns: { headers: { 'apns-priority': '10', 'apns-expiration': String(Math.floor(expiresAt / 1000)) }, payload: { aps: { sound: 'default' } } },
        })
        sent += 1
      }
    } catch (sendError) {
      if (isExpiredPushError(sendError)) expiredIds.push(subscription.id)
      else console.error(`Call push delivery failed for ${subscription.platform}.`, sendError)
    }
  }))

  if (expiredIds.length) {
    const { error: deleteError } = await admin
      .from('call_push_subscriptions')
      .delete()
      .in('id', expiredIds)
    if (deleteError) console.error('Could not remove expired call push subscriptions.', deleteError)
  }
  return { sent, configured: true }
}
