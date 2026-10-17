import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REQUIRED_TABLES = [
  'public.members',
  'public.profiles',
  'public.chats',
  'public.chat_members',
  'public.messages',
  'public.auth_email_code_rate_limits',
]
const REQUIRED_FUNCTIONS = [
  'public.current_member_profile_id()',
  'public.current_member_is_admin()',
  'public.consume_auth_email_code_limit(text,integer,integer)',
  'public.lookup_member_by_nexus_id(text)',
]
const MIGRATION_TABLE = 'public.nexus_schema_migrations'

function normalizeSupabaseUrl(supabaseUrl) {
  if (!supabaseUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.')
  let parsed
  try {
    parsed = new URL(supabaseUrl)
  } catch {
    throw new Error('Supabase URL must be a valid HTTPS URL.')
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Supabase URL must use HTTPS.')
  }
  return parsed.origin
}

export async function verifySupabaseApiCredentials({ supabaseUrl, anonKey, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl)
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY is required.')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.')
  if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required to validate Supabase credentials.')

  const check = async (name, route, key) => {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      })
    } catch {
      throw new Error(`Supabase ${name} credential check could not reach the configured project.`)
    }
    if (!response.ok) {
      throw new Error(`Supabase ${name} credential check failed (HTTP ${response.status}). Verify the key and project URL.`)
    }
    return { name: `Supabase ${name} key`, pass: true }
  }

  const checks = [
    await check('anon', '/auth/v1/settings', anonKey),
    await check('service-role', '/auth/v1/admin/users?page=1&per_page=1', serviceRoleKey),
  ]
  return { ok: true, checks }
}

function normalizeDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required to provision or verify the Supabase schema.')
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SUPABASE_DB_URL must use the postgres:// or postgresql:// scheme.')
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && !parsed.searchParams.has('sslmode')) {
    parsed.searchParams.set('sslmode', 'require')
  }
  return parsed.toString()
}

