#!/usr/bin/env node
/**
 * Minimal static server for the built SPA in `dist/`.
 *
 * `vite preview` boots the Cloudflare plugin (Miniflare/wrangler) which needs
 * write access to ~/.wrangler; this serves the same output with no extra
 * dependency and with the SPA history fallback the audit needs.
 *
 * Usage: node scripts/serve-dist.mjs [port]
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const PORT = Number(process.argv[2] || process.env.PORT || 4173)
const ROOT = resolve('dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function readIfFile(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return await readFile(path)
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const requested = join(ROOT, relative)

  let body = await readIfFile(requested)
  let filePath = requested

  // Directory or extensionless route -> fall back to the SPA entry point.
  if (!body && !extname(relative)) {
    filePath = join(ROOT, 'index.html')
    body = await readIfFile(filePath)
  }

  if (!body) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  response.end(body)
})

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}/`)
})
