// Logical backup of the linked Supabase database, run before schema migrations.
//
// The schema itself is version-controlled in docs/supabase-schema.sql, so this
// script captures the DATA: every row of every `public` table is exported as a
// portable INSERT that replays through jsonb_populate_record, which preserves
// column types (uuid, jsonb, timestamptz, numeric, arrays, bytea, ...).
//
// Usage:  node scripts/backup-supabase.js
// Needs:  SUPABASE_DB_URL in .env.local (gitignored) or the environment.
// Output: supabase/backups/<timestamp>_public_data.sql

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'supabase', 'backups')

function resolveDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  for (const file of ['.env.local', '.env']) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+?)\s*$/)
      if (match) return match[1].replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('SUPABASE_DB_URL is required. Add it to .env.local (gitignored) and retry.')
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`

async function main() {
  const url = resolveDbUrl()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const outFile = path.join(OUT_DIR, `${stamp}_public_data.sql`)

  const client = new Client({ connectionString: url, application_name: 'nexus-backup' })
  await client.connect()
  try {
    const { rows: tables } = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `)

    const lines = [
      '-- Nexus logical backup: public schema data',
      `-- generated: ${new Date().toISOString()}`,
      '-- restore:  psql "$SUPABASE_DB_URL" -f <this file>',
      '-- (session_replication_role disables FK checks so insert order is irrelevant)',
      'set session_replication_role = replica;',
      'begin;',
      '',
    ]
    const manifest = []
    const skipped = []

    for (const { table_name } of tables) {
      const ident = quoteIdent(table_name)
      let count
      try {
        const { rows } = await client.query(`select count(*)::int as count from public.${ident}`)
        count = rows[0].count
      } catch (error) {
        skipped.push(`${table_name} (count failed: ${error.message})`)
        continue
      }
      if (count === 0) {
        manifest.push({ table: table_name, rows: 0 })
        continue
      }
      try {
        const { rows } = await client.query(
          `select format('insert into %I.%I select * from jsonb_populate_record(null::%I.%I, %L);',
                         'public', $1, 'public', $1, to_jsonb(t)) as stmt
           from public.${ident} t`,
          [table_name],
        )
        lines.push(`-- ${table_name} (${count} rows)`)
        for (const row of rows) lines.push(row.stmt)
        lines.push('')
        manifest.push({ table: table_name, rows: count })
      } catch (error) {
        skipped.push(`${table_name} (dump failed: ${error.message})`)
      }
    }

    lines.push('commit;', 'set session_replication_role = origin;', '')
    const sql = lines.join('\n')
    fs.writeFileSync(outFile, sql)
    const checksum = createHash('sha256').update(sql).digest('hex')

    console.log(`Backup written: ${path.relative(ROOT, outFile)}`)
    console.log(`Tables: ${manifest.length} | total rows: ${manifest.reduce((sum, m) => sum + m.rows, 0)}`)
    console.log(`SHA-256: ${checksum}`)
    if (skipped.length) console.warn(`SKIPPED: ${skipped.join('; ')}`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message}`)
  process.exitCode = 1
})
