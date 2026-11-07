import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isProductionDeployment } from '../scripts/deployment-env.js'
import {
  buildSyncedValues,
  parseVercelTarget,
  PUBLIC_KEYS,
  selectSyncedValues,
} from '../scripts/sync-vercel-env.js'
import { getPartialOptionalEnvGroups } from '../scripts/optional-env-groups.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const invalidValue = (value) => !String(value || '').trim() || String(value).includes('your_')

function requiredRuntimeConfig() {
  return {
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    RESEND_API_KEY: 'resend-key',
    RESEND_FROM: 'Nexus <noreply@example.org>',
    ADMIN_SESSION_SECRET: 'session-signing-secret-with-adequate-length',
    VITE_AUTH_PROVIDER: 'supabase',
  }
}

test('generated server integration keys are available to Vercel runtime sync', () => {
  const generator = fs.readFileSync(path.join(root, 'scripts', 'generate-runtime-env.js'), 'utf8')
  const vercelIgnore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8')
  const keys = [
    'IDSWYFT_API_URL',
    'IDSWYFT_API_KEY',
    'IDSWYFT_SESSION_ENCRYPTION_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_MESSAGING_SERVICE_SID',
    'FILE_SCAN_API_URL',
    'FILE_SCAN_API_KEY',
  ]

  for (const key of keys) {
    assert.ok(generator.includes(`${key}: ''`), `${key} should be part of the generated environment`)
    assert.ok(generator.includes(`'${key}'`), `${key} should be included in the Vercel runtime config`)
    assert.equal(PUBLIC_KEYS.has(key), false, `${key} must remain encrypted on Vercel`)
  }
  assert.match(vercelIgnore, /^\.vercel-runtime-env\.json$/m)
})

test('server-only integration variables are synced without exposing them as public values', () => {
  const config = {
    ...requiredRuntimeConfig(),
    IDSWYFT_API_URL: 'https://kyc.example.org',
    IDSWYFT_API_KEY: 'idswyft-key',
    IDSWYFT_SESSION_ENCRYPTION_KEY: 'encryption-key',
    TWILIO_ACCOUNT_SID: 'account-sid',
    TWILIO_AUTH_TOKEN: 'auth-token',
    TWILIO_MESSAGING_SERVICE_SID: 'messaging-sid',
    FILE_SCAN_API_URL: 'https://scanner.example.org',
    FILE_SCAN_API_KEY: 'scan-key',
  }
  const synced = buildSyncedValues(config)

  for (const key of [
    'IDSWYFT_API_KEY',
    'IDSWYFT_SESSION_ENCRYPTION_KEY',
    'TWILIO_AUTH_TOKEN',
    'FILE_SCAN_API_KEY',
  ]) {
    assert.equal(synced[key], config[key])
    assert.equal(PUBLIC_KEYS.has(key), false)
  }
})

test('optional integrations reject partial configuration', () => {
  const partialKyc = {
    IDSWYFT_API_URL: 'https://kyc.example.org',
    IDSWYFT_API_KEY: 'idswyft-key',
  }
  const partial = getPartialOptionalEnvGroups(partialKyc, invalidValue)
  assert.deepEqual(partial, [{
    name: 'Idswyft KYC',
    missingKeys: ['IDSWYFT_SESSION_ENCRYPTION_KEY'],
  }])

  assert.deepEqual(
    getPartialOptionalEnvGroups({ IDSWYFT_API_URL: '', IDSWYFT_API_KEY: '' }, invalidValue),
    [],
  )
  assert.throws(
    () => buildSyncedValues({ ...requiredRuntimeConfig(), ...partialKyc }),
    /Idswyft KYC: IDSWYFT_SESSION_ENCRYPTION_KEY/,
  )
  assert.throws(
    () => buildSyncedValues({
      ...requiredRuntimeConfig(),
      ADMIN_SESSION_SECRET: 'too-short',
    }),
    /ADMIN_SESSION_SECRET must be at least 32 characters/,
  )
})

test('production setup workflow provisions the admin session secret as encrypted', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'setup-production.yml'), 'utf8')
  assert.match(workflow, /ADMIN_SESSION_SECRET: \$\{\{ secrets\.ADMIN_SESSION_SECRET \}\}/)
  assert.match(workflow, /ADMIN_SESSION_SECRET.*must be at least 32 characters/)
  assert.match(workflow, /put ADMIN_SESSION_SECRET "\$ADMIN_SESSION_SECRET" sensitive/)
})

test('only production deployments require production server environment values', () => {
  assert.equal(isProductionDeployment({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), false)
  assert.equal(isProductionDeployment({ VERCEL_ENV: 'production' }), true)
  assert.equal(isProductionDeployment({ NODE_ENV: 'production' }), true)
  assert.equal(isProductionDeployment({ NODE_ENV: 'development' }), false)
})

test('Vercel sync can be restricted to an explicit allowlist', () => {
  const synced = buildSyncedValues(requiredRuntimeConfig())
  assert.deepEqual(
    selectSyncedValues(synced, ['RESEND_FROM', 'ADMIN_SESSION_SECRET']),
    {
      RESEND_FROM: synced.RESEND_FROM,
      ADMIN_SESSION_SECRET: synced.ADMIN_SESSION_SECRET,
    },
  )
  assert.throws(() => selectSyncedValues(synced, ['UNKNOWN_SECRET']), /UNKNOWN_SECRET/)
})

test('Vercel sync accepts only Production or Preview targets', () => {
  assert.equal(parseVercelTarget(undefined), 'production')
  assert.equal(parseVercelTarget('preview'), 'preview')
  assert.throws(() => parseVercelTarget('development'), /production or preview/)
})

test('Vercel Serverless Function count stays within the Hobby plan limit', () => {
  const apiRoot = path.join(root, 'api')
  const apiFiles = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile() && /\.m?js$/.test(entry.name)) apiFiles.push(entryPath)
    }
  }
  visit(apiRoot)
  assert.ok(apiFiles.length <= 12, `Expected at most 12 Serverless Functions; found ${apiFiles.length}`)

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  const kycRewrites = new Map(
    vercelConfig.rewrites
      .filter(({ source }) => source.startsWith('/api/kyc/'))
      .map(({ source, destination }) => [source, destination]),
  )
  assert.equal(kycRewrites.get('/api/kyc/init'), '/api/kyc?action=init')
  assert.equal(kycRewrites.get('/api/kyc/upload'), '/api/kyc?action=upload')
  assert.equal(kycRewrites.get('/api/kyc/status'), '/api/kyc?action=status')
})
