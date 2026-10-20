import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

// Best-effort cleanup of a member's own rows and stored objects before the auth
// record is removed. Deletion order follows the foreign keys: reactions and
// comments (children) before posts, messages/members before the chats they
// belong to. Failures are collected, never thrown, so a single missing table
// cannot block an account deletion the user has already confirmed.
async function purgeMemberData(admin: any, userId: string) {
  const failures: string[] = []

  // Stored objects: chat uploads (exact paths) and identity documents (user folder).
  const { data: files } = await admin.from('storage_files').select('storage_path').eq('user_id', userId)
  const chatPaths = (files || []).map((row: { storage_path: string }) => row.storage_path).filter(Boolean)
  if (chatPaths.length) {
    const { error } = await admin.storage.from('chat-files').remove(chatPaths)
    if (error) failures.push(`chat-files: ${error.message}`)
  }
  const { data: idDocs } = await admin.storage.from('identity-docs').list(userId)
  const idDocPaths = (idDocs || []).map((entry: { name: string }) => `${userId}/${entry.name}`)
  if (idDocPaths.length) {
    const { error } = await admin.storage.from('identity-docs').remove(idDocPaths)
    if (error) failures.push(`identity-docs: ${error.message}`)
  }

  const deletions: Array<[string, string, string]> = [
    ['feed_comment_reactions', 'user_id', userId],
    ['feed_reactions', 'user_id', userId],
    ['feed_comments', 'author_id', userId],
    ['feed_posts', 'author_id', userId],
    ['messages', 'sender_id', userId],
    ['chat_members', 'profile_id', userId],
    ['chats', 'owner_id', userId],
    ['contacts', 'user_id', userId],
    ['storage_files', 'user_id', userId],
    ['identity_verifications', 'user_id', userId],
    ['premium_members', 'user_id', userId],
    ['appwrite_identity_links', 'supabase_user_id', userId],
  ]
  for (const [table, column, value] of deletions) {
    const { error } = await admin.from(table).delete().eq(column, value)
    if (error) failures.push(`${table}: ${error.message}`)
  }
  return failures
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json(503, { error: 'Account services unavailable' })

    const authorization = req.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.auth.getUser(authorization.slice(7))
    const user = data.user
    if (error || !user) return json(401, { error: 'Session expired' })

    const failures = await purgeMemberData(admin, user.id)

    // The auth record is removed last. The members, user_roles, e2ee_public_keys
    // and identity-link rows cascade from auth.users on delete.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) {
      console.error(`Account deletion failed for ${user.id}: ${deleteError.message}`, failures)
      return json(500, { error: 'Your account could not be deleted. Please try again.' })
    }
    if (failures.length) console.warn(`Account ${user.id} deleted with cleanup warnings:`, failures)
    return json(200, { deleted: true })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Account deletion unavailable' })
  }
})
