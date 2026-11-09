#!/usr/bin/env node
/**
 * Reproduction + regression harness for the "chat composer disappears" report.
 *
 * It drives the *real* built app (`dist/`) against a mocked Supabase backend so
 * two users can exchange messages through the production code path:
 *
 *   typing in the composer → MessageInput.submit → ChatView.handleSendMessage
 *   → sendChatMessage() → appendMessage() → 'nexus-chat:updated'
 *   → ChatPage.syncChat() → getChatById() → setChat()
 *
 * Sent messages go through the UI. Received messages replay exactly what the
 * realtime INSERT handler does (`appendMessage` + the incoming-notification
 * event), after being persisted in the mock backend so the refetch sees them.
 *
 * After every single exchange it asserts that the composer's textarea still
 * exists, is visible, is inside the viewport, is hit-testable (nothing painted
 * over it), enabled, and that the chat surface has not fallen back to an error
 * screen or an empty root. Once the thread is long it then drives the emoji
 * picker and a real attachment upload (mocked storage) and re-asserts.
 *
 * Usage:
 *   node scripts/chat-input-repro.mjs                 # chromium, 390x844, 30 exchanges
 *   node scripts/chat-input-repro.mjs --tablet        # chromium, 768x1024, 30 exchanges
 *   node scripts/chat-input-repro.mjs --matrix        # 5 engines x 3 viewports
 *   REPRO_EXCHANGES=40 node scripts/chat-input-repro.mjs
 */

