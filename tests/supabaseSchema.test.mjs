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

test('identity verification cannot approve from client-side face scores', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261105094049_disable_unverified_identity_auto_approval.sql'),
    'utf8',
  )
  const settings = fs.readFileSync(
    path.join(root, 'src', 'components', 'chat', 'settings', 'VerificationSettings.jsx'),
    'utf8',
  )
  const gateway = fs.readFileSync(path.join(root, 'server', 'appwriteGateway.js'), 'utf8')
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')

  assert.match(migration, /where tier = 'instant'/i)
  assert.match(migration, /set status = 'rejected'/i)
  assert.match(migration, /match_score = null/i)
  assert.match(migration, /check \(tier = 'manual'\)/i)
  assert.match(migration, /drop function if exists public\.submit_instant_identity_verification/i)
  assert.doesNotMatch(settings, /face-api|submitInstant|submit_instant_identity_verification|verification\.instant/i)
  assert.match(settings, /submit for admin review/i)
  assert.doesNotMatch(gateway, /case 'verification\.instant'/i)
  assert.doesNotMatch(gateway, /body\.matchScore/i)
  assert.doesNotMatch(schema, /submit_instant_identity_verification/i)
})

test('Idswyft KYC sessions are user-scoped and session credentials are encrypted server-side', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261106195234_idswyft_kyc_sessions.sql'),
    'utf8',
  )
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'api', 'kyc.js'), 'utf8')
  const provider = fs.readFileSync(path.join(root, 'server', 'idswyftKyc.js'), 'utf8')
  const statusMigration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261108075723_idswyft_kyc_status_details.sql'),
    'utf8',
  )

  for (const sql of [migration, schema]) {
    assert.match(sql, /create table public\.kyc_sessions/i)
    assert.match(sql, /id uuid primary key/i)
    assert.match(sql, /references auth\.users\(id\) on delete cascade/i)
    assert.match(sql, /session_token text not null/i)
    assert.match(sql, /metadata jsonb not null/i)
    assert.match(sql, /enable row level security/i)
    assert.match(sql, /auth\.uid\(\).*user_id|user_id.*auth\.uid\(\)/i)
  }
  assert.match(migration, /create or replace function public\.set_kyc_sessions_updated_at\(\)/i)
  assert.match(migration, /execute function public\.set_kyc_sessions_updated_at\(\)/i)
  assert.match(provider, /createCipheriv\('aes-256-gcm'/)
  assert.match(api, /bodyParser: false/)
  assert.match(api, /validateKycFile/)
  assert.match(api, /multipart\/form-data/)
  assert.doesNotMatch(api, /NEXT_PUBLIC_|VITE_IDSWYFT/)
  assert.match(statusMigration, /add column if not exists current_step/i)
  assert.match(statusMigration, /add column if not exists ocr_data/i)
  assert.match(statusMigration, /add column if not exists liveness_results/i)
  assert.match(statusMigration, /add column if not exists cross_validation_results/i)
})

test('duplicate role-schema migration safely extends existing objects', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261012105742_7f3801e7-d165-4bbd-a733-0f29089dd2ad.sql'),
    'utf8',
  )

  assert.match(migration, /exception\s+when duplicate_object then null/i)
  for (const table of ['user_roles', 'user_storage_quotas', 'storage_purchases', 'identity_verifications', 'storage_files']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'))
  }
  assert.match(migration, /add column if not exists created_at/i)
  assert.match(migration, /add column if not exists reviewed_by/i)
  for (const trigger of ['trg_quota_updated', 'trg_purchases_updated', 'trg_idv_updated']) {
    assert.match(migration, new RegExp(`drop trigger if exists ${trigger}\\b`, 'i'))
  }
})

test('permission migrations tolerate an absent legacy RLS helper', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261012121953_9125f1c9-8652-4c6a-bcba-27b550cc0686.sql'),
    'utf8',
  )

  assert.match(migration, /to_regprocedure\('public\.rls_auto_enable\(\)'\) is not null/i)
  assert.match(migration, /revoke execute on function public\.rls_auto_enable\(\) from public, anon, authenticated/i)
})

test('admin claim migration safely changes its function return type', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261013212555_65da1313-00bc-45ac-ae6a-3fd1ce175d94.sql'),
    'utf8',
  )

  assert.match(migration, /drop function if exists public\.claim_first_admin\(\);\s*create function public\.claim_first_admin\(\) returns void/i)
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
    assert.match(sql, /type in \('reaction', 'receipt', 'image', 'video', 'voice', 'file', 'document'(?:, 'call')?\) or \(/i)
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

test('profile photos are private and visible to owners, contacts, and allowed feed viewers', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261105095000_contact_scoped_profile_photos.sql'),
    'utf8',
  )
  const gateway = fs.readFileSync(path.join(root, 'server', 'appwriteGateway.js'), 'utf8')
  for (const sql of [schema, migration]) {
    assert.match(sql, /public\.can_read_contact_avatar/i)
    assert.match(sql, /m\.avatar_url = 'storage:\/\/' \|\| _path/i)
    assert.match(sql, /m\.id = auth\.uid\(\)/i)
    assert.match(sql, /c\.user_id = auth\.uid\(\)/i)
    assert.match(sql, /p\.author_id = m\.id and p\.status = 'active'/i)
    assert.match(sql, /bu\.blocker_id = auth\.uid\(\) and bu\.blocked_id = m\.id/i)
    assert.match(sql, /create policy "Contacts read active profile photos"/i)
    assert.match(sql, /bucket_id = 'chat-files'/i)
  }
  assert.match(gateway, /m\.id = \$1/i)
  assert.match(gateway, /bu\.blocker_id = \$1 and bu\.blocked_id = m\.id/i)
  assert.match(migration, /revoke execute on function public\.can_read_contact_avatar\(text, text\) from public, anon/i)
})

test('feed events store bounded metadata and require a title and start time', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261105102436_feed_event_metadata.sql'),
    'utf8',
  )
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const feeds = fs.readFileSync(path.join(root, 'src', 'lib', 'feeds.js'), 'utf8')
  const composer = fs.readFileSync(path.join(root, 'src', 'pages', 'FeedsPage.jsx'), 'utf8')
  for (const sql of [migration, schema]) {
    assert.match(sql, /post_type in \('general', 'event'\)/i)
    assert.match(sql, /nullif\(trim\(title\), ''\) is not null and event_starts_at is not null/i)
    assert.match(sql, /char_length\(title\) <= 160/i)
    assert.match(sql, /char_length\(event_location\) <= 240/i)
  }
  assert.match(feeds, /event_starts_at/)
  assert.match(feeds, /Choose a valid event date and time/)
  assert.match(composer, /datetime-local/)
  assert.match(composer, /Event/)
})

test('call push destinations are private to the owning account', () => {
  const schema = fs.readFileSync(path.join(root, 'docs', 'supabase-schema.sql'), 'utf8')
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261027165720_call_push_subscriptions.sql'),
    'utf8',
  )
  for (const sql of [schema, migration]) {
    assert.match(sql, /create table(?: if not exists)? public\.call_push_subscriptions/i)
    assert.match(sql, /enable row level security/i)
    assert.match(sql, /using\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)/i)
    assert.match(sql, /with check\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)/i)
    assert.match(sql, /unique \(platform, endpoint\)/i)
  }
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
