#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const envFiles = [
  '.env',
  '.env.production',
  '.env.local',
  '.env.production.local',
]

const IS_VERCEL_DEPLOY = Boolean(process.env.VERCEL || process.env.VERCEL_ENV)

const DEFAULTS = IS_VERCEL_DEPLOY ? {
  VITE_SUPABASE_URL: '',
  SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  SUPABASE_ANON_KEY: '',
  VITE_AUTH_PROVIDER: 'supabase',
  VITE_APPWRITE_ENDPOINT: '',
  VITE_APPWRITE_PROJECT_ID: '',
  APPWRITE_ENDPOINT: '',
  APPWRITE_PROJECT_ID: '',
  SUPABASE_POOLER_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  RESEND_API_KEY: '',
  RESEND_FROM: '',
  ADMIN_SESSION_SECRET: '',
  VITE_STUN_URL: '',
  VITE_TURN_URL: '',
  VITE_TURN_USERNAME: '',
  VITE_TURN_CREDENTIAL: '',
} : {
  VITE_SUPABASE_URL: '',
  SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  SUPABASE_ANON_KEY: '',
  VITE_AUTH_PROVIDER: 'supabase',
  VITE_APPWRITE_ENDPOINT: '',
  VITE_APPWRITE_PROJECT_ID: '',
  APPWRITE_ENDPOINT: '',
  APPWRITE_PROJECT_ID: '',
  SUPABASE_POOLER_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  RESEND_API_KEY: '',
  RESEND_FROM: '',
  ADMIN_SESSION_SECRET: '',
  VITE_STUN_URL: '',
  VITE_TURN_URL: '',
  VITE_TURN_USERNAME: '',
  VITE_TURN_CREDENTIAL: '',
}

const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
]

const VERCEL_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_AUTH_PROVIDER',
  'VITE_APPWRITE_ENDPOINT',
  'VITE_APPWRITE_PROJECT_ID',
  'VITE_STUN_URL',
  'VITE_TURN_URL',
  'VITE_TURN_USERNAME',
  'VITE_TURN_CREDENTIAL',
  ...REQUIRED_KEYS,
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'SUPABASE_POOLER_URL',
  'ADMIN_SESSION_SECRET',
]

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const values = {}
  const text = fs.readFileSync(filePath, 'utf8')

  for (const line of text.split(/\r?\n/)) {
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

function mergeEnv() {
  const merged = { ...DEFAULTS }

  for (const fileName of envFiles) {
    const filePath = path.join(rootDir, fileName)
    Object.assign(merged, parseEnvFile(filePath))
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key in merged || value !== undefined) {
      merged[key] = value
    }
  }

  return merged
}

function writeEnvFile(values) {
  const lines = []
  for (const key of Object.keys(DEFAULTS)) {
    const value = values[key] ?? ''
    lines.push(`${key}=${formatValue(value)}`)
  }

  const outputPath = path.join(rootDir, '.env.production')
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8')

  const runtimeConfigPath = path.join(rootDir, '.vercel-runtime-env.json')
  const runtimeConfig = {}
  for (const key of VERCEL_KEYS) {
    runtimeConfig[key] = values[key] ?? ''
  }
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8')

  const generated = Object.fromEntries(
    Object.entries(values).filter(([key]) => Object.hasOwn(DEFAULTS, key))
  )

  return { outputPath, runtimeConfigPath, generated }
}

function formatValue(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text
  return JSON.stringify(text)
}

const merged = mergeEnv()
const result = writeEnvFile(merged)

const missing = REQUIRED_KEYS.filter((key) => !merged[key] || String(merged[key]).trim() === '')

if (missing.length) {
  console.warn(`[generate-runtime-env] Missing values for: ${missing.join(', ')}`)
}

console.log(`[generate-runtime-env] Wrote ${result.outputPath} and ${result.runtimeConfigPath}`)
console.log(`[generate-runtime-env] Generated ${Object.keys(result.generated).length} environment entries.`)
