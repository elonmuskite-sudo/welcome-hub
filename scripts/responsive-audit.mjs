#!/usr/bin/env node
/**
 * Responsive layout audit.
 *
 * Loads every public (unauthenticated) route at the project's target viewports
 * in Chromium, Firefox, WebKit and — when Edge is installed — the Edge channel,
 * then asserts two layout invariants per page:
 *
 *   1. No horizontal overflow: the document must not be wider than the
 *      viewport, i.e. `documentElement.scrollWidth <= innerWidth`.
 *   2. No clipped overlay: every fixed/absolute box that is not clipped by an
 *      ancestor with `overflow-x` other than `visible` must sit inside the
 *      viewport box on both the left and right edge.
 *
 * Auth-gated surfaces (chat, settings, feeds, admin dashboards, the emoji
 * picker and the other modals) require a signed-in session and are therefore
 * outside the reach of an anonymous run; they are not covered here.
 *
 * Usage:
 *   node scripts/responsive-audit.mjs
 *
 * Serves dist/ on :4173 for the duration of the run. Set AUDIT_BASE_URL to
 * point the audit at an already-running server instead.
 */

import { chromium, firefox, webkit } from 'playwright'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://localhost:4173'
const NAV_TIMEOUT = 15000
const TOLERANCE = 1 // px, absorbs sub-pixel rounding

// When no external base URL is supplied the audit hosts dist/ itself, so a
// stray server shutdown cannot be mistaken for a layout failure.
let hostedServer = null

async function startServer() {
  if (process.env.AUDIT_BASE_URL) return
  const script = fileURLToPath(new URL('./serve-dist.mjs', import.meta.url))
  hostedServer = spawn(process.execPath, [script, new URL(BASE_URL).port || '4173'], {
    stdio: 'ignore',
  })
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

async function stopServer() {
  if (hostedServer) hostedServer.kill()
}

const VIEWPORTS = [
  { label: '360x640', width: 360, height: 640 },
  { label: '375x667', width: 375, height: 667 },
  { label: '425x812', width: 425, height: 812 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '1024x768', width: 1024, height: 768 },
  { label: '1280x800', width: 1280, height: 800 },
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1920x1080', width: 1920, height: 1080 },
]

const ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/verify-email',
  '/reset-password',
  '/admin/login',
  '/a-route-that-does-not-exist',
]

// The bundled Chromium/Firefox/WebKit builds are downloaded on demand; the
// channel entries target browsers that are already installed on the machine,
// so the audit still runs when the download is unavailable.
//
// Firefox refuses to start where the process cannot write to %APPDATA%\Mozilla
// (locked-down/sandboxed shells), so its profile directories are redirected to
// a scratch folder inside node_modules.
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

// Runs inside the page (serialised by page.evaluate), so it must be fully
// self-contained: no references to anything defined in this module's scope.
function probeLayout() {
  const TOLERANCE_PX = 1 // absorbs sub-pixel rounding
  const doc = document.documentElement
  const viewportWidth = window.innerWidth
  const overflow = doc.scrollWidth - viewportWidth

  const clippedByAncestor = (element) => {
    let parent = element.parentElement
    while (parent && parent !== doc) {
      const overflowX = getComputedStyle(parent).overflowX
      if (overflowX !== 'visible') return true
      parent = parent.parentElement
    }
    return false
  }

  const offenders = []
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const autoScrollable = style.overflowX !== 'visible'
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    const outLeft = box.left < -TOLERANCE_PX
    const outRight = box.right > viewportWidth + TOLERANCE_PX
    if (!outLeft && !outRight) continue
    if (autoScrollable || clippedByAncestor(element)) continue
    offenders.push({
      selector: describe(element),
      left: Math.round(box.left),
      right: Math.round(box.right),
    })
    if (offenders.length >= 6) break
  }

  return { viewportWidth, overflow, offenders }

  function describe(element) {
    const id = element.id ? `#${element.id}` : ''
    const classes = (element.className && typeof element.className === 'string')
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : ''
    return `${element.tagName.toLowerCase()}${id}${classes}`
  }
}

async function runEngine(engine) {
  const label = engine.name
  let browser
  try {
    browser = await engine.launcher.launch({ headless: true, ...(engine.options || {}) })
  } catch (error) {
    return { label, skipped: true, reason: error.message.split('\n')[0] }
  }

  const failures = []
  const crashes = []
  let checks = 0

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    })
    const page = await context.newPage()

    for (const route of ROUTES) {
      checks += 1
      const url = `${BASE_URL}${route}`
      let pageErrors = []
      const onPageError = (error) => pageErrors.push(error.message)
      page.on('pageerror', onPageError)

      try {
        await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT })
        await page.waitForTimeout(500)
        const result = await page.evaluate(probeLayout)
        if (result.overflow > TOLERANCE) {
          failures.push({ viewport: viewport.label, route, kind: 'horizontal overflow', detail: `+${result.overflow}px`, offenders: result.offenders })
        } else if (result.offenders.length) {
          failures.push({ viewport: viewport.label, route, kind: 'box outside viewport', detail: `${result.offenders.length} element(s)`, offenders: result.offenders })
        }
      } catch (error) {
        crashes.push({ viewport: viewport.label, route, detail: error.message.split('\n')[0] })
      } finally {
        page.off('pageerror', onPageError)
      }

      if (pageErrors.length) {
        crashes.push({ viewport: viewport.label, route, detail: `pageerror: ${pageErrors[0]}` })
        pageErrors = []
      }
    }

    await context.close()
  }

  await browser.close()
  return { label, skipped: false, failures, crashes, checks }
}

function report(results) {
  console.log(`\nResponsive audit against ${BASE_URL}`)
  console.log(`${VIEWPORTS.length} viewports x ${ROUTES.length} public routes per engine\n`)

  let totalFailures = 0
  let totalCrashes = 0

  for (const result of results) {
    if (result.skipped) {
      console.log(`- ${result.label.padEnd(9)} SKIPPED (${result.reason})`)
      continue
    }
    totalFailures += result.failures.length
    totalCrashes += result.crashes.length
    const status = result.failures.length === 0 && result.crashes.length === 0 ? 'PASS' : 'FAIL'
    console.log(`- ${result.label.padEnd(9)} ${status}  ${result.checks} checks  ${result.failures.length} layout, ${result.crashes.length} error`)

    for (const failure of result.failures) {
      console.log(`    ! ${failure.viewport} ${failure.route} -> ${failure.kind} (${failure.detail})`)
      for (const offender of failure.offenders) {
        console.log(`        ${offender.selector}  left=${offender.left} right=${offender.right}`)
      }
    }
    for (const crash of result.crashes) {
      console.log(`    x ${crash.viewport} ${crash.route} -> ${crash.detail}`)
    }
  }

  console.log(`\nTotals: ${totalFailures} layout failure(s), ${totalCrashes} page error(s)`)
  return totalFailures + totalCrashes
}

await startServer()

const results = []
for (const engine of ENGINES) {
  process.stdout.write(`Running ${engine.name}... `)
  const result = await runEngine(engine)
  console.log(result.skipped ? 'skipped' : 'done')
  results.push(result)
}

await stopServer()
const problems = report(results)
process.exit(problems === 0 ? 0 : 1)
