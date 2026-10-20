#!/usr/bin/env node
/**
 * Store screenshot generator.
 *
 * Captures the built app (dist/) at the exact pixel resolutions Google Play and
 * the App Store require, and writes them under
 * docs/store-submission/screenshots/<device>/.
 *
 * Public routes (landing, sign in, create account) are always captured. Signed-in
 * surfaces (home/chat list, feed, contacts, privacy & security) are captured too
 * when a demo account is supplied, because store review expects to see the real
 * product, not just the sign-in screen:
 *
 *   $env:NEXUS_DEMO_EMAIL = 'review@example.com'
 *   $env:NEXUS_DEMO_PASSWORD = '...'
 *   node scripts/store-screenshots.mjs
 *
 * The demo account must already be past email verification (see
 * docs/store-submission/reviewer-notes.md). Without it the script still produces
 * the public set and reports what it skipped.
 *
 * With `--seed-chat` the two accounts in .demo-accounts.local.json are signed in
 * on separate browser profiles, end-to-end encryption is enabled on each, and one
 * conversation is created and messaged through the real UI — so the encrypted
 * thread shown in the store images is genuine ciphertext. Any conversation left
 * over from an earlier run is cleared first (its device key is gone, so it could
 * never be decrypted again), and the finished thread is removed afterwards with
 * `node scripts/demo-content.mjs cleanup-chat`.
 *
 * Usage: node scripts/store-screenshots.mjs [--port 4173] [--seed-chat]
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4173)
const BASE_URL = `http://localhost:${PORT}`
const OUT_ROOT = fileURLToPath(new URL('../docs/store-submission/screenshots/', import.meta.url))
const NAV_TIMEOUT = 20000
const SEED_CHAT = process.argv.includes('--seed-chat')

// `--seed-chat` drives both review accounts, so their credentials come from the
// gitignored file rather than the environment.
function loadReviewAccounts() {
  const file = fileURLToPath(new URL('../.demo-accounts.local.json', import.meta.url))
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed.accounts) && parsed.accounts.length >= 2 ? parsed.accounts : null
  } catch {
    return null
  }
}

const reviewAccounts = SEED_CHAT ? loadReviewAccounts() : null
if (SEED_CHAT && !reviewAccounts) {
  console.error('--seed-chat needs two accounts in .demo-accounts.local.json. Run: node scripts/create-demo-accounts.mjs')
  process.exit(1)
}

const DEMO_EMAIL = reviewAccounts ? reviewAccounts[0].email : process.env.NEXUS_DEMO_EMAIL || ''
const DEMO_PASSWORD = reviewAccounts ? reviewAccounts[0].password : process.env.NEXUS_DEMO_PASSWORD || ''
const CAN_SIGN_IN = Boolean(DEMO_EMAIL && DEMO_PASSWORD)

// Each device is a CSS viewport plus a device scale factor that multiplies out to
// the exact pixel size the store requires. `store` records which listing it feeds.
const DEVICES = [
  { name: 'play-phone', store: 'Google Play (phone)', width: 360, height: 640, dsf: 3 }, // 1080x1920
  { name: 'play-tablet-7', store: 'Google Play (7in tablet)', width: 600, height: 960, dsf: 2 }, // 1200x1920
  { name: 'play-tablet-10', store: 'Google Play (10in tablet)', width: 800, height: 1280, dsf: 2 }, // 1600x2560
  { name: 'ios-6.7', store: 'App Store (6.7in iPhone)', width: 430, height: 932, dsf: 3 }, // 1290x2796
  { name: 'ios-ipad-13', store: 'App Store (13in iPad)', width: 1024, height: 1366, dsf: 2 }, // 2048x2732
]

const PUBLIC_SHOTS = [
  { file: '01-welcome', path: '/', wait: 1200 },
  { file: '02-sign-in', path: '/login', wait: 800 },
  { file: '03-create-account', path: '/register', wait: 800 },
]

const APP_SHOTS = [
  { file: '04-home', path: '/app', wait: 2500 },
  { file: '05-feed', path: '/app/feeds', wait: 2500 },
  { file: '06-contacts', path: '/app/contacts', wait: 2000 },
  { file: '07-privacy-security', path: '/app/settings/privacy', wait: 2000 },
  { file: '08-account', path: '/app/settings/account', wait: 2000 },
]

let hostedServer = null

async function startServer() {
  const script = fileURLToPath(new URL('./serve-dist.mjs', import.meta.url))
  hostedServer = spawn(process.execPath, [script, String(PORT)], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`dist server did not become reachable at ${BASE_URL}`)
}

function stopServer() {
  if (hostedServer) hostedServer.kill()
}

// Each seeding run generates a fresh device key pair, so a thread left behind by
// an earlier run can never be decrypted again. Clear it first so `--seed-chat` is
// repeatable and the capture shows only the freshly seeded conversation.
function cleanupDemoChat() {
  return new Promise((resolve) => {
    const script = fileURLToPath(new URL('./demo-content.mjs', import.meta.url))
    const child = spawn(process.execPath, [script, 'cleanup-chat'], { stdio: 'inherit' })
    child.on('exit', resolve)
    child.on('error', resolve)
  })
}

async function signIn(page, email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/app(\/|$)/, { timeout: NAV_TIMEOUT })
  await page.waitForSelector('.chat-shell', { timeout: NAV_TIMEOUT })
}

// The E2EE toggle is the only switch on the privacy screen without an accessible
// name, so its shared `w-12 h-6 rounded-full` styling is the stable handle.
const E2EE_TOGGLE = 'button.w-12.h-6.rounded-full:not([aria-label])'

async function enableE2EE(page) {
  await page.goto(`${BASE_URL}/app/settings/privacy`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.waitForSelector('.chat-shell', { timeout: NAV_TIMEOUT })
  const toggle = page.locator(E2EE_TOGGLE).first()
  await toggle.waitFor({ state: 'visible', timeout: NAV_TIMEOUT })
  const classes = (await toggle.getAttribute('class')) || ''
  if (!classes.includes('bg-green-500')) await toggle.click()
  // The public-key card only renders once the toggle state has flipped, and the
  // key must be published before the peer can encrypt to it.
  await page.getByText('Your Public Key').first().waitFor({ timeout: NAV_TIMEOUT })
  await page.waitForTimeout(2000)
}

// Finds the peer by Nexus number and opens the thread, answering the mandatory
// "save this contact first" prompt with Ignore so the reviewer's contact list
// stays empty.
async function openConversation(page, peerNexusId) {
  await page.goto(`${BASE_URL}/app`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.waitForSelector('.chat-shell', { timeout: NAV_TIMEOUT })

  const gotIt = page.getByRole('button', { name: 'Got it' })
  if (await gotIt.count()) await gotIt.first().click().catch(() => {})

  const search = page.locator('input[placeholder="Search or start new chat"]:visible').first()
  await search.waitFor({ state: 'visible', timeout: NAV_TIMEOUT })
  await search.fill(peerNexusId)
  await page.getByText('User Found').first().waitFor({ timeout: NAV_TIMEOUT })
  await page.getByRole('button', { name: 'Message' }).first().click()

  const ignore = page.getByRole('button', { name: 'Ignore' })
  if (await ignore.first().isVisible().catch(() => false)) await ignore.first().click()

  await page.waitForURL(/\/app\/chat\/[^/?#]+/, { timeout: NAV_TIMEOUT })
  const match = /\/app\/chat\/([^/?#]+)/.exec(page.url())
  return match ? decodeURIComponent(match[1]) : null
}

async function sendMessages(page, lines) {
  const box = page.locator('textarea[aria-label="Message"]:visible').first()
  await box.waitFor({ state: 'visible', timeout: NAV_TIMEOUT })
  for (const text of lines) {
    await box.fill(text)
    await box.press('Enter')
    await page.waitForTimeout(800)
  }
}

// Drives both review accounts through the real UI so the encrypted thread in the
// store images is genuine ciphertext produced by the app's own E2EE path. Returns
// the chat id (for the thread screenshot) and demo1's device key, which must be
// injected into every capture context or the messages would render unreadable.
async function seedEncryptedChat(browser) {
  const [accountA, accountB] = reviewAccounts
  const viewport = { width: 1280, height: 900 }
  const contextA = await browser.newContext({ viewport })
  const contextB = await browser.newContext({ viewport })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    const step = (label) => console.log(`Seeding: ${label}…`)
    step('signing in demo1 and enabling E2EE')
    await signIn(pageA, accountA.email, accountA.password)
    await enableE2EE(pageA)
    step('signing in demo2 and enabling E2EE')
    await signIn(pageB, accountB.email, accountB.password)
    await enableE2EE(pageB)

    step('opening a conversation through the real UI')
    const peerNexusId = accountB.nexusId || accountB.memberId
    const chatId = await openConversation(pageA, peerNexusId)
    if (!chatId) throw new Error('could not resolve the new chat id')

    step('sending the demo thread')
    await sendMessages(pageA, [
      'Hey! Just got set up on Nexus — sign-up took under a minute.',
      'Messages are end-to-end encrypted here, so only the two of us can read them.',
      'Still on for the design review at 7?',
    ])

    await pageB.goto(`${BASE_URL}/app/chat/${chatId}`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
    await sendMessages(pageB, [
      'Got it — the lock shows on every message on my side too.',
      '7 works. I will bring the updated screens.',
    ])
    await pageB.goto(`${BASE_URL}/app`, { waitUntil: 'load', timeout: NAV_TIMEOUT })

    await sendMessages(pageA, ['Perfect. See you at 7 — testing attachments before then.'])

    // Reload so the whole thread is re-read and decrypted from scratch: if the
    // key agreement were wrong the messages would come back unreadable, and the
    // store images would silently ship a lock placeholder.
    await pageA.goto(`${BASE_URL}/app/chat/${chatId}`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
    await pageA.getByText('See you at 7').first().waitFor({ timeout: NAV_TIMEOUT })
    if (await pageA.getByText(/unable to decrypt/i).count()) {
      throw new Error('seeded messages did not decrypt in the capturing browser')
    }

    const e2eeKeys = await pageA.evaluate(() => localStorage.getItem('nexus_e2ee_keys'))
    if (!e2eeKeys) throw new Error('no E2EE key material found after seeding')

    console.log(`Seeding: conversation ${chatId} created and verified readable.`)
    return { chatId, e2eeKeys }
  } finally {
    await contextA.close().catch(() => {})
    await contextB.close().catch(() => {})
  }
}

// Every signed-in view paints a data-driven placeholder first ("Loading feed…",
// "Syncing…", "Loading conversations…"). Screenshotting on a timer alone ships
// those placeholders into the listing, so the capture waits for them to clear.
const LOADING_MARKERS = ['Loading feed', 'Loading chat', 'Loading conversations', 'Syncing']

async function capture(page, shot, dir) {
  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  // Signed-in routes are behind the auth gate, which paints nothing until the
  // session is restored. Waiting only on a timer can capture a blank white page,
  // so block until the app shell exists before applying the settle delay.
  if (shot.path.startsWith('/app')) {
    await page.waitForSelector('.chat-shell', { timeout: NAV_TIMEOUT }).catch(() => {})
    // Give the lazy route component time to mount, otherwise the loading check
    // below runs during the router's fallback (which carries no loading text)
    // and returns immediately.
    await page.waitForTimeout(1200)
    await page.waitForFunction(
      (markers) => !markers.some((marker) => document.body.innerText.includes(marker)),
      LOADING_MARKERS,
      { timeout: NAV_TIMEOUT },
    ).catch(() => {})
  }
  await page.waitForTimeout(shot.wait)
  await page.screenshot({ path: join(dir, `${shot.file}.png`) })
  return `${shot.file}.png`
}

await mkdir(OUT_ROOT, { recursive: true })
await startServer()

// The bundled Chromium build is downloaded on demand and may be absent in
// restricted environments; fall back to an installed Chrome/Edge channel.
async function launchBrowser() {
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch({ headless: true, ...options })
    } catch {
      // try the next candidate
    }
  }
  stopServer()
  console.error('Could not launch a browser. Install one with `npx playwright install chromium`.')
  process.exit(1)
}

const browser = await launchBrowser()
const written = []
const skipped = []

let seeded = null

try {
  if (SEED_CHAT) {
    try {
      await cleanupDemoChat()
      seeded = await seedEncryptedChat(browser)
    } catch (error) {
      skipped.push(`chat seeding failed (${error.message.split('\n')[0]}); capturing without a conversation`)
    }
  }

  for (const device of DEVICES) {
    const dir = join(OUT_ROOT, device.name)
    await mkdir(dir, { recursive: true })

    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dsf,
    })
    // The seeded thread only decrypts on the device that created the key, so the
    // same key material plus the acknowledged notice must be present before the
    // app boots — otherwise the thread renders as an unreadable placeholder.
    if (seeded) {
      await context.addInitScript(
        ([keys]) => {
          localStorage.setItem('nexus_e2ee_keys', keys)
          localStorage.setItem('nexus_e2ee_enabled', 'true')
          localStorage.setItem('nexus_e2ee_default_decided', 'true')
          localStorage.setItem('nexus_e2ee_notice_seen', 'true')
        },
        [seeded.e2eeKeys],
      )
    }
    const page = await context.newPage()

    for (const shot of PUBLIC_SHOTS) {
      written.push(await capture(page, shot, dir))
    }

    if (CAN_SIGN_IN) {
      try {
        await signIn(page)
        for (const shot of APP_SHOTS) {
          written.push(await capture(page, shot, dir))
        }
        if (seeded?.chatId) {
          written.push(await capture(page, {
            file: '09-chat-thread',
            path: `/app/chat/${seeded.chatId}`,
            wait: 3500,
          }, dir))
        }
      } catch (error) {
        skipped.push(`${device.name}: signed-in capture failed (${error.message.split('\n')[0]})`)
      }
    } else {
      skipped.push(`${device.name}: signed-in capture skipped (set NEXUS_DEMO_EMAIL / NEXUS_DEMO_PASSWORD)`)
    }

    await context.close()
    console.log(`${device.name.padEnd(14)} ${device.width * device.dsf}x${device.height * device.dsf}  -> ${device.store}`)
  }
} finally {
  await browser.close()
  stopServer()
}

console.log(`\nWrote ${written.length} screenshot(s) to docs/store-submission/screenshots/`)
for (const note of skipped) console.log(`- ${note}`)
