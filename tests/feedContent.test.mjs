import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FEED_COMMENT_MAX_LENGTH,
  FEED_MEDIA_MAX_ITEMS,
  FEED_POST_MAX_LENGTH,
  feedVisibilityFilter,
  isSafeMediaUrl,
  normalizeFeedMedia,
  sanitizeFeedText,
} from '../src/lib/feedContent.js'

const UUID = '3f1a0c62-2b1e-4a8f-9d1c-5e7b0a4c8d21'

test('feed text keeps normal content and trims the edges', () => {
  const raw = 'Hello Nexus!\nSecond line with\ttabs.'
  assert.equal(sanitizeFeedText(raw, FEED_POST_MAX_LENGTH), raw)
  assert.equal(sanitizeFeedText('   padded post   ', FEED_POST_MAX_LENGTH), 'padded post')
})

test('feed text strips control characters and runaway blank lines', () => {
  const hostile = `start\u0000\u0007\u001f middle\u007f\n\n\n\n\nend`
  assert.equal(sanitizeFeedText(hostile, FEED_POST_MAX_LENGTH), 'start middle\n\n\nend')
  assert.equal(sanitizeFeedText('crlf\r\nline\rcarriage', FEED_POST_MAX_LENGTH), 'crlf\nline\ncarriage')
})

test('feed text refuses anything longer than the column limit', () => {
  assert.equal(sanitizeFeedText('a'.repeat(FEED_POST_MAX_LENGTH), FEED_POST_MAX_LENGTH).length, FEED_POST_MAX_LENGTH)
  assert.throws(() => sanitizeFeedText('a'.repeat(FEED_POST_MAX_LENGTH + 1), FEED_POST_MAX_LENGTH, 'post'),
    /under 5000 characters/)
  assert.throws(() => sanitizeFeedText('a'.repeat(FEED_COMMENT_MAX_LENGTH + 1), FEED_COMMENT_MAX_LENGTH, 'comment'),
    /under 3000 characters/)
})

test('feed text handles missing values without throwing', () => {
  assert.equal(sanitizeFeedText(undefined, FEED_POST_MAX_LENGTH), '')
  assert.equal(sanitizeFeedText(null, FEED_POST_MAX_LENGTH), '')
})

test('only same-origin paths and http(s) media urls are accepted', () => {
  assert.equal(isSafeMediaUrl('https://woavhlkgylarngqyvphf.supabase.co/storage/v1/object/public/x.jpg'), true)
  assert.equal(isSafeMediaUrl('http://cdn.example.com/a.mp4'), true)
  assert.equal(isSafeMediaUrl('/storage/v1/object/public/x.jpg'), true)
  assert.equal(isSafeMediaUrl('javascript:alert(1)'), false)
  assert.equal(isSafeMediaUrl('data:image/svg+xml;base64,PHN2Zz4='), false)
  assert.equal(isSafeMediaUrl('file:///etc/passwd'), false)
  assert.equal(isSafeMediaUrl('//evil.example.com/x.jpg'), false)
  assert.equal(isSafeMediaUrl(''), false)
  assert.equal(isSafeMediaUrl(undefined), false)
})

test('media normalisation drops unsafe urls, caps the count and sanitises names', () => {
  const items = [
    { url: 'https://cdn.example.com/ok.jpg', type: 'image', name: 'photo\u0000.jpg' },
    { url: 'javascript:alert(1)', type: 'image' },
    { url: 'https://cdn.example.com/clip.mp4', type: 'video' },
    { url: '   ' },
  ]
  const normalized = normalizeFeedMedia(items)
  assert.equal(normalized.length, 2)
  assert.deepEqual(normalized[0], { url: 'https://cdn.example.com/ok.jpg', type: 'image', name: 'photo.jpg' })
  assert.deepEqual(normalized[1], { url: 'https://cdn.example.com/clip.mp4', type: 'video', name: null })

  const many = Array.from({ length: 25 }, (_, index) => ({ url: `https://cdn.example.com/${index}.jpg` }))
  assert.equal(normalizeFeedMedia(many).length, FEED_MEDIA_MAX_ITEMS)
  assert.deepEqual(normalizeFeedMedia(null), [])
  assert.deepEqual(normalizeFeedMedia('not-an-array'), [])
})

test('the visibility filter shows public posts to everyone and everything to admins', () => {
  assert.equal(feedVisibilityFilter({ viewerId: UUID, isAdmin: true }), null)
  assert.equal(feedVisibilityFilter({ viewerId: UUID, isAdmin: false }), `status.eq.active,author_id.eq.${UUID}`)
  assert.equal(feedVisibilityFilter({ viewerId: null, isAdmin: false }), 'status.eq.active')
  assert.equal(feedVisibilityFilter({ viewerId: 'not-a-uuid', isAdmin: false }), 'status.eq.active')
})
