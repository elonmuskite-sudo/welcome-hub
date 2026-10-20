// TEMPORARY one-off: post-migration object verification for the applied set.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  for (const file of ['.env.local', '.env']) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('SUPABASE_DB_URL is required.')
}

function clientConfig(url) {
  const parsed = new URL(url)
  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  parsed.searchParams.delete('sslmode')
  const config = { connectionString: parsed.toString(), application_name: 'nexus-migration-verify' }
  if (!isLocal) config.ssl = { rejectUnauthorized: sslmode === 'verify-full' }
  return config
}

const client = new Client(clientConfig(resolveDbUrl()))
await client.connect()
const results = []
const check = (name, pass, extra = '') => results.push({ name, pass: Boolean(pass), extra })

try {
  const q = async (sql, params) => (await client.query(sql, params)).rows

  for (const table of ['public.content_reports', 'public.blocked_users']) {
    const [row] = await q('select to_regclass($1) as o', [table])
    check(`table ${table} exists`, row.o)
  }
  for (const table of ['public.storage_purchases', 'public.user_storage_quotas', 'public.payment_settings', 'public.payment_webhook_events']) {
    const [row] = await q('select to_regclass($1) as o', [table])
    check(`retired ${table} dropped`, !row.o)
  }
  for (const fn of ['public.submit_usdt_payment(text,text)', 'public.review_usdt_payment(uuid,boolean)', 'private.submit_usdt_payment(text,text)']) {
    const [row] = await q('select to_regprocedure($1) as o', [fn])
    check(`retired function ${fn} dropped`, !row.o)
  }
  const [seq] = await q("select to_regclass('public.invoice_number_seq') as o")
  check('retired sequence invoice_number_seq dropped', !seq.o)

  const rls = await q(`
    select relname, relrowsecurity from pg_class
    where relname in ('content_reports','blocked_users') and relnamespace = 'public'::regnamespace`)
  for (const row of rls) check(`RLS enabled on ${row.relname}`, row.relrowsecurity)

  const pol = await q(`select tablename, count(*)::int as n from pg_policies
     where schemaname='public' and tablename in ('content_reports','blocked_users') group by tablename`)
  const polMap = new Map(pol.map((r) => [r.tablename, r.n]))
  check('content_reports has 3 policies', polMap.get('content_reports') === 3, `got ${polMap.get('content_reports')}`)
  check('blocked_users has 3 policies', polMap.get('blocked_users') === 3, `got ${polMap.get('blocked_users')}`)

  const [e2ee] = await q(`select column_default from information_schema.columns
     where table_schema='public' and table_name='members' and column_name='e2ee_enabled'`)
  check('members.e2ee_enabled default is true', /true/i.test(e2ee?.column_default || ''), e2ee?.column_default)

  const [fnE2EE] = await q("select to_regprocedure('public.set_my_e2ee_status(boolean,boolean)') as o")
  check('set_my_e2ee_status exists', fnE2EE.o)

  const [fnProfiles] = await q("select to_regprocedure('public.list_member_profiles(uuid[])') as o")
  check('list_member_profiles exists', fnProfiles.o)
  if (fnProfiles.o) {
    const [grant] = await q(`select has_function_privilege('authenticated', 'public.list_member_profiles(uuid[])', 'execute') as ok`)
    check('authenticated may execute list_member_profiles', grant.ok)
    const [anonGrant] = await q(`select has_function_privilege('anon', 'public.list_member_profiles(uuid[])', 'execute') as ok`)
    check('anon may not execute list_member_profiles', !anonGrant.ok)
  }

  const [rows] = await q("select count(*)::int as n from supabase_migrations.schema_migrations")
  check('migration history present', rows.n > 0, `${rows.n} versions`)
  const applied = await q("select version from supabase_migrations.schema_migrations where version >= '20261017080000' order by version")
  check('3 new versions recorded', applied.length >= 3, applied.map((r) => r.version).join(', '))

  const [cr] = await q('select count(*)::int as n from public.content_reports')
  check('content_reports readable (0 rows expected)', cr.n === 0, `${cr.n} rows`)
} finally {
  await client.end()
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? `  [${r.extra}]` : ''}`)
if (results.some((r) => !r.pass)) process.exitCode = 1
