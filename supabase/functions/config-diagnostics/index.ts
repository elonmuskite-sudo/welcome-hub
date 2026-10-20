import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Admin-only: reports which server settings are present. Never returns values or anything derived from them.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const CHECKS = [
  { service: 'Supabase', key: 'SUPABASE_URL' },
  { service: 'Supabase', key: 'SUPABASE_ANON_KEY' },
  { service: 'Supabase', key: 'SUPABASE_SERVICE_ROLE_KEY' },
  { service: 'Resend', key: 'RESEND_API_KEY' },
  { service: 'Resend', key: 'RESEND_FROM' },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json({ error: 'Server is missing its Supabase settings.' }, 503)

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Sign in required.' }, 401)
    const admin = createClient(url, serviceKey)
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Sign in required.' }, 401)
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' })
    if (!isAdmin) return json({ error: 'Admins only.' }, 403)

    const checks = CHECKS.map((c) => ({ ...c, configured: Boolean(Deno.env.get(c.key)?.trim()) }))

    const tables = ['members', 'chats', 'messages', 'identity_verifications']
    const tableChecks = await Promise.all(tables.map(async (table) => {
      const { error: tErr } = await admin.from(table).select('*', { head: true, count: 'exact' }).limit(1)
      return { table, ok: !tErr }
    }))

    return json({ checks, tables: tableChecks, checkedAt: new Date().toISOString() })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