function loadMigrations(root) {
  const migrationDir = path.join(root, 'supabase', 'migrations')
  if (!fs.existsSync(migrationDir)) throw new Error('Supabase migrations directory was not found.')

  const files = fs.readdirSync(migrationDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  if (!files.length) throw new Error('No versioned Supabase SQL migrations were found.')

  return files.map((file) => {
    // Supabase CLI also emits UUID names (20261012012428_a2ec3535-....sql), so the
    // name segment may contain hyphens. Renaming those would rewrite applied history.
    const match = file.match(/^(\d{14})_([a-z0-9_-]+)\.sql$/)
    if (!match) throw new Error(`Invalid migration filename: ${file}. Expected YYYYMMDDHHMMSS_name.sql.`)
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8').trim()
    if (!sql) throw new Error(`Migration ${file} is empty.`)
    return {
      version: match[1],
      name: match[2],
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  })
}

function createPool(databaseUrl) {
  return new Pool({
    connectionString: normalizeDatabaseUrl(databaseUrl),
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 1000,
    application_name: 'nexus-chat-schema-provisioner',
  })
}

async function collectSchemaChecks(client) {
  const checks = []
  for (const table of REQUIRED_TABLES) {
    const { rows } = await client.query('select to_regclass($1) as object_name', [table])
    checks.push({ name: `table ${table}`, pass: Boolean(rows[0]?.object_name) })
  }
  for (const signature of REQUIRED_FUNCTIONS) {
    const { rows } = await client.query('select to_regprocedure($1) as object_name', [signature])
    checks.push({ name: `function ${signature}`, pass: Boolean(rows[0]?.object_name) })
  }
  const { rows: triggers } = await client.query(`
    select trigger_name
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name in ('on_auth_user_created_nexus_member', 'on_auth_user_updated_nexus_email')
  `)
  const triggerNames = new Set(triggers.map((row) => row.trigger_name))
  for (const name of ['on_auth_user_created_nexus_member', 'on_auth_user_updated_nexus_email']) {
    checks.push({ name: `trigger ${name}`, pass: triggerNames.has(name) })
  }
  return { ok: checks.every((check) => check.pass), checks }
}

export function inspectSupabaseSchema({ databaseUrl, root = DEFAULT_ROOT }) {
  normalizeDatabaseUrl(databaseUrl)
  const migrations = loadMigrations(root)
  return {
    migrationDir: path.join(root, 'supabase', 'migrations'),
    migrations: migrations.map(({ version, name, file, checksum, sql }) => ({
      version,
      name,
      file,
      checksum,
      bytes: Buffer.byteLength(sql),
    })),
  }
}

export async function applySupabaseMigrations({ databaseUrl, root = DEFAULT_ROOT }) {
  const migrations = loadMigrations(root)
  const pool = createPool(databaseUrl)
  let client
  try {
    client = await pool.connect()
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('nexus-chat-supabase-migrations'))")
    await client.query(`
      create table if not exists ${MIGRATION_TABLE} (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `)
    await client.query(`alter table ${MIGRATION_TABLE} enable row level security`)
    await client.query(`revoke all on ${MIGRATION_TABLE} from public, anon, authenticated`)

    const { rows: appliedRows } = await client.query(
      `select version, checksum from ${MIGRATION_TABLE} order by version`
    )
    const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row.checksum]))
    const newlyApplied = []

    for (const migration of migrations) {
      const existingChecksum = appliedByVersion.get(migration.version)
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.file} was modified. Add a new migration instead of editing it.`)
        }
        continue
      }

      await client.query(migration.sql)
      await client.query(
        `insert into ${MIGRATION_TABLE} (version, name, checksum) values ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      )
      newlyApplied.push(migration.file)
    }

    const verification = await collectSchemaChecks(client)
    if (!verification.ok) {
      const missing = verification.checks.filter((check) => !check.pass).map((check) => check.name)
      throw new Error(`Supabase schema migration verification failed: ${missing.join(', ')}`)
    }
    await client.query('commit')
    return { ...verification, applied: newlyApplied }
  } catch (error) {
    if (client) {
      try { await client.query('rollback') } catch { /* retain original error */ }
    }
    throw error
  } finally {
    client?.release()
    await pool.end()
  }
}

export async function verifySupabaseSchema({ databaseUrl, root = DEFAULT_ROOT }) {
  const migrations = loadMigrations(root)
  const pool = createPool(databaseUrl)
  try {
    const client = await pool.connect()
    try {
      const verification = await collectSchemaChecks(client)
      const { rows: migrationTable } = await client.query('select to_regclass($1) as object_name', [MIGRATION_TABLE])
      const migrationsTableExists = Boolean(migrationTable[0]?.object_name)
      verification.checks.push({ name: 'migration history table', pass: migrationsTableExists })
      if (migrationsTableExists) {
        const { rows } = await client.query(`select version, name from ${MIGRATION_TABLE} order by version`)
        verification.appliedMigrations = rows
        const applied = new Map(rows.map((row) => [row.version, row]))
        for (const migration of migrations) {
          const row = applied.get(migration.version)
          verification.checks.push({ name: `migration ${migration.file} applied`, pass: Boolean(row) })
          if (row) {
            const { rows: checksumRows } = await client.query(
              `select checksum from ${MIGRATION_TABLE} where version = $1`,
              [migration.version]
            )
            verification.checks.push({
              name: `migration ${migration.file} checksum`,
              pass: checksumRows[0]?.checksum === migration.checksum,
            })
          }
        }
        const knownVersions = new Set(migrations.map((migration) => migration.version))
        for (const row of rows) {
          if (!knownVersions.has(row.version)) {
            verification.checks.push({ name: `migration ${row.version}_${row.name} exists in source`, pass: false })
          }
        }
      } else {
        verification.appliedMigrations = []
      }
      verification.ok = verification.checks.every((check) => check.pass)
      return verification
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}
