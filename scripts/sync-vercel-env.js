#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPartialOptionalEnvGroups } from './optional-env-groups.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeConfigPath = path.join(rootDir, '.vercel-runtime-env.json')
const linkedProjectPath = path.join(rootDir, '.vercel', 'project.json')
const dryRun = process.argv.includes('--dry-run')
const onlyMissing = process.argv.includes('--only-missing')
const keysArgument = process.argv.find((argument) => argument.startsWith('--keys='))
const targetArgument = process.argv.find((argument) => argument.startsWith('--target='))
const localEnvPath = path.join(rootDir, '.env.local')

// Vercel credentials may live in the gitignored .env.local so they survive
// across terminal sessions; an exported shell variable still takes precedence.
// These keys are never written to the generated runtime environment.
function readLocalEnv(key) {
  if (!fs.existsSync(localEnvPath)) return ''
  for (const line of fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, '')
  }
  return ''
}

function resolveSetting(key) {
  const fromShell = String(process.env[key] || '').trim()
  return fromShell || readLocalEnv(key)
}

const REQUIRED_ENV_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'ADMIN_SESSION_SECRET',
]

const OPTIONAL_ENV_KEYS = [
  'VITE_APPWRITE_ENDPOINT',
  'VITE_APPWRITE_PROJECT_ID',
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'SUPABASE_POOLER_URL',
]

const OPTIONAL_SERVER_KEYS = [
  'IDSWYFT_API_URL',
  'IDSWYFT_API_KEY',
  'IDSWYFT_WEBHOOK_SECRET',
  'IDSWYFT_SESSION_ENCRYPTION_KEY',
  'IDSWYFT_INIT_PATH',
  'IDSWYFT_STATUS_PATH',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
  'FILE_SCAN_API_URL',
  'FILE_SCAN_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
]

// Voice-call ICE config. These are browser-safe (they ship in the bundle) and
// optional, so they are only synced when a real value is present.
const OPTIONAL_PUBLIC_KEYS = [
  'VITE_STUN_URL',
  'VITE_TURN_URL',
  'VITE_TURN_USERNAME',
  'VITE_TURN_CREDENTIAL',
]

// Object storage (Cloudflare R2 / S3-compatible). The credentials are
// server-only and the base URL is browser-safe, so the set is optional and is
// only synced once real values exist. Without them the storage API reports 503
// and uploads fall back to Supabase.
const OPTIONAL_R2_KEYS = [
  'R2_BUCKET_NAME',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'VITE_R2_PUBLIC_BASE_URL',
]

// Background call alerts (Web Push). The public key ships to the browser in the
// bundle, the private key is a server-only secret, and the subject is a contact
// URL. Optional: without them the app reports that web push is not configured.
const OPTIONAL_WEB_PUSH_KEYS = [
  'VITE_WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_VAPID_SUBJECT',
]

export const PUBLIC_KEYS = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_AUTH_PROVIDER',
  'VITE_APPWRITE_ENDPOINT',
  'VITE_APPWRITE_PROJECT_ID',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'RESEND_FROM',
  ...OPTIONAL_PUBLIC_KEYS,
  // Only the public base URL is browser-safe; the R2 credentials must stay
  // encrypted on Vercel.
  'VITE_R2_PUBLIC_BASE_URL',
  // The VAPID public key and subject are not secrets; the private key must stay
  // encrypted on Vercel.
  'VITE_WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_SUBJECT',
])

const LEGACY_PUBLIC_SECRETS = ['VITE_ADMIN_PASSWORD']
const PLACEHOLDER_HINTS = [
  'your_',
  'your-real-project-id',
  'your-real-team-id',
  'actual_project_id',
  'actual_team_id',
  'example.com',
  'replace-me',
  'changeme',
  'your-project',
  'your_supabase',
  'your_domain',
]

function loadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error(`${label} is missing or invalid: ${path.relative(rootDir, filePath)}`)
  }
}

function getProjectConfig() {
  const linked = fs.existsSync(linkedProjectPath)
    ? loadJson(linkedProjectPath, 'Vercel project link')
    : {}
  const projectId = resolveSetting('VERCEL_PROJECT_ID') || linked.projectId || ''
  const linkedOrgId = String(linked.orgId || '')
  const teamId = resolveSetting('VERCEL_TEAM_ID') || (linkedOrgId.startsWith('team_') ? linkedOrgId : '')
  return { projectId, teamId }
}

