const CACHE_NAME = 'nexus-chat-v5';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {}));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request).catch(() => undefined)
          if (cachedPage) return cachedPage
          const appShell = await caches.match('/index.html').catch(() => undefined)
          return appShell || new Response('Nexus Chat is temporarily unavailable offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .catch(() => undefined)
      .then((cached) => cached || fetch(request))
      .catch(() => new Response('This resource is temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))
  );
});

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { title: 'Incoming voice call', body: 'Open Nexus Chat to answer.' }
  }
  const data = payload.data || payload
  const chatId = String(data.chatId || '')
  const url = chatId
    ? `/app/chat/${encodeURIComponent(chatId)}?incomingCall=${encodeURIComponent(String(data.callId || ''))}&expiresAt=${encodeURIComponent(String(data.expiresAt || ''))}&fromUserId=${encodeURIComponent(String(data.fromUserId || ''))}&fromName=${encodeURIComponent(String(data.fromName || 'Contact'))}&fromAvatar=${encodeURIComponent(String(data.fromAvatar || ''))}`
    : '/app'

  event.waitUntil(self.registration.showNotification(payload.title || 'Incoming voice call', {
    body: payload.body || 'Open Nexus Chat to answer.',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.callId ? `call-${data.callId}` : 'nexus-call',
    renotify: true,
    requireInteraction: true,
    data: { url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/app', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'navigate' in client) {
        await client.navigate(targetUrl)
        return client.focus()
      }
    }
    return self.clients.openWindow(targetUrl)
  })())
})
