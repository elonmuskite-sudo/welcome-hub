import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { inspectSupabaseSchema, verifySupabaseApiCredentials } from '../scripts/lib/supabase-schema.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('schema dry-run validates checked-in versioned migrations without connecting', () => {
  const result = inspectSupabaseSchema({
    databaseUrl: 'postgresql://test:test@db.example.invalid:5432/postgres',
    root,
  })

  assert.equal(result.migrationDir, path.join(root, 'supabase', 'migrations'))
  assert.ok(result.migrations.length >= 2)
  assert.ok(result.migrations[0].bytes > 0)
  assert.match(result.migrations[0].checksum, /^[a-f0-9]{64}$/)
  // Every checked-in migration loads, including the Supabase CLI UUID names.
  for (const migration of result.migrations) {
    assert.ok(migration.bytes > 0, `${migration.file} should not be empty`)
    assert.match(migration.checksum, /^[a-f0-9]{64}$/)
  }
  assert.ok(
    result.migrations.some((migration) => /^20261012012428_[0-9a-f-]+\.sql$/.test(migration.file)),
    'expected the Supabase CLI UUID-named migration to load',
  )
})

test('self-service admin claim is removed from the canonical schema and existing databases', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(root, 'src', 'pages', 'SettingsPage.jsx'), 'utf8')
  const migrationsDir = path.join(root, 'supabase', 'migrations')
  const removalMigration = fs.readdirSync(migrationsDir)
    .find((file) => file.endsWith('_remove_self_service_admin_claim.sql'))

  assert.ok(removalMigration, 'expected a forward migration to remove the self-service admin claim')
  assert.doesNotMatch(schema, /(?:create|grant execute on) function public\.claim_first_admin/i)
  assert.doesNotMatch(settingsPage, /ClaimAdminCard|claim_first_admin/)

  const migration = fs.readFileSync(path.join(migrationsDir, removalMigration), 'utf8')
  assert.match(migration, /drop function if exists public\.claim_first_admin\(\)/i)
  assert.match(migration, /drop function if exists private\.claim_first_admin\(\)/i)
})

test('Appwrite identity links remain inaccessible to browser roles', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261013232516_appwrite_identity_links.sql'),
    'utf8',
  )
  for (const sql of [schema, migration]) {
    assert.match(sql, /create table public\.appwrite_identity_links/i)
    assert.match(sql, /enable row level security/i)
    assert.match(sql, /revoke all on public\.appwrite_identity_links from public, anon, authenticated/i)
    assert.match(sql, /grant all on public\.appwrite_identity_links to service_role/i)
  }
})

test('text messages require a versioned encrypted payload in every database write', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261021000131_enforce_encrypted_text_messages.sql'),
    'utf8',
  )
  for (const sql of [schema, migration]) {
    assert.match(sql, /messages_text_requires_encryption/i)
    assert.match(sql, /type in \('reaction', 'receipt', 'image', 'video', 'voice', 'file', 'document'\) or \(/i)
    assert.match(sql, /encrypted is true/i)
    assert.match(sql, /ECDH-P256\+AES-256-GCM/i)
    assert.match(sql, /\(content::jsonb - 'alg' - 'iv' - 'data'\) = '\{\}'::jsonb/i)
    assert.match(sql, /->> 'iv'/i)
    assert.match(sql, /->> 'data'/i)
  }
  assert.match(migration, /not valid/i)
})

test('chat file storage is restricted to the uploader or chat members', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261027133018_secure_chat_file_access.sql'),
    'utf8',
  )
  for (const sql of [schema, migration]) {
    assert.match(sql, /drop policy if exists "Chat files signed-in read" on storage\.objects/i)
    assert.match(sql, /create policy "Chat members read chat files"/i)
    assert.match(sql, /public\.is_chat_member/i)
    assert.match(sql, /\(select auth\.uid\(\)\)/i)
    assert.match(sql, /storage\.foldername\(name\)\)\[2\].*~\*/i)
    assert.doesNotMatch(sql, /create policy "Chat files signed-in read"/i)
  }
  assert.match(migration, /_user = \(select auth\.uid\(\)\)/i)
})

test('schema dry-run rejects non-PostgreSQL URLs', () => {
  assert.throws(
    () => inspectSupabaseSchema({ databaseUrl: 'https://example.invalid/database', root }),
    /postgres:\/\/ or postgresql:\/\//,
  )
})

test('schema dry-run requires a database URL', () => {
  assert.throws(
    () => inspectSupabaseSchema({ databaseUrl: '', root }),
    /SUPABASE_DB_URL is required/,
  )
})

test('build environment validation does not execute schema migrations', () => {
  const validator = fs.readFileSync(path.join(root, 'scripts', 'validate-production-env.js'), 'utf8')
  assert.doesNotMatch(validator, /applySupabase|syncAppwriteSchema|verifyAppwriteSetup/)
})

test('API preflight checks anon and service-role credentials without exposing them', async () => {
  const requests = []
  const result = await verifySupabaseApiCredentials({
    supabaseUrl: 'https://project.example.supabase.co',
    anonKey: 'public-anon-test-key',
    serviceRoleKey: 'private-service-test-key',
    fetchImpl: async (url, options) => {
      requests.push({ url, key: options.headers.apikey })
      return { ok: true, status: 200 }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.checks.map((check) => check.name), ['Supabase anon key', 'Supabase service-role key'])
  assert.match(requests[0].url, /\/auth\/v1\/settings$/)
  assert.match(requests[1].url, /\/auth\/v1\/admin\/users/)
  assert.equal(requests[0].key, 'public-anon-test-key')
  assert.equal(requests[1].key, 'private-service-test-key')
})

test('API preflight rejects a bad service-role key without echoing it', async () => {
  await assert.rejects(
    verifySupabaseApiCredentials({
      supabaseUrl: 'https://project.example.supabase.co',
      anonKey: 'public-anon-test-key',
      serviceRoleKey: 'private-service-test-key',
      fetchImpl: async (_url, options) => options.headers.apikey === 'private-service-test-key'
        ? { ok: false, status: 401 }
        : { ok: true, status: 200 },
    }),
    (error) => error.message.includes('HTTP 401') && !error.message.includes('private-service-test-key'),
  )
})
