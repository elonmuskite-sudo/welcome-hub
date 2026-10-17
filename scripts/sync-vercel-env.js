#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeConfigPath = path.join(rootDir, '.vercel-runtime-env.json')
const linkedProjectPath = path.join(rootDir, '.vercel', 'project.json')
const dryRun = process.argv.includes('--dry-run')

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

// Voice-call ICE config. These are browser-safe (they ship in the bundle) and
// optional, so they are only synced when a real value is present.
const OPTIONAL_PUBLIC_KEYS = [
  'VITE_STUN_URL',
  'VITE_TURN_URL',
  'VITE_TURN_USERNAME',
  'VITE_TURN_CREDENTIAL',
]

const PUBLIC_KEYS = new Set([
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
  const projectId = process.env.VERCEL_PROJECT_ID || linked.projectId || ''
  const linkedOrgId = String(linked.orgId || '')
  const teamId = process.env.VERCEL_TEAM_ID || (linkedOrgId.startsWith('team_') ? linkedOrgId : '')
  return { projectId, teamId }
}

function invalidValue(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || PLACEHOLDER_HINTS.some((hint) => normalized.includes(hint))
}

function loadValues() {
  const config = loadJson(runtimeConfigPath, 'Generated runtime environment')
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
  const optionalPublic = Object.fromEntries(
    OPTIONAL_PUBLIC_KEYS
      .filter((key) => !invalidValue(config[key]))
      .map((key) => [key, String(config[key])])
  )
  return {
    ...Object.fromEntries(requiredKeys.map((key) => [key, String(config[key])])),
    ...optionalPublic,
    VITE_AUTH_PROVIDER: provider,
  }
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

function getProductionMatch(envs, key) {
  const matches = envs.filter((item) => item.key === key && item.target?.includes('production'))
  if (matches.length > 1) throw new Error(`Multiple Production variables exist for ${key}; resolve duplicates in Vercel first.`)
  if (!matches.length) return null

  const targets = [...(matches[0].target || [])].sort()
  if (targets.length !== 1 || targets[0] !== 'production') {
    throw new Error(`${key} is shared with other Vercel targets; make it Production-only before syncing.`)
  }
  return matches[0]
}

async function upsertProductionVariables(values, projectId, envs) {
  const projectPath = `/v10/projects/${encodeURIComponent(projectId)}/env`
  for (const key of Object.keys(values)) {
    const variable = {
      value: values[key],
      type: PUBLIC_KEYS.has(key) ? 'plain' : 'encrypted',
      target: ['production'],
    }
    const existing = getProductionMatch(envs, key)

    if (existing) {
      try {
        await request(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH',
          body: { value: values[key], target: ['production'] },
        })
      } catch (error) {
        throw new Error(`Failed to update ${key}: ${error.message}`)
      }
      console.log(`[vercel-env] Updated ${key} (production)`)
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
      console.log(`[vercel-env] Added ${key} (production)`)
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
  const values = loadValues()
  for (const key of Object.keys(values)) console.log(`[vercel-env] ${key}: ready`)

  if (dryRun) {
    console.log('[vercel-env] Dry run complete; no Vercel changes were made.')
    return
  }

  token = process.env.VERCEL_TOKEN || ''
  if (!token) throw new Error('Set VERCEL_TOKEN in the shell before syncing.')

  const projectConfig = getProjectConfig()
  if (!projectConfig.projectId) {
    throw new Error('Set VERCEL_PROJECT_ID or link the project with the Vercel CLI first.')
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

  await upsertProductionVariables(values, projectConfig.projectId, envs)
  await removeLegacyPublicSecrets(projectConfig.projectId, envs)
  console.log('[vercel-env] Production environment sync complete.')
}

main().catch((error) => {
  console.error(`[vercel-env] ${error.message}`)
  process.exitCode = 1
})