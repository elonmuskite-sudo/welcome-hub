import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261017040000_social_feed.sql', import.meta.url),
  'utf8',
)
const schema = fs.readFileSync(new URL('../docs/supabase-schema.sql', import.meta.url), 'utf8')
const sources = [migration, schema]

test('the canonical schema mirrors the social feed migration', () => {
  assert.match(schema, /-- 20261017040000_social_feed\.sql/)
})

test('the feed has posts, comments and reaction tables', () => {
  for (const sql of sources) {
    assert.match(sql, /create table if not exists public\.feed_posts/i)
    assert.match(sql, /create table if not exists public\.feed_comments/i)
    assert.match(sql, /create table if not exists public\.feed_reactions/i)
    assert.match(sql, /create table if not exists public\.feed_comment_reactions/i)
  }
})

test('comments support threaded nesting and posts support media + admin flag', () => {
  for (const sql of sources) {
    assert.match(sql, /parent_id uuid references public\.feed_comments\(id\) on delete cascade/i)
    assert.match(sql, /media jsonb not null default '\[\]'::jsonb/i)
    assert.match(sql, /is_admin_post boolean not null default false/i)
    assert.match(sql, /status text not null default 'active' check \(status in \('active', 'hidden', 'removed'\)\)/i)
  }
})

test('every feed table has row level security enabled', () => {
  for (const sql of sources) {
    assert.match(sql, /alter table public\.feed_posts enable row level security/i)
    assert.match(sql, /alter table public\.feed_comments enable row level security/i)
    assert.match(sql, /alter table public\.feed_reactions enable row level security/i)
    assert.match(sql, /alter table public\.feed_comment_reactions enable row level security/i)
  }
})

test('authors own their posts and admins can moderate the whole feed', () => {
  for (const sql of sources) {
    assert.match(sql, /"Create own feed posts" on public\.feed_posts for insert to authenticated\s+with check \(author_id = auth\.uid\(\)\)/i)
    assert.match(sql, /"Delete own feed posts" on public\.feed_posts for delete to authenticated\s+using \(author_id = auth\.uid\(\) or public\.has_role\(auth\.uid\(\), 'admin'\)\)/i)
    assert.match(sql, /"Manage own feed comments" on public\.feed_comments for update to authenticated/i)
  }
})

test('each member owns only their own reaction rows', () => {
  for (const sql of sources) {
    assert.match(sql, /"Manage own post reactions" on public\.feed_reactions for all to authenticated\s+using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/i)
    assert.match(sql, /"Manage own comment reactions" on public\.feed_comment_reactions for all to authenticated\s+using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/i)
  }
})

test('feed tables are published for realtime updates', () => {
  for (const sql of sources) {
    assert.match(sql, /alter publication supabase_realtime add table public\.feed_posts/i)
    assert.match(sql, /alter publication supabase_realtime add table public\.feed_comments/i)
    assert.match(sql, /alter publication supabase_realtime add table public\.feed_reactions/i)
    assert.match(sql, /alter publication supabase_realtime add table public\.feed_comment_reactions/i)
  }
})
