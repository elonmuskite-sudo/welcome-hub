import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { welcomeTemplate } from '../_shared/welcome-template.js'

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
// Older accounts must not receive unexpected welcome mail on their next sign-in.
const welcomeEnabledAt = Date.parse('2026-10-16T11:39:00Z')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json(503, { error: 'Account services unavailable' })
    const authorization = req.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.auth.getUser(authorization.slice(7))
    const user = data.user
    if (error || !user) return json(401, { error: 'Session expired' })
    if (!user.email || !user.email_confirmed_at) return json(403, { error: 'Confirm your email first' })
    if (user.app_metadata?.nexus_welcome_sent_at || Date.parse(user.created_at) < welcomeEnabledAt) return json(200, { skipped: true })
    const apiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('RESEND_FROM')
    const appUrl = Deno.env.get('APP_URL')
    if (!apiKey || !from || !appUrl) return json(503, { error: 'Welcome email needs a verified Resend sender and APP_URL' })
    const template = welcomeTemplate({ name: user.user_metadata?.first_name || '', appUrl })
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `nexus-welcome-${user.id}` },
      body: JSON.stringify({ from, to: [user.email], ...template }),
    })
    if (!response.ok) {
      const details = await response.text()
      console.error(`Welcome email failed [${response.status}]: ${details}`)
      return json(response.status, { error: 'Email provider rejected welcome mail', status: response.status, details })
    }
    const { error: markerError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, nexus_welcome_sent_at: new Date().toISOString() } })
    if (markerError) return json(503, { error: 'Email accepted; delivery marker could not be saved' })
    return json(200, { sent: true })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Welcome email unavailable' })
  }
})