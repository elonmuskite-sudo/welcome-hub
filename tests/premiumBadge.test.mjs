import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261017020000_premium_member_badges.sql', import.meta.url),
  'utf8',
)
const schema = fs.readFileSync(new URL('../docs/supabase-schema.sql', import.meta.url), 'utf8')
const sources = [migration, schema]

// Extract a single function body (up to its closing `$$;`) using the last
// definition so later migration blocks override earlier ones in the schema doc.
function functionBody(sql, marker) {
  const start = sql.lastIndexOf(`function ${marker}`)
  if (start === -1) return ''
  const end = sql.indexOf('$$;', start)
  return end === -1 ? sql.slice(start) : sql.slice(start, end)
}

test('premium members and the admin audit log are RLS-protected tables', () => {
  for (const sql of sources) {
    assert.match(sql, /create table if not exists public\.premium_members/i)
    assert.match(sql, /create table if not exists public\.admin_audit_log/i)
    assert.match(sql, /alter table public\.premium_members enable row level security/i)
    assert.match(sql, /alter table public\.admin_audit_log enable row level security/i)
    assert.match(sql, /revoke all on public\.premium_members from public, anon/i)
    assert.match(sql, /revoke all on public\.admin_audit_log from public, anon/i)
  }
})

test('only admins can grant or revoke Premium Member status', () => {
  for (const sql of sources) {
    assert.match(
      functionBody(sql, 'private.admin_set_premium_member(_user_id'),
      /has_role\(auth\.uid\(\),\s*'admin'\) then raise exception/,
    )
  }
})

test('email confirmation never grants a verification badge', () => {
  for (const sql of sources) {
    const body = functionBody(sql, 'private.get_verification_badge(_user_id')
    assert.doesNotMatch(body, /email_confirmed_at/)
    assert.match(body, /premium_members/)
    assert.match(body, /'premium'/)
    assert.match(body, /'none'/)
  }
})

test('badge assignments are traceable to an admin action in the audit log', () => {
  for (const sql of sources) {
    assert.match(sql, /insert into public\.admin_audit_log/i)
    assert.match(sql, /'premium_member\.granted'/)
    assert.match(sql, /'premium_member\.revoked'/)
    assert.match(sql, /'kyc\.approved'/)
    assert.match(sql, /'kyc\.rejected'/)
  }
})

test('directories resolve badges without an automatic fallback level', () => {
  for (const sql of sources) {
    assert.match(sql, /create or replace function private\.get_verification_badges\(_member_ids text\[\]\)/i)
    assert.match(sql, /create or replace function public\.get_verification_badges\(_member_ids text\[\]\)/i)
  }
})
