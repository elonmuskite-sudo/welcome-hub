import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const tiersMigration = fs.readFileSync(
  new URL('../supabase/migrations/20261017030000_identity_verification_tiers.sql', import.meta.url),
  'utf8',
)
const kycGateMigration = fs.readFileSync(
  new URL('../supabase/migrations/20261108090000_gate_instant_kyc_approval.sql', import.meta.url),
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

test('identity verification carries the structured manual-submission fields', () => {
  for (const sql of [tiersMigration, schema]) {
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

test('the canonical schema retires the forgeable client self-approval RPC', () => {
  // The forward migration removes the browser-callable instant self-approval and
  // the canonical schema reflects that final state.
  assert.match(kycGateMigration, /drop function if exists public\.submit_instant_identity_verification\(text, numeric\)/)
  assert.doesNotMatch(schema, /submit_instant_identity_verification/)
})

test('instant approval is a security-definer function granted only to the server role', () => {
  for (const sql of [kycGateMigration, schema]) {
    const body = functionBody(sql, 'public.approve_identity_from_kyc(_session_id')
    assert.match(body, /security definer/)
    // The approval is keyed to a server-verified approved session, not a client score.
    assert.match(body, /from public\.kyc_sessions/)
    assert.match(body, /status = 'APPROVED'/)
    assert.match(body, /'approved', 'instant'/)

    assert.match(sql, /revoke execute on function public\.approve_identity_from_kyc\(uuid\) from public, anon, authenticated/)
    assert.match(sql, /grant execute on function public\.approve_identity_from_kyc\(uuid\) to service_role/)
  }
  // No browser role may ever execute the approval function.
  assert.doesNotMatch(kycGateMigration, /approve_identity_from_kyc\(uuid\) to [^;]*authenticated/)
  assert.doesNotMatch(schema, /approve_identity_from_kyc\(uuid\) to [^;]*authenticated/)
})

test('the instant tier no longer stores a local selfie, so the column is optional', () => {
  assert.match(kycGateMigration, /alter column selfie_path drop not null/)
  assert.match(schema, /selfie_path text, id_document_path text/)
})

test('both identity tiers resolve to the same approved badge level', () => {
  const badge = functionBody(schema, 'private.get_verification_badge(_user_id')
  // The badge is decided by approval status only, so instant and manual rows
  // both surface 'authenticated'; the tier is not used to vary the badge.
  assert.match(badge, /identity_verifications where user_id = _user_id and status = 'approved'/)
  assert.doesNotMatch(badge, /tier/)
})