import { chromium, firefox, webkit } from 'playwright'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.REPRO_PORT || 4177)
const BASE_URL = `http://localhost:${PORT}`
const PROJECT_REF = 'woavhlkgylarngqyvphf'
const SUPABASE_MATCH = `**/${PROJECT_REF}.supabase.co/**`
const SESSION_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`
const CHAT_STORAGE_KEY = 'nexus-chat-state-v1'
const EXCHANGES = Number(process.env.REPRO_EXCHANGES || 30)
const MATRIX = process.argv.includes('--matrix')
const TABLET_ONLY = process.argv.includes('--tablet')

// Fixed UUIDs so the Supabase code paths (which validate UUIDs) stay active.
const SELF = { id: '11111111-1111-4111-8111-111111111111', email: 'repro.a@example.com' }
const PEER_ID = '22222222-2222-4222-8222-222222222222'
const CHAT_ID = '33333333-3333-4333-8333-333333333333'

const TOLERANCE = 1

// 1x1 transparent PNG — enough for the attachment validation to accept it.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

function buildSession() {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: 'repro.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 60 * 60 * 24 * 365,
    refresh_token: 'repro.refresh.token',
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
  const state = {
    messages: [],
    chat: {
      id: CHAT_ID,
      title: 'Repro conversation',
      type: 'private',
      avatar_url: null,
      encrypted: false,
      owner_id: SELF.id,
      created_at: '2026-01-01T00:00:00.000Z',
      participant_names: ['Repro A', 'Repro B'],
      chat_members: [{ profile_id: SELF.id }, { profile_id: PEER_ID }],
    },
    profile: {
      id: SELF.id,
      member_id: '1012345678',
      first_name: 'Repro',
      last_name: 'A',
      full_name: 'Repro A',
      avatar_url: null,
      bio: '',
      interests: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }

  let sequence = 0
  const nextId = () => {
    sequence += 1
    const suffix = String(sequence).padStart(12, '0')
    return `44444444-4444-4444-8444-${suffix}`
  }
  const nextTimestamp = () => new Date(Date.now() + sequence).toISOString()

  return {
    state,
    /** A message from the other participant, as the realtime handler would see it. */
    receive(text) {
      const message = {
        id: nextId(),
        chat_id: CHAT_ID,
        sender_id: PEER_ID,
        content: text,
        type: 'text',
        file_url: null,
        file_name: null,
        duration: null,
        encrypted: false,
        created_at: nextTimestamp(),
      }
      state.messages.push(message)
      return message
    },
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const accept = request.headers()['accept'] || ''
      const wantsObject = accept.includes('vnd.pgrst.object+json')
      const json = (body, status = 200) => route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
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
      if (path.includes('/rest/v1/chats')) return rows([state.chat])
      if (path.includes('/rest/v1/messages')) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON()
          const list = Array.isArray(body) ? body : [body]
          for (const item of list) {
            if (!state.messages.some((m) => String(m.id) === String(item.id))) state.messages.push(item)
          }
          return route.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
        }
        return json(state.messages)
      }
      if (path.includes('/rest/v1/')) {
        if (request.method() === 'GET') return rows([])
        return route.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
      }

      // Attachment uploads: storage-js reads `data.url` from the sign endpoint
      // and prefixes its own base URL, then PUTs the bytes to that signed URL.
      if (path.includes('/storage/v1/object/upload/sign/')) {
        const relative = `${url.pathname.split('/storage/v1').pop()}?token=repro-upload-token`
        return json({ url: relative, signedUrl: `${url.origin}${relative}`, token: 'repro-upload-token' })
      }
      if (path.includes('/storage/v1/object/sign/')) {
        const relative = `${url.pathname.split('/storage/v1').pop()}?token=repro-read-token`
        return json({ signedURL: relative })
      }
      if (path.includes('/storage/v1/')) {
        if (request.method() === 'PUT') {
          return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
        }
        return json({})
      }
      if (path.includes('/functions/v1/')) return json({ ok: true })
      return json({})
    },
  }
}

// ---------------------------------------------------------------------------
// Browser-side probe (serialised by page.evaluate — must stay self-contained)
// ---------------------------------------------------------------------------

function probeComposer() {
  const el = document.querySelector('textarea[aria-label="Message"]')
  const root = document.getElementById('root')
  const result = {
    found: Boolean(el),
    composerPresent: Boolean(document.querySelector('.chat-composer')),
    messageCount: document.querySelectorAll('[id^="message-"]').length,
    rootEmpty: !root || root.childElementCount === 0,
    errorScreen: document.body.innerText.includes('Error loading chat'),
    loadingScreen: document.body.innerText.includes('Loading chat...'),
  }
  if (!el) return result

  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  const centerX = Math.round(rect.left + rect.width / 2)
  const centerY = Math.round(rect.top + rect.height / 2)
  const topmost = document.elementFromPoint(centerX, centerY)
  result.width = Math.round(rect.width)
  result.height = Math.round(rect.height)
  result.top = Math.round(rect.top)
  result.bottom = Math.round(rect.bottom)
  result.viewportHeight = window.innerHeight
  result.disabled = Boolean(el.disabled)
  result.inputMode = el.getAttribute('inputmode')
  result.readOnly = Boolean(el.readOnly)
  result.display = style.display
  result.visibility = style.visibility
  result.opacity = style.opacity
  result.visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
  result.insideViewport = rect.top >= -1 && rect.bottom <= window.innerHeight + 1
  result.hitTestable = Boolean(topmost) && (topmost === el || el.contains(topmost) || topmost.contains(el))
  result.ok = result.found && result.visible && result.insideViewport && result.hitTestable
    && !result.disabled && result.inputMode === 'none' && !result.readOnly
    && !result.errorScreen && !result.loadingScreen && !result.rootEmpty
  return result
}

// ---------------------------------------------------------------------------
// Runner
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
    await new Promise((resolve) => setTimeout(resolve, 250))
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

const VIEWPORTS = MATRIX
  ? [
      { name: 'mobile-390x844', viewport: { width: 390, height: 844 } },
      { name: 'tablet-768x1024', viewport: { width: 768, height: 1024 } },
      { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
    ]
  : TABLET_ONLY
    ? [{ name: 'tablet-768x1024', viewport: { width: 768, height: 1024 } }]
  : [{ name: 'mobile-390x844', viewport: { width: 390, height: 844 } }]

function summarise(probe) {
  if (!probe) return 'no probe'
  if (!probe.found) {
    const reasons = []
    if (probe.errorScreen) reasons.push('error screen')
    if (probe.loadingScreen) reasons.push('loading screen')
    if (probe.rootEmpty) reasons.push('empty #root')
    if (probe.composerPresent) reasons.push('composer present but textarea gone')
    return `textarea gone (${reasons.join(', ') || 'composer unmounted'})`
  }
  const reasons = []
  if (!probe.visible) reasons.push(`invisible (${probe.width}x${probe.height})`)
  if (!probe.insideViewport) reasons.push(`off-screen (top ${probe.top}, bottom ${probe.bottom} of ${probe.viewportHeight})`)
  if (!probe.hitTestable) reasons.push('covered by another element')
  if (probe.disabled) reasons.push('disabled')
  if (probe.inputMode !== 'none') reasons.push(`inputmode is ${probe.inputMode || 'missing'}`)
  if (probe.readOnly) reasons.push('read-only')
  return reasons.length ? reasons.join('; ') : 'ok'
}

// Exercises the emoji affordance: open the picker through the real button,
// insert an emoji through emoji-mart's own button (inside its shadow root), and
// confirm the composer is intact once the panel closes.
async function exerciseEmoji(page) {
  try {
    await page.locator('button[title="Emoji"]').click({ timeout: 10000 })
    await page.waitForSelector('.chat-emoji-picker em-emoji-picker', { timeout: 15000 })
    await page.waitForFunction(
      () => {
        const buttons = document.querySelector('em-emoji-picker')?.shadowRoot?.querySelectorAll('button[aria-label]')
        // Category buttons carry a text title; emoji buttons carry the glyph.
        return Array.from(buttons || []).some((button) => (button.getAttribute('aria-label') || '').length <= 8)
      },
      null,
      { timeout: 15000 },
    )
    const emojiSearchMode = await page.evaluate(() => (
      document.querySelector('em-emoji-picker')?.shadowRoot?.querySelector('input')?.getAttribute('inputmode')
    ))
    if (emojiSearchMode !== 'none') {
      return {
        step: 'emoji search keyboard mode',
        detail: `expected inputmode=none, got ${emojiSearchMode || 'no search input'}`,
        probe: await page.evaluate(probeComposer),
      }
    }

    const before = await page.inputValue('textarea[aria-label="Message"]')
    await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelector('em-emoji-picker').shadowRoot.querySelectorAll('button[aria-label]'),
      )
      buttons.find((button) => (button.getAttribute('aria-label') || '').length <= 8).click()
    })
    await page.waitForFunction(
      (previous) => document.querySelector('textarea[aria-label="Message"]').value !== previous,
      before,
      { timeout: 10000 },
    )

    const after = await page.inputValue('textarea[aria-label="Message"]')
    if (!after || after === before) {
      return { step: 'emoji insert', detail: 'no emoji reached the composer', probe: await page.evaluate(probeComposer) }
    }

    await page.keyboard.press('Escape')
    await page.waitForSelector('.chat-emoji-picker', { state: 'detached', timeout: 10000 }).catch(() => {})
    await page.fill('textarea[aria-label="Message"]', '')

    const probe = await page.evaluate(probeComposer)
    return probe.ok ? null : { step: 'emoji insert', detail: summarise(probe), probe }
  } catch (error) {
    return { step: 'emoji insert', detail: error.message, probe: await page.evaluate(probeComposer).catch(() => null) }
  }
}

// Exercises the attachment affordance end to end: validate → signed upload →
// register the file → sign a read URL → virus-scan hook → send the message.
async function exerciseAttachment(page, backend) {
  try {
    const expected = backend.state.messages.length + 1
    await page.locator('.chat-composer input[type="file"]').setInputFiles({
      name: 'repro-image.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    })
    await page.waitForFunction(
      (count) => document.querySelectorAll('[id^="message-"]').length >= count,
      expected,
      { timeout: 20000 },
    ).catch(() => {})

    const probe = await page.evaluate(probeComposer)
    if (backend.state.messages.length < expected) {
      const alert = await page.evaluate(() => document.querySelector('[role="alert"]')?.innerText || '')
      return { step: 'attachment upload', detail: `no message was sent${alert ? ` — ${alert}` : ''}`, probe }
    }
    return probe.ok ? null : { step: 'attachment upload', detail: summarise(probe), probe }
  } catch (error) {
    return { step: 'attachment upload', detail: error.message, probe: await page.evaluate(probeComposer).catch(() => null) }
  }
}

async function runSession(engine, target) {
  const backend = createBackend()
  const browser = await engine.launcher.launch({ headless: true, ...(engine.options || {}) })
  const context = await browser.newContext({ viewport: target.viewport, serviceWorkers: 'block' })

  const pageErrors = []
  const consoleErrors = []

  try {
    // Realtime is not part of the reproduction: hold the socket open so the
    // client never reaches the real project.
    if (typeof context.routeWebSocket === 'function') {
      await context.routeWebSocket(/\/realtime\/v1\//, () => {})
    }
    await context.route(SUPABASE_MATCH, (route) => backend.handle(route))
    await context.route('**/api/data/scan-file', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ status: 'unavailable', detail: 'repro harness' }),
    }))
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key, JSON.stringify(session)),
      [SESSION_STORAGE_KEY, buildSession()],
    )

    const page = await context.newPage()
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(`${BASE_URL}/app/chat/${CHAT_ID}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 25000 })

    const baseline = await page.evaluate(probeComposer)
    const failures = []
    const samples = [{ step: 'start', probe: baseline }]
    const composer = page.locator('textarea[aria-label="Message"]')
    await composer.focus()
    await page.keyboard.type('physical keyboard check')
    const physicalTyping = await composer.inputValue()
    const physicalTypingProbe = await page.evaluate(probeComposer)
    if (physicalTyping !== 'physical keyboard check' || !physicalTypingProbe.ok) {
      failures.push({
        step: 'physical keyboard typing',
        detail: physicalTyping !== 'physical keyboard check'
          ? 'physical keyboard input did not reach the composer'
          : summarise(physicalTypingProbe),
        probe: physicalTypingProbe,
      })
    }
    await composer.fill('')

    for (let index = 1; index <= EXCHANGES; index += 1) {
      // --- user sends -------------------------------------------------------
      const outgoing = `repro-out-${index}`
      await page.locator('textarea[aria-label="Message"]').fill(outgoing)
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes('/rest/v1/messages') && response.request().method() === 'POST',
          { timeout: 10000 },
        ).catch(() => null),
        page.locator('textarea[aria-label="Message"]').press('Enter'),
      ])
      await page.waitForFunction(
        (expected) => document.querySelectorAll('[id^="message-"]').length >= expected,
        backend.state.messages.length,
        { timeout: 10000 },
      ).catch(() => {})

      const afterSend = await page.evaluate(probeComposer)
      if (!afterSend.ok) failures.push({ step: `send #${index}`, detail: summarise(afterSend), probe: afterSend })
      if (index <= 3 || index % 5 === 0) samples.push({ step: `send #${index}`, probe: afterSend })
      if (!afterSend.found) break

      // --- the other user replies ------------------------------------------
      const incoming = backend.receive(`repro-in-${index}`)
      await page.evaluate(
        ([key, chatId, message]) => {
          try {
            const all = JSON.parse(window.localStorage.getItem(key) || '[]')
            const position = all.findIndex((item) => String(item.id) === String(chatId))
            if (position >= 0) {
              const chat = all[position]
              const messages = Array.isArray(chat.messages) ? chat.messages : []
              if (!messages.some((item) => String(item.id) === String(message.id))) {
                chat.messages = [...messages, message]
              }
              chat.last_message = message.content
              chat.last_message_time = message.created_at
              window.localStorage.setItem(key, JSON.stringify(all))
            }
          } catch {
            // localStorage is best effort; the refetch below is authoritative
          }
          window.dispatchEvent(new CustomEvent('nexus-chat:updated'))
          window.dispatchEvent(
            new CustomEvent('nexus:incoming-notification', {
              detail: { id: message.id, title: 'New message', preview: message.content, type: 'message' },
            }),
          )
        },
        [CHAT_STORAGE_KEY, CHAT_ID, incoming],
      )
      await page.waitForFunction(
        (expected) => document.querySelectorAll('[id^="message-"]').length >= expected,
        backend.state.messages.length,
        { timeout: 10000 },
      ).catch(() => {})

      const afterReceive = await page.evaluate(probeComposer)
      if (!afterReceive.ok) failures.push({ step: `receive #${index}`, detail: summarise(afterReceive), probe: afterReceive })
      if (index <= 3 || index % 5 === 0) samples.push({ step: `receive #${index}`, probe: afterReceive })
      if (!afterReceive.found) break
    }

    // --- the other composer affordances, on the now-long thread ------------
    for (const [step, check] of [['emoji insert', exerciseEmoji], ['attachment upload', exerciseAttachment]]) {
      if (!(await page.locator('textarea[aria-label="Message"]').count())) {
        failures.push({ step, detail: 'textarea already gone before the check', probe: null })
        break
      }
      const failure = await check(page, backend)
      if (failure) failures.push(failure)
      else samples.push({ step, probe: await page.evaluate(probeComposer) })
    }

    return {
      engine: engine.name,
      viewport: target.name,
      exchanges: EXCHANGES,
      messages: backend.state.messages.length,
      failures,
      samples,
      pageErrors,
      consoleErrors: consoleErrors.filter((text) => !/websocket|realtime|Failed to fetch/i.test(text)),
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

function report(result) {
  const head = `${result.engine} @ ${result.viewport}`
  const traces = result.samples
    .map(({ step, probe }) => {
      if (!probe?.found) return `    ${step.padEnd(14)} MISSING (${summarise(probe)})`
      return `    ${step.padEnd(14)} h=${String(probe.height).padStart(3)} top=${String(probe.top).padStart(4)} bottom=${String(probe.bottom).padStart(4)} messages=${probe.messageCount}`
    })
    .join('\n')
  console.log(`${head}: ${result.failures.length === 0 ? 'PASS' : 'FAIL'} (${result.messages} messages on the server)`)
  console.log(traces)
  for (const failure of result.failures.slice(0, 5)) {
    console.log(`    !! ${failure.step}: ${failure.detail}`)
    console.log(`       probe=${JSON.stringify(failure.probe)}`)
  }
  if (result.pageErrors.length) {
    console.log(`    page errors: ${result.pageErrors.slice(0, 3).join(' | ')}`)
  }
  if (result.consoleErrors.length) {
    console.log(`    console errors: ${result.consoleErrors.slice(0, 3).join(' | ')}`)
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
          const result = await runSession(engine, target)
          ok = report(result) && ok
        } catch (error) {
          ok = false
          console.log(`${engine.name} @ ${target.name}: ERROR ${error.message}`)
        }
      }
    }
  } finally {
    stopServer()
  }
  console.log(`\n${ok ? 'COMPOSER STABLE' : 'COMPOSER REGRESSION DETECTED'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  stopServer()
  console.error(error)
  process.exit(1)
})
