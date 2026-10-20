#!/usr/bin/env node
/**
 * End-to-end UX audit for three changes:
 *
 *   1. Header layout  — the Sign in / profile control must stay pinned to the
 *      top-right of a single-row header on every common mobile width, and the
 *      "Nexus Chat" slogan must scale without clipping or colliding.
 *   2. Sync loading   — the shared animated indicator must appear while the chat
 *      page loads, while the contacts list syncs, and while a realtime update
 *      triggers a refetch, then disappear once the sync settles.
 *   3. Read receipts  — an own message moves Sent → Delivered → Read as peer
 *      receipts arrive, an incoming message is acknowledged automatically, and
 *      turning receipts off suppresses both sending and display.
 *
 * It drives the real built app (`dist/`) against a mocked Supabase backend, so
 * every assertion exercises production code paths.
 *
 * Usage:
 *   node scripts/ux-audit.mjs            # chromium across the mobile widths
 *   node scripts/ux-audit.mjs --matrix   # 5 engines x 3 viewports
 */

import { chromium, firefox, webkit } from 'playwright'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.UX_AUDIT_PORT || 4178)
const BASE_URL = `http://localhost:${PORT}`
const PROJECT_REF = 'woavhlkgylarngqyvphf'
const SUPABASE_MATCH = `**/${PROJECT_REF}.supabase.co/**`
const SESSION_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`
const MATRIX = process.argv.includes('--matrix')
const SYNC_DELAY_MS = 900

const SELF = { id: '11111111-1111-4111-8111-111111111111', email: 'audit.a@example.com' }
const PEER_ID = '22222222-2222-4222-8222-222222222222'
const CHAT_ID = '33333333-3333-4333-8333-333333333333'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeout = 8000, interval = 100) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return true
    if (Date.now() > deadline) return false
    await sleep(interval)
  }
}

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

function buildSession() {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: 'audit.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 60 * 60 * 24 * 365,
    refresh_token: 'audit.refresh.token',
    user: {
      id: SELF.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: SELF.email,
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function createBackend() {
  // Mutable per-test latency so the sync indicator can be observed mid-flight.
  const delays = { chats: 0, messages: 0, contacts: 0 }
  const state = {
    messages: [],
    chat: {
      id: CHAT_ID,
      title: 'Audit conversation',
      type: 'private',
      avatar_url: null,
      encrypted: false,
      owner_id: SELF.id,
      created_at: '2026-01-01T00:00:00.000Z',
      participant_names: ['Audit A', 'Audit B'],
      chat_members: [{ profile_id: SELF.id }, { profile_id: PEER_ID }],
    },
    profile: {
      id: SELF.id,
      member_id: '1012345678',
      first_name: 'Audit',
      last_name: 'A',
      full_name: 'Audit A',
      avatar_url: null,
      bio: '',
      interests: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }

  let sequence = 0
  const nextId = () => {
    sequence += 1
    return `44444444-4444-4444-8444-${String(sequence).padStart(12, '0')}`
  }
  const nextTimestamp = () => new Date(Date.now() + sequence).toISOString()

  return {
    state,
    delays,
    /** A message from the other participant, as a realtime INSERT would deliver it. */
    receive(text) {
      const message = {
        id: nextId(), chat_id: CHAT_ID, sender_id: PEER_ID, content: text, type: 'text',
        file_url: null, file_name: null, duration: null, encrypted: false, created_at: nextTimestamp(),
      }
      state.messages.push(message)
      return message
    },
    /** A delivery/read receipt from the other participant. */
    peerReceipt(messageIds, status) {
      const message = {
        id: nextId(), chat_id: CHAT_ID, sender_id: PEER_ID,
        content: JSON.stringify({ messageIds, status }), type: 'receipt',
        file_url: null, file_name: null, duration: null, encrypted: false, created_at: nextTimestamp(),
      }
      state.messages.push(message)
      return message
    },
    /** Receipt rows authored by the signed-in user. */
    selfReceiptsFor(messageId) {
      return state.messages.filter((m) => {
        if (m.type !== 'receipt' || String(m.sender_id) !== SELF.id) return false
        try {
          return JSON.parse(m.content).messageIds.includes(messageId)
        } catch {
          return false
        }
      })
    },
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const accept = request.headers()['accept'] || ''
      const wantsObject = accept.includes('vnd.pgrst.object+json')
      const json = (body, status = 200) => route.fulfill({
        status, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body),
      })
      const rows = (value) => json(Array.isArray(value) ? (wantsObject ? (value[0] ?? null) : value) : value)

      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          },
        })
      }

      if (path.startsWith('/auth/v1/')) {
        if (path.endsWith('/user')) return json(buildSession().user)
        if (path.endsWith('/logout')) return route.fulfill({ status: 204 })
        if (path.includes('/token')) return json(buildSession())
        return json({})
      }

      if (path.includes('/rest/v1/rpc/')) return json(path.endsWith('has_role') ? false : null)
      if (path.includes('/rest/v1/members')) return rows([state.profile])

      if (path.includes('/rest/v1/chats')) {
        await sleep(delays.chats)
        return rows([state.chat])
      }
      if (path.includes('/rest/v1/messages')) {
        await sleep(delays.messages)
        if (request.method() === 'POST') {
          const body = request.postDataJSON()
          for (const item of (Array.isArray(body) ? body : [body])) {
            if (!state.messages.some((m) => String(m.id) === String(item.id))) state.messages.push(item)
          }
          return route.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
        }
        return json(state.messages)
      }
      if (path.includes('/rest/v1/contacts')) {
        await sleep(delays.contacts)
        return rows([])
      }
      if (path.includes('/rest/v1/')) {
        if (request.method() === 'GET') return rows([])
        return route.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
      }
      if (path.includes('/functions/v1/')) return json({ ok: true })
      return json({})
    },
  }
}

// ---------------------------------------------------------------------------
// Browser-side probes (serialised by page.evaluate — must stay self-contained)
// ---------------------------------------------------------------------------

function probeHeader() {
  const header = document.querySelector('header')
  if (!header) return { found: false }
  const hr = header.getBoundingClientRect()
  const hs = window.getComputedStyle(header)
  // Rows = disjoint vertical bands among the header's own children. Children on
  // one flex row share a band; `flex-wrap` pushes the extras onto a band below.
  const bands = Array.from(header.children)
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => el.getBoundingClientRect())
  let rows = 0
  let bandBottom = -Infinity
  for (const rect of bands) {
    if (rect.top >= bandBottom - 1) {
      rows += 1
      bandBottom = rect.bottom
    } else {
      bandBottom = Math.max(bandBottom, rect.bottom)
    }
  }
  const controls = header.lastElementChild
  const cr = controls.getBoundingClientRect()
  const slogan = header.querySelector('h1')
  const sr = slogan ? slogan.getBoundingClientRect() : null
  const cs = slogan ? window.getComputedStyle(slogan) : null
  const lineHeight = cs ? parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25 : 0
  const action = controls.querySelector('button[title="Profile menu"], a[href="/login"]')
  const ar = action ? action.getBoundingClientRect() : null
  return {
    found: true,
    text: slogan ? slogan.textContent.trim() : null,
    rows,
    headerHeight: Math.round(hr.height),
    headerRight: Math.round(hr.right),
    headerPadRight: parseFloat(hs.paddingRight) || 0,
    headerTop: Math.round(hr.top),
    headerBottom: Math.round(hr.bottom),
    controlsLeft: Math.round(cr.left),
    controlsRight: Math.round(cr.right),
    controlsCenterY: Math.round(cr.top + cr.height / 2),
    headerCenterY: Math.round(hr.top + hr.height / 2),
    sloganRight: sr ? Math.round(sr.right) : null,
    sloganClipped: slogan ? slogan.scrollWidth > slogan.clientWidth + 1 : null,
    sloganLines: sr && lineHeight ? Math.round(sr.height / lineHeight) : null,
    overlap: slogan && controls ? sr.right > cr.left + 1 : null,
    actionFound: Boolean(action),
    actionRight: ar ? Math.round(ar.right) : null,
    actionInsideHeader: ar ? ar.top >= hr.top - 1 && ar.bottom <= hr.bottom + 1 : null,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    viewportWidth: window.innerWidth,
  }
}

function probeSync() {
  const pill = document.querySelector('[data-sync-pill="true"]')
  return {
    bar: Boolean(document.querySelector('[data-sync-bar="true"]')),
    pill: Boolean(pill),
    text: pill ? pill.innerText.replace(/\s+/g, ' ').trim() : '',
    busy: document.querySelector('[aria-busy="true"]') ? true : false,
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let hostedServer = null

async function startServer() {
  const script = fileURLToPath(new URL('./serve-dist.mjs', import.meta.url))
  const root = fileURLToPath(new URL('..', import.meta.url))
  hostedServer = spawn(process.execPath, [script, String(PORT)], { cwd: root, stdio: 'ignore' })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await sleep(250)
  }
  throw new Error(`dist server did not start on ${BASE_URL}`)
}

function stopServer() {
  if (hostedServer) hostedServer.kill()
}

const FIREFOX_SCRATCH = fileURLToPath(new URL('../node_modules/.pw-tmp', import.meta.url))

const ENGINES = [
  { name: 'chromium', launcher: chromium },
  {
    name: 'firefox',
    launcher: firefox,
    options: { env: { ...process.env, APPDATA: FIREFOX_SCRATCH, LOCALAPPDATA: FIREFOX_SCRATCH } },
  },
  { name: 'webkit', launcher: webkit },
  { name: 'chrome', launcher: chromium, options: { channel: 'chrome' } },
  { name: 'edge', launcher: chromium, options: { channel: 'msedge' } },
]

// Common mobile device widths, plus two larger breakpoints for the matrix run.
const VIEWPORTS = MATRIX
  ? [
      { name: 'mobile-360x640', viewport: { width: 360, height: 640 }, maxHeader: 78 },
      { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, maxHeader: 78 },
      { name: 'mobile-428x926', viewport: { width: 428, height: 926 }, maxHeader: 78 },
      { name: 'tablet-768x1024', viewport: { width: 768, height: 1024 }, maxHeader: 96 },
      { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, maxHeader: 96 },
    ]
  : [
      { name: 'mobile-320x568', viewport: { width: 320, height: 568 }, maxHeader: 78 },
      { name: 'mobile-360x640', viewport: { width: 360, height: 640 }, maxHeader: 78 },
      { name: 'mobile-375x812', viewport: { width: 375, height: 812 }, maxHeader: 78 },
      { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, maxHeader: 78 },
      { name: 'mobile-414x896', viewport: { width: 414, height: 896 }, maxHeader: 78 },
      { name: 'mobile-428x926', viewport: { width: 428, height: 926 }, maxHeader: 78 },
    ]

function checkHeader(probe, target, label, failures) {
  const fail = (detail) => failures.push({ check: `header/${label}`, detail })
  if (!probe.found) return fail('no <header> rendered')
  if (probe.rows !== 1) fail(`children wrapped onto ${probe.rows} rows`)
  if (probe.headerHeight > target.maxHeader) fail(`header is ${probe.headerHeight}px tall (max ${target.maxHeader}) — likely wrapped`)
  if (probe.text !== 'Nexus Chat') fail(`slogan text is ${JSON.stringify(probe.text)}`)
  if (probe.sloganClipped) fail('slogan is clipped (scrollWidth > clientWidth)')
  if (probe.sloganLines !== 1) fail(`slogan wrapped onto ${probe.sloganLines} lines`)
  if (probe.overlap) fail('slogan overlaps the header controls')
  if (probe.docOverflow) fail('document scrolls horizontally')
  if (!probe.actionFound) fail('no Sign in / Profile control found')
  if (!probe.actionInsideHeader) fail('Sign in / Profile control sits outside the header band')
  // The control must sit flush against the header's inner edge — i.e. only the
  // header's own responsive padding separates it from the right edge.
  const rightInset = probe.headerRight - probe.controlsRight
  if (Math.abs(rightInset - probe.headerPadRight) > 6) {
    fail(`controls are ${rightInset}px from the right edge (header padding is ${probe.headerPadRight}px)`)
  }
  if (Math.abs(probe.controlsCenterY - probe.headerCenterY) > 14) fail('controls are not vertically centred in the header')
  if (probe.actionRight != null && Math.abs(probe.actionRight - probe.controlsRight) > 6) {
    fail('Sign in / Profile control is not the right-most element of the controls cluster')
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function newPage(browser, target, backend, { signedIn, prefs = {} }) {
  const context = await browser.newContext({ viewport: target.viewport, serviceWorkers: 'block' })
  if (typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket(/\/realtime\/v1\//, () => {})
  }
  await context.route(SUPABASE_MATCH, (route) => backend.handle(route))
  // Seed storage before any app code runs: the session token (or its absence)
  // and any user preference the test needs the settings provider to boot with.
  await context.addInitScript(
    ([sessionKey, session, extras]) => {
      for (const [key, value] of extras) {
        if (value === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, JSON.stringify(value))
      }
      if (session) window.localStorage.setItem(sessionKey, JSON.stringify(session))
      else window.localStorage.removeItem(sessionKey)
    },
    [SESSION_STORAGE_KEY, signedIn ? buildSession() : null, Object.entries(prefs)],
  )
  return { context, page: await context.newPage() }
}

/** Header layout: signed-out (/login → "Sign in") and signed-in (/app → profile). */
async function auditHeader(browser, target) {
  const failures = []
  const samples = []

  const signedOut = await newPage(browser, target, createBackend(), { signedIn: false })
  try {
    await signedOut.page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
    await signedOut.page.waitForSelector('header', { timeout: 20000 })
    const probe = await signedOut.page.evaluate(probeHeader)
    checkHeader(probe, target, 'signed-out', failures)
    samples.push({ label: 'signed-out', detail: `h=${probe.headerHeight} right=${probe.headerRight} controls=${probe.controlsRight} action=${probe.actionRight}` })
  } catch (error) {
    failures.push({ check: 'header/signed-out', detail: error.message })
  } finally {
    await signedOut.context.close().catch(() => {})
  }

  const signedIn = await newPage(browser, target, createBackend(), { signedIn: true })
  try {
    await signedIn.page.goto(`${BASE_URL}/app/chat/${CHAT_ID}`, { waitUntil: 'domcontentloaded' })
    await signedIn.page.waitForSelector('header', { timeout: 20000 })
    const probe = await signedIn.page.evaluate(probeHeader)
    checkHeader(probe, target, 'signed-in', failures)
    samples.push({ label: 'signed-in', detail: `h=${probe.headerHeight} controls=${probe.controlsRight} action=${probe.actionRight}` })
  } catch (error) {
    failures.push({ check: 'header/signed-in', detail: error.message })
  } finally {
    await signedIn.context.close().catch(() => {})
  }

  return { failures, samples }
}

/** Sync indicator: chat load, contacts sync, and a realtime-triggered refetch. */
async function auditSync(browser, target) {
  const failures = []
  const samples = []
  const backend = createBackend()
  const { context, page } = await newPage(browser, target, backend, { signedIn: true })

  try {
    // --- chat page content load -------------------------------------------
    backend.delays.messages = SYNC_DELAY_MS
    await page.goto(`${BASE_URL}/app/chat/${CHAT_ID}`, { waitUntil: 'domcontentloaded' })
    const duringLoad = await page
      .waitForSelector('[data-sync-pill="true"]', { timeout: 8000 })
      .then(() => page.evaluate(probeSync))
      .catch(() => null)
    if (!duringLoad) failures.push({ check: 'sync/chat-load', detail: 'indicator never appeared while the chat loaded' })
    else {
      if (!duringLoad.bar) failures.push({ check: 'sync/chat-load', detail: 'progress bar missing' })
      if (duringLoad.text !== 'Syncing messages…') failures.push({ check: 'sync/chat-load', detail: `label was ${JSON.stringify(duringLoad.text)}` })
      samples.push({ label: 'chat-load', detail: duringLoad.text })
    }
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 20000 })
    backend.delays.messages = 0
    const cleared = await waitFor(async () => !(await page.evaluate(probeSync)).pill, 8000)
    if (!cleared) failures.push({ check: 'sync/chat-load', detail: 'indicator never cleared after the chat loaded' })

    // --- realtime update triggers a refetch -------------------------------
    backend.delays.messages = SYNC_DELAY_MS
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-chat:updated')))
    const duringRealtime = await page
      .waitForSelector('[data-sync-pill="true"]', { timeout: 8000 })
      .then(() => page.evaluate(probeSync))
      .catch(() => null)
    if (!duringRealtime) failures.push({ check: 'sync/realtime', detail: 'indicator never appeared during a realtime refetch' })
    else {
      if (duringRealtime.text !== 'Syncing messages…') failures.push({ check: 'sync/realtime', detail: `label was ${JSON.stringify(duringRealtime.text)}` })
      samples.push({ label: 'realtime', detail: duringRealtime.text })
    }
    backend.delays.messages = 0
    await waitFor(async () => !(await page.evaluate(probeSync)).pill, 8000)

    // --- contacts sync -----------------------------------------------------
    backend.delays.contacts = SYNC_DELAY_MS
    await page.goto(`${BASE_URL}/app/contacts`, { waitUntil: 'domcontentloaded' })
    const duringContacts = await page
      .waitForSelector('[data-sync-pill="true"]', { timeout: 8000 })
      .then(() => page.evaluate(probeSync))
      .catch(() => null)
    if (!duringContacts) failures.push({ check: 'sync/contacts', detail: 'indicator never appeared while contacts synced' })
    else {
      if (duringContacts.text !== 'Syncing contacts…') failures.push({ check: 'sync/contacts', detail: `label was ${JSON.stringify(duringContacts.text)}` })
      samples.push({ label: 'contacts', detail: duringContacts.text })
    }
    backend.delays.contacts = 0
    await waitFor(async () => !(await page.evaluate(probeSync)).pill, 8000)
  } catch (error) {
    failures.push({ check: 'sync/session', detail: error.message })
  } finally {
    await context.close().catch(() => {})
  }

  return { failures, samples }
}

// A page-evaluable expression that reads the receipt indicator rendered on a bubble.
const ariaLabelExpr = (id) => `(document.getElementById('message-${id}')?.querySelector('svg[aria-label]')?.getAttribute('aria-label') || null)`

/** Read receipts end to end, with receipts both on and off. */
async function auditReceipts(browser, target, { receiptsEnabled }) {
  const failures = []
  const samples = []
  const backend = createBackend()
  const { context, page } = await newPage(browser, target, backend, {
    signedIn: true,
    prefs: receiptsEnabled ? {} : { readReceipts: false },
  })
  const label = receiptsEnabled ? 'on' : 'off'

  try {
    await page.goto(`${BASE_URL}/app/chat/${CHAT_ID}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 20000 })

    // --- own message starts as "Sent" -------------------------------------
    await page.fill('textarea[aria-label="Message"]', 'audit-out-1')
    await page.keyboard.press('Enter')
    const posted = await waitFor(() => backend.state.messages.some((m) => m.content === 'audit-out-1'), 8000)
    if (!posted) throw new Error('the sent message never reached the backend')
    const mine = backend.state.messages.find((m) => m.content === 'audit-out-1')

    const sentOk = await waitFor(
      () => page.evaluate(`${ariaLabelExpr(mine.id)} === 'Sent'`),
      8000,
    )
    if (!sentOk) {
      const actual = await page.evaluate(ariaLabelExpr(mine.id))
      failures.push({ check: `receipts/${label}/sent`, detail: `expected "Sent", got ${JSON.stringify(actual)}` })
    } else {
      samples.push({ label: `sent/${label}`, detail: 'Sent' })
    }

    // --- peer acknowledges: delivered, then read --------------------------
    backend.peerReceipt([mine.id], 'delivered')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-chat:updated')))
    const deliveredOk = await waitFor(
      () => page.evaluate(`${ariaLabelExpr(mine.id)} === 'Delivered'`),
      8000,
    )
    if (receiptsEnabled && !deliveredOk) {
      failures.push({ check: `receipts/${label}/delivered`, detail: 'delivered receipt was not reflected on the bubble' })
    }
    if (!receiptsEnabled && deliveredOk) {
      failures.push({ check: `receipts/${label}/delivered`, detail: 'delivery state shown even though receipts are off' })
    }
    if (receiptsEnabled && deliveredOk) samples.push({ label: `delivered/${label}`, detail: 'Delivered' })

    backend.peerReceipt([mine.id], 'read')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-chat:updated')))
    const readOk = await waitFor(
      () => page.evaluate(`${ariaLabelExpr(mine.id)} === 'Read'`),
      8000,
    )
    if (receiptsEnabled && !readOk) {
      failures.push({ check: `receipts/${label}/read`, detail: 'read receipt was not reflected on the bubble' })
    }
    if (!receiptsEnabled && readOk) {
      failures.push({ check: `receipts/${label}/read`, detail: 'read state shown even though receipts are off' })
    }
    if (receiptsEnabled && readOk) samples.push({ label: `read/${label}`, detail: 'Read' })

    // --- an incoming message is acknowledged automatically -----------------
    const incoming = backend.receive('audit-in-1')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-chat:updated')))
    await waitFor(() => page.evaluate(`Boolean(document.getElementById('message-${incoming.id}'))`), 8000)

    if (receiptsEnabled) {
      const acked = await waitFor(() => backend.selfReceiptsFor(incoming.id).length > 0, 8000)
      if (!acked) {
        failures.push({ check: `receipts/${label}/ack`, detail: 'incoming message was never acknowledged' })
      } else {
        const status = JSON.parse(backend.selfReceiptsFor(incoming.id)[0].content).status
        if (status !== 'read') failures.push({ check: `receipts/${label}/ack`, detail: `acknowledged as ${status}, expected read` })
        else samples.push({ label: `ack/${label}`, detail: 'read' })
      }
    } else {
      await sleep(1500)
      if (backend.selfReceiptsFor(incoming.id).length > 0) {
        failures.push({ check: `receipts/${label}/ack`, detail: 'a receipt was sent even though receipts are off' })
      } else {
        samples.push({ label: `ack/${label}`, detail: 'suppressed' })
      }
    }
  } catch (error) {
    failures.push({ check: `receipts/${label}`, detail: error.message })
  } finally {
    await context.close().catch(() => {})
  }

  return { failures, samples }
}

