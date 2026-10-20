// User-generated content controls: reporting offensive content and blocking
// abusive members. Backed by the content_reports / blocked_users tables with
// row level security. Required by the Google Play and Apple App Store UGC
// policies.

import { supabase, isSupabaseConfigured } from './supabase'

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Sexual or explicit content' },
  { value: 'violence', label: 'Violence or dangerous content' },
  { value: 'misinformation', label: 'False information' },
  { value: 'other', label: 'Something else' },
]

export const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed']

export function isModerationAvailable() {
  return Boolean(supabase && isSupabaseConfigured())
}

function requireModeration() {
  if (!supabase) throw new Error('Reporting and blocking are unavailable because the database is not connected.')
}

async function memberProfiles(ids) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))]
  const map = new Map()
  if (!unique.length) return map
  // public.members is readable only for the viewer's own row, and its identifier
  // column is `member_id`; the resolver RPC returns directory fields for any
  // member so blocked accounts and report authors resolve to real names.
  const { data, error } = await supabase.rpc('list_member_profiles', { p_ids: unique })
  if (error) return map
  for (const row of data || []) {
    map.set(String(row.id), {
      name: row.full_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Nexus member',
      avatarUrl: row.avatar_url || null,
      nexusId: row.member_id || null,
    })
  }
  return map
}

// ---- Reporting -----------------------------------------------------------

export async function reportContent({ targetType, targetId, reason, details = '' }) {
  requireModeration()
  if (!['post', 'comment', 'member'].includes(targetType)) throw new Error('That content cannot be reported.')
  if (!REPORT_REASONS.some((item) => item.value === reason)) throw new Error('Choose a reason for your report.')
  const { data: auth } = await supabase.auth.getUser()
  const reporterId = auth?.user?.id
  if (!reporterId) throw new Error('Sign in to report content.')
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: reporterId,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: String(details || '').slice(0, 2000),
  })
  if (error) {
    // The partial unique index rejects a duplicate open report for the same target.
    if (error.code === '23505') throw new Error('You have already reported this. Our moderators are on it.')
    throw new Error(error.message || 'Your report could not be submitted.')
  }
}

// ---- Blocking ------------------------------------------------------------

export async function blockUser(blockedId) {
  requireModeration()
  const { data: auth } = await supabase.auth.getUser()
  const blockerId = auth?.user?.id
  if (!blockerId) throw new Error('Sign in to block a member.')
  if (String(blockerId) === String(blockedId)) throw new Error('You cannot block yourself.')
  const { error } = await supabase.from('blocked_users')
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' })
  if (error) throw new Error(error.message || 'That member could not be blocked.')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexus-blocks:updated'))
}

export async function unblockUser(blockedId) {
  requireModeration()
  const { data: auth } = await supabase.auth.getUser()
  const blockerId = auth?.user?.id
  if (!blockerId) throw new Error('Sign in to manage blocked members.')
  const { error } = await supabase.from('blocked_users')
    .delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId)
  if (error) throw new Error(error.message || 'That member could not be unblocked.')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexus-blocks:updated'))
}

// Ids of members the current viewer has blocked; used to filter their content.
export async function getBlockedUserIds() {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getUser()
  const blockerId = auth?.user?.id
  if (!blockerId) return []
  const { data, error } = await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', blockerId)
  if (error) return []
  return (data || []).map((row) => String(row.blocked_id))
}

export async function listBlockedUsers() {
  requireModeration()
  const ids = await getBlockedUserIds()
  if (!ids.length) return []
  const profiles = await memberProfiles(ids)
  return ids.map((id) => {
    const profile = profiles.get(id) || {}
    return {
      id,
      name: profile.name || 'Nexus member',
      avatarUrl: profile.avatarUrl || null,
      nexusId: profile.nexusId || null,
    }
  })
}

// ---- Admin review --------------------------------------------------------

export async function listReports({ status = 'open' } = {}) {
  requireModeration()
  let query = supabase.from('content_reports')
    .select('id, reporter_id, target_type, target_id, reason, details, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status && status !== 'all') query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Reports could not be loaded.')

  const reports = data || []
  if (!reports.length) return []

  const postIds = reports.filter((r) => r.target_type === 'post').map((r) => r.target_id)
  const commentIds = reports.filter((r) => r.target_type === 'comment').map((r) => r.target_id)
  const memberIds = reports.filter((r) => r.target_type === 'member').map((r) => r.target_id)

  const [profiles, posts, comments] = await Promise.all([
    memberProfiles([...reports.map((r) => r.reporter_id), ...memberIds]),
    postIds.length
      ? supabase.from('feed_posts').select('id, content, author_id').in('id', postIds).then(({ data: rows }) => rows || [])
      : Promise.resolve([]),
    commentIds.length
      ? supabase.from('feed_comments').select('id, content, author_id').in('id', commentIds).then(({ data: rows }) => rows || [])
      : Promise.resolve([]),
  ])

  const postMap = new Map(posts.map((row) => [String(row.id), row]))
  const commentMap = new Map(comments.map((row) => [String(row.id), row]))

  return reports.map((report) => {
    const key = String(report.target_id)
    let preview = ''
    if (report.target_type === 'post') preview = postMap.get(key)?.content || ''
    else if (report.target_type === 'comment') preview = commentMap.get(key)?.content || ''
    else preview = profiles.get(key)?.name || `Member ${key.slice(0, 8)}`
    return {
      id: report.id,
      reporterId: String(report.reporter_id),
      reporterName: profiles.get(String(report.reporter_id))?.name || 'Nexus member',
      targetType: report.target_type,
      targetId: key,
      reason: report.reason,
      details: report.details || '',
      status: report.status,
      createdAt: report.created_at,
      targetPreview: preview || '(content unavailable)',
    }
  })
}

export async function resolveReport({ id, status }) {
  requireModeration()
  if (!REPORT_STATUSES.includes(status)) throw new Error('Unknown report status.')
  const { error } = await supabase.from('content_reports').update({ status }).eq('id', id)
  if (error) throw new Error(error.message || 'The report could not be updated.')
}
