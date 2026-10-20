#!/usr/bin/env node
/**
 * Demo content tooling for the store-review accounts.
 *
 *   inspect       Report what the review accounts currently see (members, chats,
 *                 messages, feed posts) so seeding decisions are made against
 *                 real data. Read-only.
 *   seed-feed     Publish a few feed posts as the two demo accounts (with one
 *                 reaction and one comment each way) so the feed listing
 *                 screenshot shows a living community instead of an empty
 *                 state. Idempotent: existing demo-authored posts are replaced.
 *   cleanup-chat  Delete the conversation the screenshot generator seeds between
 *                 the two demo accounts (messages and memberships cascade), so
 *                 nothing is left that a reviewer device cannot decrypt.
 *
 * Usage: node scripts/demo-content.mjs [inspect|seed-feed|cleanup-chat]
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MODE = process.argv[2] || 'inspect'

const DEMO_EMAILS = ['demo1@nexus-chat-world.com', 'demo2@nexus-chat-world.com']

// Two accounts are addressed by index: 0 = demo1, 1 = demo2.
const FEED_SEED = [
  {
    author: 0,
    content:
      'Just finished setting up my Nexus account. Encryption is on by default and every message shows the lock — exactly what I wanted from a chat app.',
    ageMinutes: 45,
    reactions: [{ by: 1, emoji: '👍' }],
    comments: [{ by: 1, content: 'Welcome! Try a voice note — mine came through clearly on the first try.' }],
  },
  {
    author: 1,
    content:
      'Testing the feed from the tablet. Attachments, stickers and reactions all work, and the thread stays readable when the keyboard opens.',
    ageMinutes: 200,
    reactions: [{ by: 0, emoji: '🔥' }],
  },
  {
    author: 0,
    content: 'Team huddle at 7 — bring your notes. Report anything that looks off and I will pass it on.',
    ageMinutes: 1500,
    reactions: [{ by: 1, emoji: '🙏' }],
  },
]

function loadEnv() {
  const env = {}
  for (const file of ['.env', '.env.local']) {
    const path = `${ROOT}${file}`
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
  return { ...env, ...process.env }
}

const env = loadEnv()
const DB_URL = env.SUPABASE_DB_URL
if (!DB_URL) throw new Error('SUPABASE_DB_URL is required (add it to .env.local).')

// The pooler chain is untrusted and an `sslmode` parameter in the URL overrides
// the explicit ssl object, so strip it and pin rejectUnauthorized instead.
const parsed = new URL(DB_URL)
parsed.searchParams.delete('sslmode')
const client = new pg.Client({ connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } })

async function demoMembers() {
  const { rows } = await client.query(
    `select m.member_id, m.email, m.id, m.full_name, m.email_verified, m.e2ee_enabled
       from public.members m
      where m.email = any($1)
      order by m.member_id`,
    [DEMO_EMAILS],
  )
  return rows
}

async function inspect() {
  const members = await demoMembers()
  console.log('Demo accounts')
  for (const row of members) {
    console.log(`  ${row.member_id}  ${row.email}  id=${row.id}  verified=${row.email_verified}  e2ee=${row.e2ee_enabled}`)
  }

  const { rows: totals } = await client.query(`
    select (select count(*) from public.members) as members,
           (select count(*) from public.chats) as chats,
           (select count(*) from public.messages) as messages,
           (select count(*) from public.feed_posts) as posts,
           (select count(*) from public.feed_posts where status = 'active') as active_posts
  `)
  console.log('\nTotals')
  console.log(`  members=${totals[0].members}  chats=${totals[0].chats}  messages=${totals[0].messages}  feed_posts=${totals[0].posts} (active ${totals[0].active_posts})`)

  const ids = members.map((row) => row.id)
  if (ids.length === 2) {
    const { rows: chats } = await client.query(
      `select c.id, c.title, c.encrypted, c.created_at,
              (select count(*) from public.messages m where m.chat_id = c.id) as message_count
         from public.chats c
        where exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $1)
          and exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $2)`,
      ids,
    )
    console.log('\nChats between the two demo accounts')
    if (!chats.length) console.log('  (none)')
    for (const row of chats) {
      console.log(`  ${row.id}  title="${row.title}"  encrypted=${row.encrypted}  messages=${row.message_count}`)
    }

    const { rows: posts } = await client.query(
      `select id, left(content, 70) as excerpt, status, created_at
         from public.feed_posts
        where author_id = any($1)
        order by created_at desc`,
      [ids],
    )
    console.log('\nFeed posts authored by the demo accounts')
    if (!posts.length) console.log('  (none)')
    for (const row of posts) {
      console.log(`  ${row.id}  [${row.status}] "${row.excerpt}"`)
    }
  }

  const { rows: recent } = await client.query(
    `select left(content, 60) as excerpt, status, created_at from public.feed_posts order by created_at desc limit 5`,
  )
  console.log('\nMost recent feed posts overall')
  if (!recent.length) console.log('  (none)')
  for (const row of recent) {
    console.log(`  [${row.status}] "${row.excerpt}"  ${row.created_at.toISOString()}`)
  }
}

async function seedFeed() {
  const members = await demoMembers()
  if (members.length < 2) {
    throw new Error('Both demo accounts must exist first. Run: node scripts/create-demo-accounts.mjs')
  }
  const ids = members.map((row) => row.id)

  await client.query('begin')
  try {
    // Replace rather than append so re-running never stacks duplicate posts.
    // Comments and reactions follow the posts away through ON DELETE CASCADE.
    const { rowCount: removed } = await client.query(
      'delete from public.feed_posts where author_id = any($1)',
      [ids],
    )

    let reactions = 0
    let comments = 0
    for (const post of FEED_SEED) {
      const { rows } = await client.query(
        `insert into public.feed_posts (author_id, content, media, status, created_at, updated_at)
         values ($1, $2, '[]'::jsonb, 'active', now() - make_interval(mins => $3), now() - make_interval(mins => $3))
         returning id`,
        [ids[post.author], post.content, post.ageMinutes],
      )
      const postId = rows[0].id

      for (const reaction of post.reactions || []) {
        await client.query(
          `insert into public.feed_reactions (post_id, user_id, reaction)
           values ($1, $2, $3)
           on conflict (post_id, user_id) do update set reaction = excluded.reaction`,
          [postId, ids[reaction.by], reaction.emoji],
        )
        reactions += 1
      }

      for (const comment of post.comments || []) {
        await client.query(
          `insert into public.feed_comments (post_id, author_id, content, status, created_at, updated_at)
           values ($1, $2, $3, 'active', now() - make_interval(mins => $4), now() - make_interval(mins => $4))`,
          [postId, ids[comment.by], comment.content, Math.max(post.ageMinutes - 10, 1)],
        )
        comments += 1
      }
    }
    await client.query('commit')
    console.log(`Feed seeded: ${FEED_SEED.length} posts, ${reactions} reaction(s), ${comments} comment(s) as the demo accounts.`)
    if (removed) console.log(`(replaced ${removed} previous demo-authored post(s))`)
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function cleanupChat() {
  const members = await demoMembers()
  if (members.length < 2) {
    console.log('Both demo accounts are required; nothing to clean up.')
    return
  }
  const ids = members.map((row) => row.id)

  const match = `exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $1)
             and exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $2)`

  const { rows: counted } = await client.query(
    `with matching as (select c.id from public.chats c where ${match})
     select (select count(*)::int from matching) as chats,
            (select count(*)::int from public.messages m where m.chat_id in (select id from matching)) as messages`,
    ids,
  )
  if (!counted[0].chats) {
    console.log('No conversation between the demo accounts; nothing to clean up.')
    return
  }

  // chat_members and messages both cascade from chats.
  const { rowCount } = await client.query(
    `delete from public.chats c
      where exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $1)
        and exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.profile_id = $2)`,
    ids,
  )
  console.log(`Removed ${rowCount} seeded conversation(s) and ${counted[0].messages} message(s). The demo accounts are clean.`)
}

await client.connect()
try {
  if (MODE === 'inspect') await inspect()
  else if (MODE === 'seed-feed') await seedFeed()
  else if (MODE === 'cleanup-chat') await cleanupChat()
  else throw new Error(`Unknown mode "${MODE}". Supported: inspect, seed-feed, cleanup-chat`)
} finally {
  await client.end()
}
