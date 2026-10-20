// TEMPORARY one-off: applies only the new, unapplied migrations to the linked
// Supabase project inside a single transaction, recording each version in
// supabase_migrations.schema_migrations (the Supabase CLI history table).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PENDING = [
  '20261017080000_e2ee_default_enabled.sql',
  '20261020090000_remove_payments_and_storage_upgrades.sql',
  '20261020100000_content_reports_and_blocks.sql',
  '20261020110000_member_profile_directory_rpc.sql',
]

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
  throw new Error('SUPABASE_DB_URL is required (add it to .env.local).')
}

function clientConfig(url) {
  const parsed = new URL(url)
  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  parsed.searchParams.delete('sslmode')
  const config = { connectionString: parsed.toString(), application_name: 'nexus-pending-migrations' }
  if (!isLocal) config.ssl = { rejectUnauthorized: sslmode === 'verify-full' }
  return config
}

const client = new Client(clientConfig(resolveDbUrl()))
await client.connect()
try {
  await client.query('begin')
  await client.query("select pg_advisory_xact_lock(hashtext('nexus-chat-supabase-migrations'))")
  for (const file of PENDING) {
    const version = file.slice(0, 14)
    const name = file.slice(15).replace(/\.sql$/, '')
    const { rows } = await client.query(
      'select 1 from supabase_migrations.schema_migrations where version = $1',
      [version]
    )
    if (rows.length) { console.log(`SKIP     ${file} (already applied)`); continue }
    const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8')
    await client.query(sql)
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
      [version, name]
    )
    console.log(`APPLIED  ${file}`)
  }
  await client.query('commit')
  console.log('Committed.')
} catch (error) {
  await client.query('rollback').catch(() => {})
  throw error
} finally {
  await client.end()
}
