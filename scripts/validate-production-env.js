#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isProductionDeployment } from './deployment-env.js'
import { getPartialOptionalEnvGroups } from './optional-env-groups.js'
import { validateFirebaseServiceAccount } from '../server/firebaseServiceAccount.js'
import { validateIceConfiguration } from '../src/lib/callIce.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
// Browser keys are required for every deployment build. Server keys are required
// for Production deployments and reported as warnings in Preview/local builds.
const REQUIRED_GROUPS = [
  ['VITE_SUPABASE_URL', 'SUPABASE_URL'],
  ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'],
]
const REQUIRED_PRODUCTION_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'ADMIN_SESSION_SECRET',
]
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
  const productionLocalValues = readEnvFile(path.join(rootDir, '.env.production.local'))
  const localOverrideValues = readEnvFile(path.join(rootDir, '.env.local'))
  const productionValues = readEnvFile(path.join(rootDir, '.env.production'))
  const localValues = readEnvFile(path.join(rootDir, '.env'))
  return process.env[key] ?? productionLocalValues[key] ?? localOverrideValues[key] ?? productionValues[key] ?? localValues[key] ?? ''
}

function isPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return true
  return PLACEHOLDER_HINTS.some((hint) => text.includes(hint))
}

async function main() {
  const isStrictDeploy = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production')
  const isProductionDeploy = isProductionDeployment(process.env)
  const provider = getEnvValue('VITE_AUTH_PROVIDER') || 'supabase'
  const missing = REQUIRED_GROUPS.filter((keys) => !keys.some((key) => !isPlaceholder(getEnvValue(key)))).map((keys) => keys.join(' or '))

  if (!['supabase', 'appwrite'].includes(provider)) {
    console.error('[env:validate] VITE_AUTH_PROVIDER must be either supabase or appwrite.')
    process.exit(1)
  }

  if (provider === 'appwrite') {
    const missingAppwriteClient = ['VITE_APPWRITE_ENDPOINT', 'VITE_APPWRITE_PROJECT_ID']
      .filter((key) => isPlaceholder(getEnvValue(key)))
    if (isStrictDeploy && missingAppwriteClient.length) {
      console.error('[env:validate] Missing Appwrite client environment values:')
      for (const key of missingAppwriteClient) console.error(` - ${key}`)
      process.exit(1)
    }

    const missingAppwriteServer = APPWRITE_SERVER_KEYS
      .filter((key) => isPlaceholder(getEnvValue(key)))
    if (isProductionDeploy && missingAppwriteServer.length) {
      console.error('[env:validate] Missing Appwrite production server values:')
      for (const key of missingAppwriteServer) console.error(` - ${key}`)
      process.exit(1)
    }
  }

  const missingProductionKeys = REQUIRED_PRODUCTION_KEYS.filter((key) => isPlaceholder(getEnvValue(key)))
  const shortAdminSecret = !isPlaceholder(getEnvValue('ADMIN_SESSION_SECRET'))
    && getEnvValue('ADMIN_SESSION_SECRET').trim().length < 32
  if (isProductionDeploy && (missingProductionKeys.length || shortAdminSecret)) {
    console.error('[env:validate] Missing required production server values:')
    for (const key of missingProductionKeys) console.error(` - ${key}`)
    if (shortAdminSecret) console.error(' - ADMIN_SESSION_SECRET must be at least 32 characters')
    process.exit(1)
  }
  if (!isProductionDeploy && (missingProductionKeys.length || shortAdminSecret)) {
    const issues = [...missingProductionKeys]
    if (shortAdminSecret) issues.push('ADMIN_SESSION_SECRET must be at least 32 characters')
    console.warn(`[env:validate] Production server values are not configured in this deployment environment: ${issues.join(', ')}`)
  }
  // Voice calls relay over TURN when NAT traversal via STUN alone fails.
  const iceConfig = Object.fromEntries(
    ['VITE_STUN_URL', 'VITE_TURN_URL', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL']
      .map((key) => [key, getEnvValue(key)])
  )
  try {
    validateIceConfiguration(iceConfig)
  } catch (error) {
    if (isProductionDeploy) {
      console.error(`[env:validate] ${error.message}`)
      process.exit(1)
    }
    console.warn(`[env:validate] ${error.message}`)
  }
  if (isPlaceholder(getEnvValue('VITE_TURN_URL'))) {
    console.warn('[env:validate] VITE_TURN_URL is not set: voice calls use STUN only and may fail behind strict NATs.')
  }
  const optionalEnvValues = Object.fromEntries(
    [
      'IDSWYFT_API_URL', 'IDSWYFT_API_KEY', 'IDSWYFT_SESSION_ENCRYPTION_KEY',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID',
      'FILE_SCAN_API_URL', 'FILE_SCAN_API_KEY',
      'R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
      'VITE_WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_VAPID_PUBLIC_KEY',
      'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_VAPID_SUBJECT',
      'VITE_TURN_URL', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL',
    ].map((key) => [key, getEnvValue(key)])
  )
  const partialGroups = getPartialOptionalEnvGroups(optionalEnvValues, isPlaceholder)
  if (partialGroups.length) {
    const details = partialGroups
      .map((group) => `${group.name}: ${group.missingKeys.join(', ')}`)
      .join('; ')
    const message = `Optional integrations are partially configured: ${details}`
    if (isProductionDeploy) {
      console.error(`[env:validate] ${message}`)
      process.exit(1)
    }
    console.warn(`[env:validate] ${message}`)
  }
  const firebaseServiceAccount = getEnvValue('FIREBASE_SERVICE_ACCOUNT_JSON')
  if (isPlaceholder(firebaseServiceAccount)) {
    console.warn('[env:validate] Native background call alerts are disabled until FIREBASE_SERVICE_ACCOUNT_JSON is configured.')
  } else {
    try {
      validateFirebaseServiceAccount(firebaseServiceAccount)
    } catch (error) {
      if (isProductionDeploy) {
        console.error(`[env:validate] ${error.message}`)
        process.exit(1)
      }
      console.warn(`[env:validate] ${error.message}`)
    }
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
