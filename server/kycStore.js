import { decryptSessionToken } from './idswyftKyc.js'
import { withKycUserTransaction } from './kycAuth.js'

function safeSession(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    metadata: row.metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function createKycSession(auth, session) {
  return withKycUserTransaction(auth, async ({ userId, admin, client }) => {
    if (admin) {
      const { error } = await admin.from('kyc_sessions').insert({
        id: session.id,
        user_id: userId,
        session_token: session.encryptedToken,
        status: session.status,
        metadata: session.metadata,
      })
      if (error) throw error
      return
    }

    await client.query(
      `insert into public.kyc_sessions (id, user_id, session_token, status, metadata)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [session.id, userId, session.encryptedToken, session.status, JSON.stringify(session.metadata)],
    )
  })
}

export async function readKycSession(auth, id) {
  return withKycUserTransaction(auth, async ({ userId, admin, client }) => {
    if (admin) {
      let query = admin.from('kyc_sessions')
        .select('id, user_id, session_token, status, metadata, created_at, updated_at')
        .eq('user_id', userId)
      query = id ? query.eq('id', id) : query.order('created_at', { ascending: false }).limit(1)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data || null
    }

    const values = [userId]
    let predicate = 'user_id = $1'
    if (id) {
      values.push(id)
      predicate += ' and id = $2'
    }
    const { rows } = await client.query(
      `select id, user_id, session_token, status, metadata, created_at, updated_at
         from public.kyc_sessions
        where ${predicate}
        order by created_at desc
        limit 1`,
      values,
    )
    return rows[0] || null
  })
}

export async function updateKycSession(auth, id, update) {
  return withKycUserTransaction(auth, async ({ userId, admin, client }) => {
    if (admin) {
      const existing = await admin.from('kyc_sessions')
        .select('metadata')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()
      if (existing.error) throw existing.error
      if (!existing.data) return null

      const { data, error } = await admin.from('kyc_sessions')
        .update({
          status: update.status,
          metadata: { ...(existing.data.metadata || {}), ...update.metadata },
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, status, metadata, created_at, updated_at')
        .maybeSingle()
      if (error) throw error
      return safeSession(data)
    }

    const { rows } = await client.query(
      `update public.kyc_sessions
          set status = $1, metadata = metadata || $2::jsonb
        where id = $3 and user_id = $4
        returning id, status, metadata, created_at, updated_at`,
      [update.status, JSON.stringify(update.metadata), id, userId],
    )
    return safeSession(rows[0] || null)
  })
}

export function getKycSessionToken(row) {
  return decryptSessionToken(row?.session_token)
}