function invalidValue(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || PLACEHOLDER_HINTS.some((hint) => normalized.includes(hint))
}

export function buildSyncedValues(config) {
  const provider = String(config.VITE_AUTH_PROVIDER || 'supabase').trim().toLowerCase()
  if (!['supabase', 'appwrite'].includes(provider)) {
    throw new Error('VITE_AUTH_PROVIDER must be either supabase or appwrite.')
  }

  const requiredKeys = [
    ...REQUIRED_ENV_KEYS,
    'VITE_AUTH_PROVIDER',
    ...(provider === 'appwrite' ? OPTIONAL_ENV_KEYS : []),
  ]
  const missing = requiredKeys.filter((key) => invalidValue(config[key]))
  if (missing.length) {
    throw new Error(`Missing or placeholder values in generated environment: ${missing.join(', ')}`)
  }
  if (String(config.ADMIN_SESSION_SECRET).trim().length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters.')
  }
  const partialGroups = getPartialOptionalEnvGroups(config, invalidValue)
  if (partialGroups.length) {
    const details = partialGroups
      .map((group) => `${group.name}: ${group.missingKeys.join(', ')}`)
      .join('; ')
    throw new Error(`Configure each optional integration completely or leave it disabled. Missing values: ${details}`)
  }
  const optionalServer = Object.fromEntries(
    OPTIONAL_SERVER_KEYS
      .filter((key) => !invalidValue(config[key]))
      .map((key) => [key, String(config[key])])
  )
  const optionalPublic = Object.fromEntries(
    OPTIONAL_PUBLIC_KEYS
      .filter((key) => !invalidValue(config[key]))
      .map((key) => [key, String(config[key])])
  )
  const optionalR2 = Object.fromEntries(
    OPTIONAL_R2_KEYS
      .filter((key) => !invalidValue(config[key]))
      .map((key) => [key, String(config[key])])
  )
  const optionalWebPush = Object.fromEntries(
    OPTIONAL_WEB_PUSH_KEYS
      .filter((key) => !invalidValue(config[key]))
      .map((key) => [key, String(config[key])])
  )
  return {
    ...Object.fromEntries(requiredKeys.map((key) => [key, String(config[key])])),
    ...optionalPublic,
    ...optionalR2,
    ...optionalWebPush,
    ...optionalServer,
    VITE_AUTH_PROVIDER: provider,
  }
}

export function selectSyncedValues(values, keys) {
  if (!keys?.length) return values
  const unknown = keys.filter((key) => !Object.hasOwn(values, key))
  if (unknown.length) throw new Error(`Requested environment keys are unavailable: ${unknown.join(', ')}`)
  return Object.fromEntries(keys.map((key) => [key, values[key]]))
}

export function parseVercelTarget(target) {
  const selected = target || 'production'
  if (!['production', 'preview'].includes(selected)) {
    throw new Error('Vercel target must be production or preview.')
  }
  return selected
}

function loadValues() {
  return buildSyncedValues(loadJson(runtimeConfigPath, 'Generated runtime environment'))
}

async function request(pathname, { method = 'GET', body } = {}) {
  const url = new URL(pathname, 'https://api.vercel.com')
  if (teamId) url.searchParams.set('teamId', teamId)

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let result = {}
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    result = {}
  }

  if (!response.ok) {
    const code = result.error?.code ? `, ${result.error.code}` : ''
    if (response.status === 403) {
      throw new Error(`Vercel API request forbidden (${method} ${pathname}${code}). Check that the token is valid, scoped to the owning team, and authorized for this project.`)
    }
    throw new Error(`Vercel API request failed (${response.status}${code}).`)
  }
  return result
}

function getTargetMatch(envs, key, target) {
  const matches = envs.filter((item) =>
    item.key === key && item.target?.includes(target) && !item.gitBranch
  )
  const targetName = target === 'production' ? 'Production' : 'Preview'
  if (matches.length > 1) throw new Error(`Multiple ${targetName} variables exist for ${key}; resolve duplicates in Vercel first.`)
  if (!matches.length) return null

  const targets = [...(matches[0].target || [])].sort()
  if (targets.length !== 1 || targets[0] !== target) {
    throw new Error(`${key} is shared with other Vercel targets; make it ${targetName}-only before syncing.`)
  }
  return matches[0]
}

