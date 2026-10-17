#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
// Only the browser keys are needed to build. Server keys are checked as warnings because Vercel
// functions read them at runtime.
const REQUIRED_GROUPS = [
  ['VITE_SUPABASE_URL', 'SUPABASE_URL'],
  ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
]
const RECOMMENDED_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'RESEND_FROM']
const APPWRITE_SERVER_KEYS = [
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'SUPABASE_POOLER_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const PLACEHOLDER_HINTS = [
  'your_',
  'example.com',
  'replace-me',
  'changeme',
  'your-project',
  'your_supabase',
  'your_domain',
]

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function getEnvValue(key) {
  const localValues = readEnvFile(path.join(rootDir, '.env'))
  const productionValues = readEnvFile(path.join(rootDir, '.env.production'))
  return process.env[key] ?? productionValues[key] ?? localValues[key] ?? ''
}

function isPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return true
  return PLACEHOLDER_HINTS.some((hint) => text.includes(hint))
}

async function main() {
  const isStrictDeploy = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production')
  const provider = getEnvValue('VITE_AUTH_PROVIDER') || 'supabase'
  const missing = REQUIRED_GROUPS.filter((keys) => !keys.some((key) => !isPlaceholder(getEnvValue(key)))).map((keys) => keys.join(' or '))
  const missingRecommended = RECOMMENDED_KEYS.filter((key) => isPlaceholder(getEnvValue(key)))

  if (!['supabase', 'appwrite'].includes(provider)) {
    console.error('[env:validate] VITE_AUTH_PROVIDER must be either supabase or appwrite.')
    process.exit(1)
  }

  if (provider === 'appwrite') {
    const missingAppwrite = [
      ...['VITE_APPWRITE_ENDPOINT', 'VITE_APPWRITE_PROJECT_ID'],
      ...APPWRITE_SERVER_KEYS,
    ].filter((key) => isPlaceholder(getEnvValue(key)))
    if (isStrictDeploy && missingAppwrite.length) {
      console.error('[env:validate] Missing Appwrite production environment values:')
      for (const key of missingAppwrite) console.error(` - ${key}`)
      process.exit(1)
    }
  }

  if (missingRecommended.length) {
    console.warn(`[env:validate] Not set (sign-up emails will fail until added): ${missingRecommended.join(', ')}`)
  }
  // Without this secret Edge Middleware fails closed, so every /admin* request
  // would be redirected to the sign-in page.
  if (isPlaceholder(getEnvValue('ADMIN_SESSION_SECRET'))) {
    console.warn('[env:validate] ADMIN_SESSION_SECRET is not set: /admin* requests will be blocked in production until it is.')
  }
  // Voice calls relay over TURN when NAT traversal via STUN alone fails.
  const hasTurnUrl = !isPlaceholder(getEnvValue('VITE_TURN_URL'))
  const hasTurnUser = !isPlaceholder(getEnvValue('VITE_TURN_USERNAME'))
  const hasTurnCredential = !isPlaceholder(getEnvValue('VITE_TURN_CREDENTIAL'))
  if (!hasTurnUrl) {
    console.warn('[env:validate] VITE_TURN_URL is not set: voice calls use STUN only and may fail behind strict NATs.')
  }
  if (hasTurnUser !== hasTurnCredential) {
    console.warn('[env:validate] TURN username and credential must be set together; relay credentials will be ignored.')
  }
  if (isStrictDeploy && missing.length) {
    console.error('[env:validate] Missing production env values before deploy:')
    for (const key of missing) console.error(` - ${key}`)
    process.exit(1)
  }
  console.log('[env:validate] Environment validation passed.')
}

main().catch((error) => {
  console.error('[env:validate] Failed:', error.message)
  process.exit(1)
})
