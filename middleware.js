import { readAdminSessionCookie, verifyAdminSessionToken } from './server/adminSession.js'

// Server-side gate for every admin route. supabase-js stores the browser session
// in localStorage, which middleware cannot read, so the admin sign-in flow
// mirrors that session into a signed HttpOnly cookie issued by
// /api/admin/session. Without that cookie the request never reaches the app.
export const config = { matcher: ['/admin', '/admin/:path*'] }

const ADMIN_LOGIN_PATH = '/admin/login'

export default async function middleware(request) {
  const url = new URL(request.url)
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname

  // The admin sign-in page is the one admin route reachable without a session.
  if (pathname === ADMIN_LOGIN_PATH) return undefined

  const secret = String(process.env.ADMIN_SESSION_SECRET || '').trim()
  const session = await verifyAdminSessionToken(readAdminSessionCookie(request.headers.get('cookie')), secret)
  if (session) return undefined

  const loginUrl = new URL(ADMIN_LOGIN_PATH, url.origin)
  loginUrl.searchParams.set('next', `${url.pathname}${url.search}`)
  return Response.redirect(loginUrl.toString(), 307)
}
