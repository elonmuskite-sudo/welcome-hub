import { test } from 'node:test'
import assert from 'node:assert/strict'
import { welcomeTemplate } from '../supabase/functions/_shared/welcome-template.js'
test('welcome email escapes names, has a GIF, accessible fallback and fixed account link', () => {
  const result = welcomeTemplate({ name: '<script>bad</script>', appUrl: 'https://example.com' })
  assert.ok(!result.html.includes('<script>'))
  assert.match(result.html, /&lt;script&gt;/)
  assert.match(result.html, /nexus-welcome.gif/)
  assert.match(result.html, /alt="Nexus/)
  assert.match(result.html, /https:\/\/example.com\/app/)
  assert.match(result.text, /Your email is verified/)
})
test('welcome template rejects insecure URLs and handles absent names', () => {
  assert.throws(() => welcomeTemplate({ appUrl: 'http://example.com' }))
  assert.match(welcomeTemplate({ appUrl: 'https://example.com' }).html, /Welcome to Nexus/)
})