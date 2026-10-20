#!/usr/bin/env node
/**
 * Create (or refresh) the two pre-verified demo accounts used for store review.
 *
 * Store reviewers cannot receive the sign-up email code, so the accounts are
 * created with `email_confirm: true` through the Supabase Admin API. Creating a
 * user fires the `on_auth_user_created` trigger, which inserts the matching
 * `public.members` row (with `email_verified = true` and the post-migration
 * `e2ee_enabled = true` default).
 *
 * Passwords are generated here and written ONLY to `.demo-accounts.local.json`
 * (gitignored). They are never printed. Copy them into the store console review
 * forms and into your password manager.
 *
 * Usage: node scripts/create-demo-accounts.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT_FILE = `${ROOT}.demo-accounts.local.json`

function loadEnv() {
  const env = {}
  for (const file of ['.env', '.env.local']) {
    const path = `${ROOT}${file}`
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
  return { ...env, ...process.env }
}

const env = loadEnv()
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY
const DB_URL = env.SUPABASE_DB_URL

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env, .env.local).')
  process.exit(1)
}

const ACCOUNTS = [
  { email: 'demo1@nexus-chat-world.com', firstName: 'Demo', lastName: 'Reviewer One', memberId: '1000000001' },
  { email: 'demo2@nexus-chat-world.com', firstName: 'Demo', lastName: 'Reviewer Two', memberId: '1000000002' },
]

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
}

function newPassword() {
  // The project's auth policy requires lower, upper, digit and symbol classes.
  // Build from unambiguous characters, guarantee one of each, then shuffle.
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%^&*-_=+'
  const all = lower + upper + digits + symbols
  const pick = (set) => set[randomInt(set.length)]

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)]
  while (chars.length < 24) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

async function findUserByEmail(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers })
  if (!response.ok) throw new Error(`list users failed: ${response.status} ${await response.text()}`)
  const body = await response.json()
  const users = body.users || []
  return users.find((user) => (user.email || '').toLowerCase() === email.toLowerCase()) || null
}

async function createUser(account, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: account.firstName,
        last_name: account.lastName,
        member_id: account.memberId,
      },
    }),
  })
  if (response.ok) return { user: await response.json(), created: true }

  const text = await response.text()
  if (response.status === 422 && /already/i.test(text)) {
    const existing = await findUserByEmail(account.email)
    if (!existing) throw new Error(`user exists but could not be found: ${text}`)
    return { user: existing, created: false }
  }
  throw new Error(`create user failed: ${response.status} ${text}`)
}

async function settleUser(user, password) {
  // Re-assert confirmation and rotate the password so the stored credentials
  // always match what is written out.
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password, email_confirm: true }),
  })
  if (!response.ok) throw new Error(`update user failed: ${response.status} ${await response.text()}`)
  return response.json()
}

const results = []

for (const account of ACCOUNTS) {
  const password = newPassword()
  const { user, created } = await createUser(account, password)
  const settled = await settleUser(user, password)
  results.push({
    email: account.email,
    password,
    firstName: account.firstName,
    lastName: account.lastName,
    nexusId: account.memberId,
    userId: settled.id,
    emailConfirmed: Boolean(settled.email_confirmed_at),
    action: created ? 'created' : 'refreshed',
  })
  console.log(`${account.email.padEnd(34)} ${created ? 'created' : 'refreshed'}  id=${settled.id}  confirmed=${Boolean(settled.email_confirmed_at)}`)
}

writeFileSync(
  OUT_FILE,
  `${JSON.stringify(
    {
      note: 'Store-review demo accounts. Gitignored. Copy the passwords into your password manager and into the store console review forms.',
      project: SUPABASE_URL,
      createdAt: new Date().toISOString(),
      accounts: results,
    },
    null,
    2,
  )}\n`,
)
console.log(`\nCredentials written to .demo-accounts.local.json (gitignored, passwords not printed).`)

if (DB_URL) {
  // The Supabase pooler presents a chain pg does not trust, and an `sslmode`
  // parameter in the URL overrides the explicit ssl object. Strip it and pin
  // rejectUnauthorized explicitly instead.
  const parsed = new URL(DB_URL)
  parsed.searchParams.delete('sslmode')
  const client = new pg.Client({
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select m.member_id, m.email, m.email_verified, m.full_name, m.e2ee_enabled, m.e2ee_key_published_at
         from public.members m
        where m.email = any($1)
        order by m.member_id`,
      [ACCOUNTS.map((a) => a.email)],
    )
    console.log('\nDatabase verification (public.members):')
    for (const row of rows) {
      console.log(
        `  ${row.member_id}  ${row.email}  verified=${row.email_verified}  e2ee=${row.e2ee_enabled}  name="${row.full_name}"`,
      )
    }
    const missing = ACCOUNTS.filter((a) => !rows.some((r) => r.email === a.email))
    if (missing.length) console.log(`  WARNING: no members row for ${missing.map((m) => m.email).join(', ')}`)
  } finally {
    await client.end()
  }
} else {
  console.log('\nSUPABASE_DB_URL not set; skipped the public.members verification query.')
}

// Prove the credentials a reviewer will type actually authenticate, using the
// same password grant the app uses (anon key, not the service role).
const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (anonKey) {
  console.log('\nSign-in verification (password grant as the app performs it):')
  for (const account of results) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    })
    const body = await response.json().catch(() => ({}))
    const ok = response.ok && Boolean(body.access_token)
    console.log(`  ${account.email.padEnd(34)} ${ok ? 'SIGN-IN OK' : `FAILED (${response.status})`}`)
  }
} else {
  console.log('\nNo anon key found; skipped the sign-in verification.')
}
