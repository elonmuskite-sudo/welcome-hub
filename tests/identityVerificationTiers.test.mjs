import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261017030000_identity_verification_tiers.sql', import.meta.url),
  'utf8',
)
const schema = fs.readFileSync(new URL('../docs/supabase-schema.sql', import.meta.url), 'utf8')

// Extract the last definition of a function body (later blocks override earlier).
function functionBody(sql, marker) {
  const start = sql.lastIndexOf(`function ${marker}`)
  if (start === -1) return ''
  const end = sql.indexOf('$$;', start)
  return end === -1 ? sql.slice(start) : sql.slice(start, end)
}

test('the canonical schema mirrors the identity verification tiers migration', () => {
  assert.match(schema, /-- 20261017030000_identity_verification_tiers\.sql/)
  assert.match(schema, /submit_instant_identity_verification\(_selfie_path text, _match_score numeric/)
})

test('identity verification carries the structured manual-submission fields', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /add column if not exists tier text/)
    assert.match(sql, /add column if not exists full_legal_name text/)
    assert.match(sql, /add column if not exists date_of_birth date/)
    assert.match(sql, /add column if not exists document_type text/)
    assert.match(sql, /add column if not exists document_number text/)
    assert.match(sql, /add column if not exists issuing_country text/)
    assert.match(sql, /id_document_path drop not null/)
    assert.match(sql, /check \(tier in \('instant', 'manual'\)\)/)
  }
})

test('instant verification is a security-definer RPC that only approves the caller', () => {
  for (const sql of [migration, schema]) {
    const body = functionBody(sql, 'public.submit_instant_identity_verification(_selfie_path')
    assert.match(body, /security definer/)
    assert.match(body, /auth\.uid\(\)/)
    assert.match(body, /insert into public\.identity_verifications \(user_id, status, tier, match_score, selfie_path, id_document_path, reviewed_at\)/)
    assert.match(body, /'approved', 'instant'/)
    // The caller cannot target another member: there is no user-id parameter.
    assert.doesNotMatch(body, /_user_id/)
  }
})

test('instant verification cannot be called by anonymous users', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /revoke execute on function public\.submit_instant_identity_verification\(text, numeric\) from public, anon/)
    assert.match(sql, /grant execute on function public\.submit_instant_identity_verification\(text, numeric\) to authenticated, service_role/)
  }
})

test('both identity tiers resolve to the same approved badge level', () => {
  const badge = functionBody(schema, 'private.get_verification_badge(_user_id')
  // The badge is decided by approval status only, so instant and manual rows
  // both surface 'authenticated'; the tier is not used to vary the badge.
  assert.match(badge, /identity_verifications where user_id = _user_id and status = 'approved'/)
  assert.doesNotMatch(badge, /tier/)
})
