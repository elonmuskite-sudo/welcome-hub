import { supabase } from './supabase'

// supabase-js keeps its session in localStorage, which Vercel's Edge Middleware
// cannot read. After an admin signs in, mirror that session into the signed
// HttpOnly cookie enforced by middleware.js so direct requests to /admin* are
// authorised on the server as well as in the browser.
export async function establishAdminSession() {
  if (!supabase) return false
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return false
  try {
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.ok
  } catch {
    // Native builds and local previews have no server functions; the in-app
    // admin guard still verifies the role against the database.
    return false
  }
}

export async function clearAdminSession() {
  try {
    await fetch('/api/admin/session', { method: 'DELETE' })
  } catch {
    // Signing out locally must never be blocked by an unreachable cookie endpoint.
  }
}
