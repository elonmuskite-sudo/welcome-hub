// Social feed persistence. Supabase is the production default (see AGENTS.md),
// so the feed is backed by the feed_posts / feed_comments / feed_reactions
// tables with realtime updates. Media is stored in the shared chat-files bucket
// under the member's own folder.

import { supabase, isSupabaseConfigured } from './supabase'
import { uploadChatFile } from './storageManager'

const POST_COLUMNS = 'id, author_id, content, media, is_admin_post, status, created_at, updated_at'
const COMMENT_COLUMNS = 'id, post_id, author_id, parent_id, content, status, created_at, updated_at'

export const FEED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥']

export function isFeedAvailable() {
  return Boolean(supabase && isSupabaseConfigured())
}

function requireFeed() {
  if (!supabase) throw new Error('The feed is unavailable because the database is not connected.')
}

function normalizeMedia(media) {
  if (!Array.isArray(media)) return []
  return media
    .filter((item) => item && item.url)
    .map((item) => ({
      url: String(item.url),
      type: item.type === 'video' ? 'video' : 'image',
      name: item.name ? String(item.name) : null,
    }))
    .slice(0, 10)
}

function toTime(value) {
  return value || new Date().toISOString()
}

export async function uploadFeedMedia({ userId, file, onProgress }) {
  if (!userId) throw new Error('Sign in to share media.')
  // Reuses the validated chat upload pipeline (type/size/virus-scan checks) and
  // stores feed media under the member's own folder.
  return uploadChatFile({ userId, chatId: 'feed', file, onProgress })
}

async function memberProfiles(ids) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))]
  const map = new Map()
  if (!unique.length) return map
  const { data, error } = await supabase.from('members')
    .select('id, full_name, first_name, last_name, avatar_url')
    .in('id', unique)
  if (error) return map
  for (const row of data || []) {
    map.set(String(row.id), {
      name: row.full_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Nexus member',
      avatarUrl: row.avatar_url || null,
    })
  }
  return map
}

