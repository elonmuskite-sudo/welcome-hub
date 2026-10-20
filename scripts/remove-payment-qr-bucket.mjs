// TEMPORARY one-off: remove the retired payment-qr storage bucket via the
// Storage API (direct SQL deletes on storage tables are blocked by Supabase).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readEnv() {
  const values = {}
  for (const file of ['.env', '.env.production', '.env.local']) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(m[1] in values) || !values[m[1]]) values[m[1]] = v
    }
  }
  return values
}

const env = readEnv()
const url = (process.env.SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')

const bucketId = 'payment-qr'
const res = await fetch(`${url}/storage/v1/bucket/${bucketId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${key}`, apikey: key },
})
if (res.ok) {
  console.log(`Deleted storage bucket "${bucketId}".`)
} else if (res.status === 404) {
  console.log(`Storage bucket "${bucketId}" not found (already removed).`)
} else {
  const body = await res.text()
  console.log(`Could not delete bucket (HTTP ${res.status}): ${body.slice(0, 200)}`)
  process.exitCode = 1
}
