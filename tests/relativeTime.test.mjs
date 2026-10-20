import test from 'node:test'
import assert from 'node:assert/strict'
import { formatChatTimestamp, formatExactTime, formatTimeAgo } from '../src/lib/relativeTime.js'

const MINUTE = 60000
const HOUR = 3600000
const DAY = 86400000
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

function ago(ms) {
  return new Date(NOW - ms).toISOString()
}

test('relative time uses readable long form text', () => {
  assert.equal(formatTimeAgo(ago(5000), NOW), 'Just now')
  assert.equal(formatTimeAgo(ago(MINUTE), NOW), '1 minute ago')
  assert.equal(formatTimeAgo(ago(2 * HOUR), NOW), '2 hours ago')
  assert.equal(formatTimeAgo(ago(3 * DAY), NOW), '3 days ago')
  assert.equal(formatTimeAgo(ago(45 * DAY), NOW), '1 month ago')
  assert.equal(formatTimeAgo(ago(400 * DAY), NOW), '1 year ago')
})

test('relative time pluralises only when it should', () => {
  assert.equal(formatTimeAgo(ago(120 * MINUTE), NOW), '2 hours ago')
  assert.equal(formatTimeAgo(ago(24 * HOUR), NOW), '1 day ago')
  assert.equal(formatTimeAgo(ago(60 * DAY), NOW), '2 months ago')
  assert.equal(formatTimeAgo(ago(730 * DAY), NOW), '2 years ago')
})

test('relative time never runs backwards for clock skew or future timestamps', () => {
  assert.equal(formatTimeAgo(new Date(NOW + HOUR).toISOString(), NOW), 'Just now')
})

test('relative time updates as the shared clock advances', () => {
  const createdAt = ago(2 * HOUR)
  assert.equal(formatTimeAgo(createdAt, NOW), '2 hours ago')
  assert.equal(formatTimeAgo(createdAt, NOW + HOUR), '3 hours ago')
  assert.equal(formatTimeAgo(createdAt, NOW + DAY), '1 day ago')
})

test('invalid timestamps render nothing instead of "NaN ago"', () => {
  assert.equal(formatTimeAgo('not-a-date', NOW), '')
  assert.equal(formatTimeAgo(null, NOW), '')
  assert.equal(formatExactTime('not-a-date'), '')
  assert.equal(formatExactTime(null), '')
})

test('the exact timestamp includes both a date and a time', () => {
  const exact = formatExactTime('2026-10-17T09:30:00.000Z')
  assert.match(exact, /2026/)
  assert.match(exact, /\d{1,2}:\d{2}/)
})

// Local-time construction keeps these assertions independent of the machine's
// timezone. 20 October 2026 is a Tuesday.
const CHAT_NOW = new Date(2026, 9, 20, 12, 0, 0).getTime()
const local = (year, month, day, hour = 12, minute = 0, second = 0) => new Date(year, month, day, hour, minute, second).toISOString()

test('chat timestamps use the compact form the contact list has room for', () => {
  assert.equal(formatChatTimestamp(local(2026, 9, 20, 11, 59, 30), CHAT_NOW), 'now')
  assert.equal(formatChatTimestamp(local(2026, 9, 20, 11, 58), CHAT_NOW), '2m ago')
  assert.equal(formatChatTimestamp(local(2026, 9, 20, 9), CHAT_NOW), '3h ago')
})

test('chat timestamps fall back to Yesterday, a weekday, then a date', () => {
  assert.equal(formatChatTimestamp(local(2026, 9, 19), CHAT_NOW), 'Yesterday')
  assert.equal(formatChatTimestamp(local(2026, 9, 17), CHAT_NOW), 'Sat')
  assert.equal(formatChatTimestamp(local(2026, 8, 5), CHAT_NOW), '5 Sep')
  assert.equal(formatChatTimestamp(local(2025, 8, 15), CHAT_NOW), '15 Sep 2025')
})

test('chat timestamps render nothing for an unusable date', () => {
  assert.equal(formatChatTimestamp('not-a-date', CHAT_NOW), '')
  assert.equal(formatChatTimestamp(null, CHAT_NOW), '')
})
