#!/usr/bin/env node
// Resolves WebRTC TURN credentials from Metered's Open Relay API into the
// environment variables this app reads (see src/lib/callIce.js).
//
// Usage:
//   npm run turn:credentials             # print the values
//   npm run turn:credentials -- --write  # update .env.local in place
//   npm run turn:credentials -- --write --vercel   # also remind about Vercel
//
// Needs: METERED_API_KEY (and METERED_APP_NAME, the subdomain shown in your
//        dashboard) in .env.local (gitignored) or the environment.
// Sign up:  https://dashboard.metered.ca/signup?tool=turnserver  (20 GB/month free)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_FILE = path.join(ROOT, '.env.local')

const KEYS = ['VITE_STUN_URL', 'VITE_TURN_URL', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL']

function readFromFile(file, key) {
  if (!fs.existsSync(file)) return ''
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, '')
  }
  return ''
}

function resolveSetting(key) {
  if (process.env[key]) return String(process.env[key]).trim()
  for (const file of ['.env.local', '.env']) {
    const value = readFromFile(path.join(ROOT, file), key)
    if (value) return value
  }
  return ''
}

export function toList(urls) {
  const list = Array.isArray(urls) ? urls : [urls]
  return list.map((url) => String(url ?? '').trim()).filter(Boolean)
}

export function buildValues(iceServers) {
  if (!Array.isArray(iceServers) || !iceServers.length) {
    throw new Error('The credentials response did not contain an iceServers array.')
  }

  const stun = []
  const turn = []
  let username = ''
  let credential = ''

  for (const entry of iceServers) {
    for (const url of toList(entry?.urls)) {
      if (url.startsWith('stun:')) stun.push(url)
      else if (url.startsWith('turn:') || url.startsWith('turns:')) turn.push(url)
    }
    if (!credential && entry?.credential) {
      username = String(entry.username ?? '').trim()
      credential = String(entry.credential ?? '').trim()
    }
  }

  if (!turn.length || !username || !credential) {
    throw new Error('The credentials response did not include a usable TURN entry with username and credential.')
  }

  return {
    VITE_STUN_URL: stun.join(','),
    VITE_TURN_URL: turn.join(','),
    VITE_TURN_USERNAME: username,
    VITE_TURN_CREDENTIAL: credential,
  }
}

function writeEnvLocal(values) {
  const existing = fs.existsSync(LOCAL_FILE) ? fs.readFileSync(LOCAL_FILE, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  const pending = { ...values }

  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/)
    if (!match || !(match[1] in pending)) return line
    const value = pending[match[1]]
    delete pending[match[1]]
    return `${match[1]}="${value}"`
  })

  const additions = Object.entries(pending).map(([key, value]) => `${key}="${value}"`)
  if (additions.length) {
    const trimmed = updated.join('\n').replace(/\s*$/, '')
    const block = [
      '',
      '# Voice calls: TURN relay resolved from Metered Open Relay.',
      '# Written by scripts/fetch-turn-credentials.js — set the same values in Vercel for production.',
      ...additions,
    ]
    updated.splice(0, updated.length, trimmed, ...block)
  }

  fs.writeFileSync(LOCAL_FILE, `${updated.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, 'utf8')
}

async function main() {
  const write = process.argv.includes('--write')
  const apiKey = resolveSetting('METERED_API_KEY')
  const appName = resolveSetting('METERED_APP_NAME')

  if (!apiKey) {
    console.error('[turn] METERED_API_KEY is missing. Add it to .env.local (gitignored) and retry.')
    console.error('[turn] Get one from https://dashboard.metered.ca (Open Relay, free 20 GB/month).')
    process.exitCode = 1
    return
  }
  if (!appName) {
    console.error('[turn] METERED_APP_NAME is missing (the subdomain from your Metered dashboard).')
    console.error('[turn] Add it to .env.local and retry, e.g. METERED_APP_NAME=myapp')
    process.exitCode = 1
    return
  }

  const endpoint = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
  const response = await fetch(endpoint)
  if (!response.ok) {
    throw new Error(`Metered responded ${response.status} ${response.statusText}`)
  }

  const values = buildValues(await response.json())

  if (write) {
    writeEnvLocal(values)
    console.log(`[turn] Updated ${LOCAL_FILE}`)
    console.log('[turn] Set the same four variables in Vercel for production, then run `npm run env:generate`.')
    return
  }

  console.log('# Paste into .env.local (dev) and Vercel (production):')
  for (const key of KEYS) console.log(`${key}="${values[key]}"`)
}

// Only run when invoked directly so the mapper can be unit tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[turn] ${error.message}`)
    process.exitCode = 1
  })
}
