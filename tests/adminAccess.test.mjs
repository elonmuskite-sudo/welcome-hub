import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionClearedCookie,
  adminSessionSetCookie,
  createAdminSessionToken,
  readAdminSessionCookie,
  verifyAdminSessionToken,
} from '../server/adminSession.js'

const { default: middleware, config } = await import('../middleware.js')

const SECRET = 'test-admin-session-secret'
const USER_ID = '3f1a0c62-2b1e-4a8f-9d1c-5e7b0a4c8d21'
const ORIGIN = 'https://nexus-chat-world.com'

function request(pathname, cookie) {
  return new Request(`${ORIGIN}${pathname}`, cookie ? { headers: { cookie } } : undefined)
}

function cookieHeader(token) {
  return `${ADMIN_SESSION_COOKIE}=${token}`
}

test('admin session tokens round-trip and carry the admin user id', async () => {
  const token = await createAdminSessionToken(USER_ID, SECRET)
  const session = await verifyAdminSessionToken(token, SECRET)
  assert.equal(session?.userId, USER_ID)
})

test('a tampered or foreign-signed token is rejected', async () => {
  const token = await createAdminSessionToken(USER_ID, SECRET)
  assert.equal(await verifyAdminSessionToken(`${token}x`, SECRET), null)
  assert.equal(await verifyAdminSessionToken(await createAdminSessionToken(USER_ID, 'other-secret'), SECRET), null)
  assert.equal(await verifyAdminSessionToken(`${USER_ID}.${Date.now() + 1000}.deadbeef`, SECRET), null)
  assert.equal(await verifyAdminSessionToken('', SECRET), null)
  assert.equal(await verifyAdminSessionToken(token, ''), null)
  // The signature covers the user id, so swapping it invalidates the token.
  const [userId, expiresAt, signature] = token.split('.')
  assert.equal(await verifyAdminSessionToken(`${userId}1.${expiresAt}.${signature}`, SECRET), null)
})

test('an expired token is rejected', async () => {
  const expired = await createAdminSessionToken(USER_ID, SECRET, -1)
  assert.equal(await verifyAdminSessionToken(expired, SECRET), null)
})

test('the session cookie is HttpOnly, path-scoped and parseable', async () => {
  const token = await createAdminSessionToken(USER_ID, SECRET)
  const header = adminSessionSetCookie(token)
  assert.match(header, /HttpOnly/)
  assert.match(header, /Path=\//)
  assert.match(header, /SameSite=Lax/)
  assert.match(header, new RegExp(`Max-Age=${ADMIN_SESSION_TTL_SECONDS}`))
  assert.equal(readAdminSessionCookie(`other=1; ${cookieHeader(token)}; more=2`), token)

  const cleared = adminSessionClearedCookie()
  assert.match(cleared, /Max-Age=0/)
  assert.equal(readAdminSessionCookie(''), null)
})

test('middleware only guards admin routes', () => {
  assert.deepEqual(config.matcher, ['/admin', '/admin/:path*'])
})

test('unauthenticated admin requests are redirected to the admin sign-in page', async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET
  const response = await middleware(request('/admin/dashboard'))
  assert.equal(response.status, 307)
  assert.equal(response.headers.get('location'), `${ORIGIN}/admin/login?next=%2Fadmin%2Fdashboard`)
})

test('every gated admin path redirects when the cookie is missing or invalid', async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET
  for (const pathname of ['/admin', '/admin/', '/admin/users', '/admin/diagnostics']) {
    const response = await middleware(request(pathname))
    assert.equal(response.status, 307, `${pathname} should be gated`)
    assert.ok(response.headers.get('location').startsWith(`${ORIGIN}/admin/login?next=`))
  }

  const forged = await middleware(request('/admin/users', cookieHeader('forged.value.signature')))
  assert.equal(forged.status, 307)

  const foreign = await createAdminSessionToken(USER_ID, 'a-different-secret')
  const foreignResponse = await middleware(request('/admin/users', cookieHeader(foreign)))
  assert.equal(foreignResponse.status, 307)
})

test('a valid admin session is allowed through', async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET
  const token = await createAdminSessionToken(USER_ID, SECRET)
  for (const pathname of ['/admin', '/admin/dashboard', '/admin/users', '/admin/diagnostics']) {
    assert.equal(await middleware(request(pathname, cookieHeader(token))), undefined, `${pathname} should be allowed`)
  }
})

test('the admin sign-in page stays reachable without a session', async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET
  assert.equal(await middleware(request('/admin/login')), undefined)
  assert.equal(await middleware(request('/admin/login/')), undefined)
})

test('the gate fails closed when the signing secret is not configured', async () => {
  delete process.env.ADMIN_SESSION_SECRET
  const token = await createAdminSessionToken(USER_ID, SECRET)
  const response = await middleware(request('/admin/dashboard', cookieHeader(token)))
  assert.equal(response.status, 307)
  process.env.ADMIN_SESSION_SECRET = SECRET
})

test('the admin session endpoint and route guards exist in the app', () => {
  const endpoint = fs.readFileSync(new URL('../api/admin/session.js', import.meta.url), 'utf8')
  assert.match(endpoint, /admin\.auth\.getUser\(token\)/)
  assert.match(endpoint, /has_role/)
  assert.match(endpoint, /adminSessionSetCookie/)
  assert.match(endpoint, /ADMIN_SESSION_SECRET/)

  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  for (const path of ['/admin/login', '/admin/dashboard', '/admin/users', '/admin/diagnostics']) {
    assert.ok(app.includes(`path="${path}"`), `${path} route is missing`)
  }

  const guard = fs.readFileSync(new URL('../src/components/AdminGuard.jsx', import.meta.url), 'utf8')
  assert.match(guard, /Navigate to="\/admin\/login"/)
})
