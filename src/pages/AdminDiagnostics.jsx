import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, LoaderCircle, RefreshCw, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { appwriteData, isAppwriteAuthEnabled } from '../lib/appwrite'

const BROWSER_CHECKS = [
  { service: 'Supabase', key: 'VITE_SUPABASE_URL', configured: Boolean(import.meta.env.VITE_SUPABASE_URL) },
  { service: 'Supabase', key: 'VITE_SUPABASE_ANON_KEY', configured: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) },
  { service: 'Appwrite', key: 'VITE_APPWRITE_ENDPOINT', configured: Boolean(import.meta.env.VITE_APPWRITE_ENDPOINT) },
  { service: 'Appwrite', key: 'VITE_APPWRITE_PROJECT_ID', configured: Boolean(import.meta.env.VITE_APPWRITE_PROJECT_ID) },
]

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function loadVercel() {
  try {
    const res = await fetch('/api/admin/diagnostics', { headers: await authHeader() })
    const body = await res.json().catch(() => null)
    if (!body) return { error: 'Vercel server functions are not reachable from this site (this is expected in local preview).' }
    return body
  } catch {
    return { error: 'Vercel server functions are not reachable from this site.' }
  }
}

async function loadFunctions() {
  const { data, error } = await supabase.functions.invoke('config-diagnostics')
  if (error) {
    const details = await error.context?.json?.().catch(() => null)
    return { error: details?.error || 'Supabase Edge Functions are not deployed or not reachable.' }
  }
  return data
}

function Row({ item }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {item.configured ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <XCircle className="w-4 h-4 text-destructive" />}
      <span className="w-28 text-sm text-muted-foreground">{item.service}</span>
      <code className="flex-1 text-sm text-foreground">{item.key}</code>
      <span className={`text-xs font-medium ${item.configured ? 'text-primary' : 'text-destructive'}`}>{item.configured ? 'Set' : 'Missing'}</span>
    </li>
  )
}

function Panel({ title, where, result }) {
  const missing = (result?.checks || []).filter((c) => !c.configured)
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground mb-3">{where}</p>
      {result?.error && <p className="text-sm text-destructive mb-2">{result.error}</p>}
      {result?.checks && (
        <>
          <ul className="divide-y divide-border">{result.checks.map((c) => <Row key={c.key} item={c} />)}</ul>
          <p className="mt-3 text-sm text-muted-foreground">{missing.length ? `${missing.length} missing: ${missing.map((m) => m.key).join(', ')}` : 'Everything here is set.'}</p>
        </>
      )}
      {result?.tables && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Database tables</p>
          <ul className="flex flex-wrap gap-2">
            {result.tables.map((t) => (
              <li key={t.table} className={`rounded-full px-2.5 py-1 text-xs ${t.ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                {t.table}{t.ok ? '' : ' — missing'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default function AdminDiagnostics() {
  const [vercel, setVercel] = useState(null)
  const [functions, setFunctions] = useState(null)
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    if (isAppwriteAuthEnabled()) {
      try {
        const result = await appwriteData('admin.diagnostics')
        setVercel({ checks: result.checks })
        setFunctions({ tables: result.tables })
      } catch (error) {
        setVercel({ error: error.message || 'The Appwrite diagnostics gateway is unavailable.' })
        setFunctions(null)
      } finally {
        setLoading(false)
      }
      return
    }
    const [v, f] = await Promise.all([loadVercel(), loadFunctions()])
    setVercel(v); setFunctions(f); setLoading(false)
  }, [])

  useEffect(() => { run() }, [run])

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-5">
        <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Admin dashboard</Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configuration diagnostics</h1>
            <p className="text-sm text-muted-foreground">Shows whether each setting exists. Secret values are never shown.</p>
          </div>
          <button onClick={run} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50">
            {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Re-check
          </button>
        </div>
        <Panel title="Website build" where="Vercel → Environment Variables (needed at build time)" result={{ checks: BROWSER_CHECKS }} />
        <Panel title="Vercel server" where={isAppwriteAuthEnabled()
          ? 'Vercel → Environment Variables (used by the Appwrite identity gateway)'
          : 'Vercel → Environment Variables (used for sign-up email codes)'} result={vercel} />
        <Panel title={isAppwriteAuthEnabled() ? 'Database schema' : 'Supabase Edge Functions'}
          where={isAppwriteAuthEnabled()
            ? 'Tables accessible to the authenticated database gateway'
            : 'Supabase → Edge Functions → Secrets (used for emails and support)'} result={functions} />
      </main>
    </div>
  )
}
