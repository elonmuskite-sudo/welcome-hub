import test from 'node:test'
import assert from 'node:assert/strict'
import {
  R2_MAX_UPLOAD_BYTES,
  R2_UPLOAD_THRESHOLD_BYTES,
  R2_URL_PREFIX,
  isR2Reference,
  r2KeyOwner,
  r2KeyScope,
  r2ObjectKeyOf,
  r2Reference,
  shouldUseR2,
} from '../src/lib/storageReferences.js'

const OWNER = '3f1a0c62-2b1e-4a8f-9d1c-5e7b0a4c8d21'

test('the upload threshold sits at exactly two megabytes', () => {
  assert.equal(R2_UPLOAD_THRESHOLD_BYTES, 2 * 1024 * 1024)
  assert.equal(R2_MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
})

test('files at or below the threshold stay on Supabase Storage', () => {
  assert.equal(shouldUseR2(0), false)
  assert.equal(shouldUseR2(1024), false)
  assert.equal(shouldUseR2(R2_UPLOAD_THRESHOLD_BYTES), false)
})

test('files above the threshold route to R2', () => {
  assert.equal(shouldUseR2(R2_UPLOAD_THRESHOLD_BYTES + 1), true)
  assert.equal(shouldUseR2(R2_MAX_UPLOAD_BYTES), true)
})

test('the size check tolerates numeric strings and missing values', () => {
  assert.equal(shouldUseR2(String(R2_UPLOAD_THRESHOLD_BYTES + 1)), true)
  assert.equal(shouldUseR2(String(R2_UPLOAD_THRESHOLD_BYTES)), false)
  assert.equal(shouldUseR2(undefined), false)
  assert.equal(shouldUseR2(null), false)
})

test('a reference prefixes the object key with the r2 scheme', () => {
  const key = `${OWNER}/feed/1715000000-clip.mp4`
  assert.equal(r2Reference(key), `${R2_URL_PREFIX}${key}`)
})

test('only non-empty r2 references are recognised', () => {
  assert.equal(isR2Reference(`${R2_URL_PREFIX}${OWNER}/direct/x.png`), true)
  assert.equal(isR2Reference(R2_URL_PREFIX), false)
  assert.equal(isR2Reference(''), false)
  assert.equal(isR2Reference(undefined), false)
  assert.equal(isR2Reference(null), false)
  assert.equal(isR2Reference('https://cdn.example.com/x.png'), false)
})

test('the object key is extracted without the scheme prefix', () => {
  const key = `${OWNER}/chat-1/1715000000-photo.jpg`
  assert.equal(r2ObjectKeyOf(`${R2_URL_PREFIX}${key}`), key)
  assert.equal(r2ObjectKeyOf('https://cdn.example.com/x.png'), null)
  assert.equal(r2ObjectKeyOf(undefined), null)
})

test('owner and scope are the first two key segments', () => {
  const key = `${OWNER}/feed/1715000000-clip.mp4`
  assert.equal(r2KeyOwner(key), OWNER)
  assert.equal(r2KeyScope(key), 'feed')
  assert.equal(r2KeyScope(`${OWNER}/direct/x.png`), 'direct')
  assert.equal(r2KeyOwner(''), '')
  assert.equal(r2KeyScope(undefined), '')
})
