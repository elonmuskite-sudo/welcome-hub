import { decryptSessionToken, kycStepForStatus } from './idswyftKyc.js'
import { withKycUserTransaction } from './kycAuth.js'

function safeSession(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
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
        current_step: kycStepForStatus(session.status),
        metadata: session.metadata,
        ocr_data: session.metadata.ocr || null,
        liveness_results: session.metadata.liveness || null,
        cross_validation_results: session.metadata.cross_validation || null,
        rejection_reason: session.metadata.rejection_reason || null,
      })
      if (error) throw error
      return
    }

    await client.query(
      `insert into public.kyc_sessions (
         id, user_id, session_token, status, current_step, metadata,
         ocr_data, liveness_results, cross_validation_results, rejection_reason
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
      [
        session.id,
        userId,
        session.encryptedToken,
        session.status,
        kycStepForStatus(session.status),
        JSON.stringify(session.metadata),
        session.metadata.ocr ? JSON.stringify(session.metadata.ocr) : null,
        session.metadata.liveness ? JSON.stringify(session.metadata.liveness) : null,
        session.metadata.cross_validation ? JSON.stringify(session.metadata.cross_validation) : null,
        session.metadata.rejection_reason || null,
      ],
    )
  })
}

export async function readKycSession(auth, id) {
  return withKycUserTransaction(auth, async ({ userId, admin, client }) => {
    if (admin) {
      let query = admin.from('kyc_sessions')
        .select('id, user_id, session_token, status, current_step, metadata, ocr_data, liveness_results, cross_validation_results, rejection_reason, created_at, updated_at')
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
      `select id, user_id, session_token, status, current_step, metadata,
              ocr_data, liveness_results, cross_validation_results, rejection_reason,
              created_at, updated_at
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
        .select('metadata, rejection_reason')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()
      if (existing.error) throw existing.error
      if (!existing.data) return null

      const { data, error } = await admin.from('kyc_sessions')
        .update({
          status: update.status,
          current_step: kycStepForStatus(update.status),
          metadata: { ...(existing.data.metadata || {}), ...update.metadata },
          ...(update.metadata.ocr ? { ocr_data: update.metadata.ocr } : {}),
          ...(update.metadata.liveness ? { liveness_results: update.metadata.liveness } : {}),
          ...(update.metadata.cross_validation ? { cross_validation_results: update.metadata.cross_validation } : {}),
          rejection_reason: update.status === 'APPROVED'
            ? null
            : update.metadata.rejection_reason || existing.data.rejection_reason || null,
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, status, current_step, metadata, created_at, updated_at')
        .maybeSingle()
      if (error) throw error
      return safeSession(data)
    }

    const { rows } = await client.query(
      `update public.kyc_sessions
          set status = $1,
              current_step = $2,
              metadata = metadata || $3::jsonb,
              ocr_data = coalesce($4::jsonb, ocr_data),
              liveness_results = coalesce($5::jsonb, liveness_results),
              cross_validation_results = coalesce($6::jsonb, cross_validation_results),
              rejection_reason = case
                when $1 = 'APPROVED' then null
                else coalesce($7, rejection_reason)
              end
        where id = $8 and user_id = $9
        returning id, status, current_step, metadata, created_at, updated_at`,
      [
        update.status,
        kycStepForStatus(update.status),
        JSON.stringify(update.metadata),
        update.metadata.ocr ? JSON.stringify(update.metadata.ocr) : null,
        update.metadata.liveness ? JSON.stringify(update.metadata.liveness) : null,
        update.metadata.cross_validation ? JSON.stringify(update.metadata.cross_validation) : null,
        update.metadata.rejection_reason || null,
        id,
        userId,
      ],
    )
    return safeSession(rows[0] || null)
  })
}

export function getKycSessionToken(row) {
  return decryptSessionToken(row?.session_token)
}