function buildCommentTree(rows, reactionMap) {
  const byId = new Map()
  for (const row of rows) {
    const reactions = reactionMap.get(String(row.id)) || { counts: {}, mine: null }
    byId.set(String(row.id), {
      id: String(row.id),
      userId: String(row.author_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      edited: row.updated_at && row.created_at && row.updated_at !== row.created_at,
      reactions: reactions.counts,
      reactedBy: reactions.mine,
      replies: [],
    })
  }
  const roots = []
  for (const comment of byId.values()) {
    if (comment.parentId && byId.has(comment.parentId)) byId.get(comment.parentId).replies.push(comment)
    else roots.push(comment)
  }
  return roots
}

export async function listFeed() {
  requireFeed()
  const { data: posts, error } = await supabase.from('feed_posts')
    .select(POST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message || 'The feed could not be loaded.')

  const postRows = posts || []
  const postIds = postRows.map((post) => post.id)
  let commentRows = []
  let postReactions = []
  let commentReactions = []
  if (postIds.length) {
    const [comments, pReactions] = await Promise.all([
      supabase.from('feed_comments').select(COMMENT_COLUMNS).in('post_id', postIds).order('created_at', { ascending: true }).limit(2000),
      supabase.from('feed_reactions').select('post_id, user_id, reaction').in('post_id', postIds),
    ])
    commentRows = comments.data || []
    postReactions = pReactions.data || []
  }
  const commentIds = commentRows.map((comment) => comment.id)
  if (commentIds.length) {
    const { data } = await supabase.from('feed_comment_reactions').select('comment_id, user_id, reaction').in('comment_id', commentIds)
    commentReactions = data || []
  }

  const profiles = await memberProfiles([
    ...postRows.map((post) => post.author_id),
    ...commentRows.map((comment) => comment.author_id),
  ])

  const postReactionMap = new Map()
  for (const row of postReactions) {
    const key = String(row.post_id)
    if (!postReactionMap.has(key)) postReactionMap.set(key, { counts: {}, byUser: {} })
    const entry = postReactionMap.get(key)
    entry.counts[row.reaction] = (entry.counts[row.reaction] || 0) + 1
    entry.byUser[String(row.user_id)] = row.reaction
  }

  const commentReactionMap = new Map()
  for (const row of commentReactions) {
    const key = String(row.comment_id)
    if (!commentReactionMap.has(key)) commentReactionMap.set(key, { counts: {}, byUser: {} })
    const entry = commentReactionMap.get(key)
    entry.counts[row.reaction] = (entry.counts[row.reaction] || 0) + 1
    entry.byUser[String(row.user_id)] = row.reaction
  }

  const commentsByPost = new Map()
  for (const row of commentRows) {
    const key = String(row.post_id)
    if (!commentsByPost.has(key)) commentsByPost.set(key, [])
    commentsByPost.get(key).push(row)
  }

  return postRows.map((post) => {
    const author = profiles.get(String(post.author_id)) || { name: 'Nexus member', avatarUrl: null }
    const reaction = postReactionMap.get(String(post.id)) || { counts: {}, byUser: {} }
    return {
      id: String(post.id),
      userId: String(post.author_id),
      userName: author.name,
      userAvatar: author.avatarUrl,
      content: post.content || '',
      media: Array.isArray(post.media) ? post.media : [],
      status: post.status,
      isAdminPost: Boolean(post.is_admin_post),
      createdAt: post.created_at,
      updatedAt: post.updated_at,
      edited: post.updated_at && post.created_at && post.updated_at !== post.created_at,
      reactions: reaction.counts,
      reactedBy: reaction.byUser,
      comments: buildCommentTree(commentsByPost.get(String(post.id)) || [], commentReactionMap),
    }
  })
}

export async function createFeedPost({ content = '', media = [], isAdmin = false }) {
  requireFeed()
  const text = String(content || '').trim()
  const normalized = normalizeMedia(media)
  if (!text && !normalized.length) throw new Error('Add text or media before posting.')
  const { data: auth } = await supabase.auth.getUser()
  const authorId = auth?.user?.id
  if (!authorId) throw new Error('Sign in to post to the feed.')
  const { data, error } = await supabase.from('feed_posts')
    .insert({ author_id: authorId, content: text, media: normalized, is_admin_post: Boolean(isAdmin) })
    .select('id').single()
  if (error) throw new Error(error.message || 'Your post could not be published.')
  return data.id
}

export async function updateFeedPost({ id, content = '', media = [] }) {
  requireFeed()
  const text = String(content || '').trim()
  const normalized = normalizeMedia(media)
  if (!text && !normalized.length) throw new Error('A post needs text or media.')
  const { error } = await supabase.from('feed_posts')
    .update({ content: text, media: normalized })
    .eq('id', id)
  if (error) throw new Error(error.message || 'Your post could not be updated.')
}

export async function deleteFeedPost(id) {
  requireFeed()
  const { error } = await supabase.from('feed_posts').delete().eq('id', id)
  if (error) throw new Error(error.message || 'Your post could not be deleted.')
}

export async function setFeedPostStatus({ id, status }) {
  requireFeed()
  const { error } = await supabase.from('feed_posts').update({ status }).eq('id', id)
  if (error) throw new Error(error.message || 'The post could not be moderated.')
}

export async function createFeedComment({ postId, content, parentId = null }) {
  requireFeed()
  const text = String(content || '').trim()
  if (!text) throw new Error('Write a comment before sending.')
  const { data: auth } = await supabase.auth.getUser()
  const authorId = auth?.user?.id
  if (!authorId) throw new Error('Sign in to comment.')
  const { error } = await supabase.from('feed_comments')
    .insert({ post_id: postId, author_id: authorId, parent_id: parentId || null, content: text })
  if (error) throw new Error(error.message || 'Your comment could not be added.')
}

export async function updateFeedComment({ id, content }) {
  requireFeed()
  const text = String(content || '').trim()
  if (!text) throw new Error('A comment cannot be empty.')
  const { error } = await supabase.from('feed_comments').update({ content: text }).eq('id', id)
  if (error) throw new Error(error.message || 'The comment could not be updated.')
}

export async function deleteFeedComment(id) {
  requireFeed()
  const { error } = await supabase.from('feed_comments').delete().eq('id', id)
  if (error) throw new Error(error.message || 'The comment could not be deleted.')
}

export async function setFeedCommentStatus({ id, status }) {
  requireFeed()
  const { error } = await supabase.from('feed_comments').update({ status }).eq('id', id)
  if (error) throw new Error(error.message || 'The comment could not be moderated.')
}

export async function setFeedReaction({ postId, userId, emoji }) {
  requireFeed()
  if (!userId) throw new Error('Sign in to react.')
  if (!emoji) {
    const { error } = await supabase.from('feed_reactions').delete().eq('post_id', postId).eq('user_id', userId)
    if (error) throw new Error(error.message || 'Your reaction could not be removed.')
    return
  }
  const { error } = await supabase.from('feed_reactions')
    .upsert({ post_id: postId, user_id: userId, reaction: emoji }, { onConflict: 'post_id,user_id' })
  if (error) throw new Error(error.message || 'Your reaction could not be saved.')
}

export async function setFeedCommentReaction({ commentId, userId, emoji }) {
  requireFeed()
  if (!userId) throw new Error('Sign in to react.')
  if (!emoji) {
    const { error } = await supabase.from('feed_comment_reactions').delete().eq('comment_id', commentId).eq('user_id', userId)
    if (error) throw new Error(error.message || 'Your reaction could not be removed.')
    return
  }
  const { error } = await supabase.from('feed_comment_reactions')
    .upsert({ comment_id: commentId, user_id: userId, reaction: emoji }, { onConflict: 'comment_id,user_id' })
  if (error) throw new Error(error.message || 'Your reaction could not be saved.')
}

// Realtime: the whole feed reloads (debounced) whenever any feed table changes,
// which keeps posts, comments and reaction counts in sync across clients.
export function subscribeFeed(onChange) {
  if (!supabase) return () => {}
  let timer = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { onChange?.() }, 400)
  }
  const channel = supabase
    .channel('nexus-feed-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_posts' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_comments' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_reactions' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_comment_reactions' }, schedule)
    .subscribe()
  return () => {
    if (timer) clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}

export function formatTimeAgo(dateString) {
  const date = new Date(dateString)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return date.toLocaleDateString()
}
