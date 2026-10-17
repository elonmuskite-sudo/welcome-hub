#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySupabaseMigrations, inspectSupabaseSchema, verifySupabaseApiCredentials, verifySupabaseSchema } from './lib/supabase-schema.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const verifyOnly = args.has('--verify-only')

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

const fileValues = Object.assign(
  {},
  readEnvFile(path.join(root, '.env')),
  readEnvFile(path.join(root, '.env.production')),
  readEnvFile(path.join(root, '.env.local')),
  readEnvFile(path.join(root, '.env.production.local')),
)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  || fileValues.SUPABASE_URL || fileValues.VITE_SUPABASE_URL || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  || fileValues.VITE_SUPABASE_ANON_KEY || fileValues.SUPABASE_ANON_KEY || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileValues.SUPABASE_SERVICE_ROLE_KEY || ''
const databaseUrl = process.env.SUPABASE_DB_URL || fileValues.SUPABASE_DB_URL || ''

try {
  // The API credential probe needs both keys. When neither is configured (as on
  // this workspace, which only stores SUPABASE_DB_URL), skip it and let the
  // schema verification below run against the database directly instead of
  // failing the whole command on a check the caller did not ask for.
  if (anonKey && serviceRoleKey) {
    const credentialCheck = await verifySupabaseApiCredentials({
      supabaseUrl,
      anonKey,
      serviceRoleKey,
    })
    for (const check of credentialCheck.checks) console.log(`[supabase-auth] ${check.name}: ready`)
  } else {
    console.log('[supabase-auth] skipped: SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are not configured.')
  }

  if (dryRun) {
    const preview = inspectSupabaseSchema({ databaseUrl, root })
    console.log(`[supabase-migrations] Dry run passed: ${preview.migrations.length} checked-in migration(s); no database changes made.`)
    for (const migration of preview.migrations) {
      console.log(`  ${migration.file} (${migration.bytes} bytes, sha256:${migration.checksum})`)
    }
  } else if (verifyOnly) {
    const verification = await verifySupabaseSchema({ databaseUrl, root })
    for (const check of verification.checks) {
      console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`)
    }
    for (const migration of verification.appliedMigrations || []) {
      console.log(`APPLIED  ${migration.version}_${migration.name}`)
    }
    if (!verification.ok) process.exitCode = 4
  } else {
    const result = await applySupabaseMigrations({ databaseUrl, root })
    for (const migration of result.applied) console.log(`APPLIED  ${migration}`)
    console.log(`[supabase-migrations] Complete: ${result.applied.length} new migration(s); ${result.checks.length} schema checks passed.`)
  }
} catch (error) {
  const safeMessage = databaseUrl ? String(error?.message || error).replaceAll(databaseUrl, '[SUPABASE_DB_URL]') : String(error?.message || error)
  console.error(`[supabase-schema] ${safeMessage}`)
  process.exitCode = 1
}