async function runSession(engine, target) {
  const browser = await engine.launcher.launch({ headless: true, ...(engine.options || {}) })
  try {
    const header = await auditHeader(browser, target)
    const sync = await auditSync(browser, target)
    const receiptsOn = await auditReceipts(browser, target, { receiptsEnabled: true })
    const receiptsOff = await auditReceipts(browser, target, { receiptsEnabled: false })
    return {
      engine: engine.name,
      viewport: target.name,
      failures: [...header.failures, ...sync.failures, ...receiptsOn.failures, ...receiptsOff.failures],
      samples: [...header.samples, ...sync.samples, ...receiptsOn.samples, ...receiptsOff.samples],
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

function report(result) {
  console.log(`${result.engine} @ ${result.viewport}: ${result.failures.length === 0 ? 'PASS' : 'FAIL'}`)
  console.log(result.samples.map(({ label, detail }) => `    ${label.padEnd(16)} ${detail}`).join('\n'))
  for (const failure of result.failures.slice(0, 8)) {
    console.log(`    !! ${failure.check}: ${failure.detail}`)
  }
  return result.failures.length === 0
}

async function main() {
  const engines = MATRIX ? ENGINES : ENGINES.slice(0, 1)
  await startServer()
  let ok = true
  try {
    for (const engine of engines) {
      for (const target of VIEWPORTS) {
        try {
          ok = report(await runSession(engine, target)) && ok
        } catch (error) {
          ok = false
          console.log(`${engine.name} @ ${target.name}: ERROR ${error.message}`)
        }
      }
    }
  } finally {
    stopServer()
  }
  console.log(`\n${ok ? 'UX AUDIT PASSED' : 'UX AUDIT FAILED'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  stopServer()
  console.error(error)
  process.exit(1)
})