async function upsertTargetVariables(values, projectId, envs, target) {
  const projectPath = `/v10/projects/${encodeURIComponent(projectId)}/env`
  for (const key of Object.keys(values)) {
    const variable = {
      value: values[key],
      type: PUBLIC_KEYS.has(key) ? 'plain' : 'encrypted',
      target: [target],
    }
    const existing = getTargetMatch(envs, key, target)

    if (existing) {
      try {
        await request(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH',
          body: { value: values[key], target: [target] },
        })
      } catch (error) {
        throw new Error(`Failed to update ${key}: ${error.message}`)
      }
      console.log(`[vercel-env] Updated ${key} (${target})`)
    } else {
      let created
      try {
        created = await request(projectPath, {
          method: 'POST',
          body: { key, ...variable },
        })
      } catch (error) {
        throw new Error(`Failed to create ${key}: ${error.message}`)
      }
      if (created.id) envs.push({ key, ...variable, id: created.id })
      console.log(`[vercel-env] Added ${key} (${target})`)
    }
  }
}

async function removeLegacyPublicSecrets(projectId, envs) {
  const oldEntries = envs.filter((item) => LEGACY_PUBLIC_SECRETS.includes(item.key))
  for (const entry of oldEntries) {
    await request(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(entry.id)}`, {
      method: 'DELETE',
    })
    console.log(`[vercel-env] Removed obsolete ${entry.key}`)
  }
}

let token = ''
let teamId = ''

async function main() {
  if (onlyMissing && !keysArgument) {
    throw new Error('--only-missing requires an explicit --keys=KEY1,KEY2 allowlist.')
  }
  const requestedKeys = keysArgument
    ? [...new Set(keysArgument.slice('--keys='.length).split(',').map((key) => key.trim()).filter(Boolean))]
    : null
  if (keysArgument && !requestedKeys.length) {
    throw new Error('--keys must include at least one environment variable name.')
  }
  const target = parseVercelTarget(targetArgument?.slice('--target='.length))
  let values = selectSyncedValues(loadValues(), requestedKeys)
  for (const key of Object.keys(values)) console.log(`[vercel-env] ${key}: ready`)

  if (dryRun) {
    console.log('[vercel-env] Dry run complete; no Vercel changes were made.')
    return
  }

  token = resolveSetting('VERCEL_TOKEN')
  if (!token) throw new Error('Set VERCEL_TOKEN in the shell or in .env.local before syncing.')

  const projectConfig = getProjectConfig()
  if (!projectConfig.projectId) {
    throw new Error('Set VERCEL_PROJECT_ID in the shell or in .env.local, or link the project with the Vercel CLI first.')
  }
  if (invalidValue(projectConfig.projectId)) {
    throw new Error('VERCEL_PROJECT_ID is still an example value; use the real ID from Vercel Project Settings > General.')
  }
  if (projectConfig.teamId && invalidValue(projectConfig.teamId)) {
    throw new Error('VERCEL_TEAM_ID is still an example value; use the real team ID from Vercel Team Settings or omit it for a personal project.')
  }
  teamId = projectConfig.teamId

  const projectId = encodeURIComponent(projectConfig.projectId)
  const response = await request(`/v9/projects/${projectId}/env?limit=100`)
  const envs = Array.isArray(response.envs) ? response.envs : []

  if (onlyMissing) {
    const alreadyConfigured = Object.keys(values).filter((key) => getTargetMatch(envs, key, target))
    for (const key of alreadyConfigured) console.log(`[vercel-env] Skipped ${key} (already configured for ${target})`)
    values = Object.fromEntries(Object.entries(values).filter(([key]) => !alreadyConfigured.includes(key)))
  }

  await upsertTargetVariables(values, projectConfig.projectId, envs, target)
  if (!requestedKeys) await removeLegacyPublicSecrets(projectConfig.projectId, envs)
  console.log(`[vercel-env] ${target} environment sync complete.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[vercel-env] ${error.message}`)
    process.exitCode = 1
  })
}