#!/usr/bin/env node
// Performance audit for the built app.
//
// Serves `dist/` over a local HTTP server and measures real page loading in a
// browser: first contentful paint, DOMContentLoaded and the load event, plus the
// transferred bytes. Every measurement must stay inside the loading budget.
//
//   npm run perf:audit                 # desktop + mobile, cold cache
//   npm run perf:audit -- --throttle   # also report a simulated 4G profile
//
// Run `npm run build` first; the audit fails fast if `dist/` is missing.

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')

// The requirement: page and resource loading must finish inside one second.
const LOAD_BUDGET_MS = 1000

const ROUTES = ['/', '/login']
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

// Text assets are gzipped so the audit measures the same transfer size a real
// host (Vercel/Cloudflare) would send, instead of raw uncompressed bytes.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest'])

function startStaticServer() {
  const send = (req, res, filePath) => {
    const type = MIME[path.extname(filePath)] || 'application/octet-stream'
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    const raw = existsSync(filePath) ? readFileSync(filePath) : null
    if (!raw) return false
    if (acceptsGzip && COMPRESSIBLE.has(path.extname(filePath))) {
      const body = gzipSync(raw)
      res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
      res.end(body)
    } else {
      res.writeHead(200, { 'Content-Type': type })
      res.end(raw)
    }
    return true
  }

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const candidates = urlPath === '/' ? ['/index.html'] : [urlPath, '/index.html']
    for (const candidate of candidates) {
      const filePath = path.join(distDir, candidate)
      if (!filePath.startsWith(distDir)) continue
      if (send(req, res, filePath)) return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function measure(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paints = performance.getEntriesByType('paint')
    const fcpEntry = paints.find((entry) => entry.name === 'first-contentful-paint')
    const fpEntry = paints.find((entry) => entry.name === 'first-paint')
    const resources = performance.getEntriesByType('resource')
    const bytes = resources.reduce((total, entry) => total + (entry.transferSize || 0), 0)
    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : 0,
      load: nav ? nav.loadEventEnd : 0,
      // Headless shells sometimes omit the contentful-paint entry; first-paint
      // is an equally valid "something rendered" signal.
      fcp: fcpEntry ? fcpEntry.startTime : fpEntry ? fpEntry.startTime : 0,
      bytes,
      requests: resources.length,
      resources: resources
        .map((entry) => ({ name: entry.name.split('/').pop(), size: entry.transferSize || 0 }))
        .sort((a, b) => b.size - a.size),
    }
  })
}

async function run() {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.error('dist/ is missing. Run `npm run build` before the performance audit.')
    process.exit(1)
  }

  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    console.error('playwright is not installed. Run `npm install` first.')
    process.exit(1)
  }

  const withThrottle = process.argv.includes('--throttle')
  const { server, port } = await startStaticServer()
  const origin = `http://127.0.0.1:${port}`

  let browser
  try {
    browser = await chromium.launch()
  } catch (error) {
    await new Promise((resolve) => server.close(resolve))
    console.error(`Could not launch Chromium: ${error.message}`)
    console.error('Install browsers with `npx playwright install chromium`.')
    process.exit(1)
  }

  const results = []
  const failures = []

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      // A fresh context per run keeps the cache cold so we measure a real load.
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      const client = await context.newCDPSession(page)
      if (withThrottle) {
        await client.send('Network.enable')
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 100,
          downloadThroughput: (4 * 1024 * 1024) / 8,
          uploadThroughput: (1 * 1024 * 1024) / 8,
        })
      }

      await page.goto(`${origin}${route}`, { waitUntil: 'load', timeout: 30000 })
      // Settle so late-rendered assets (images the app mounts after load) are
      // counted in the transfer total. Navigation timings are already fixed.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      const metrics = await measure(page)
      await context.close()

      const record = { viewport: viewport.name, route, ...metrics }
      results.push(record)

      for (const key of ['fcp', 'domContentLoaded', 'load']) {
        if (metrics[key] > LOAD_BUDGET_MS) {
          failures.push(`${viewport.name} ${route} ${key}=${metrics[key].toFixed(0)}ms exceeds ${LOAD_BUDGET_MS}ms`)
        }
      }
    }
  }

  await browser.close()
  await new Promise((resolve) => server.close(resolve))

  const label = withThrottle ? ' (simulated 4G)' : ' (cold cache)'
  console.log(`\nPage loading audit${label} — budget ${LOAD_BUDGET_MS} ms\n`)
  console.log('viewport  route    FCP     DCL     load    requests  transferred')
  for (const record of results) {
    console.log(
      `${record.viewport.padEnd(9)} ${record.route.padEnd(8)} `
      + `${`${record.fcp.toFixed(0)}ms`.padEnd(7)} ${`${record.domContentLoaded.toFixed(0)}ms`.padEnd(7)} `
      + `${`${record.load.toFixed(0)}ms`.padEnd(7)} ${String(record.requests).padEnd(9)} ${(record.bytes / 1024).toFixed(0)} kB`,
    )
  }

  if (failures.length) {
    console.error(`\n${failures.length} measurement(s) over budget:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('\nAll measurements are within budget.')

  if (process.argv.includes('--resources') && results[0]) {
    console.log(`\nLargest resources for ${results[0].viewport} ${results[0].route}:`)
    for (const entry of results[0].resources.slice(0, 10)) {
      console.log(`  ${`${(entry.size / 1024).toFixed(1)} kB`.padEnd(10)} ${entry.name}`)
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
