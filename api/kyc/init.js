import { createHash } from 'node:crypto'
import {
  authenticateKycRequest,
  kycErrorResponse,
  sendKycResponse,
  withKycUserTransaction,
} from '../../server/kycAuth.js'
import { initializeProviderSession, KycError } from '../../server/idswyftKyc.js'
import { createKycSession } from '../../server/kycStore.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendKycResponse(res, 405, { error: 'Method not allowed.' })

  try {
    if (req.body?.consent !== true) throw new KycError('Consent is required before starting verification.')
    const auth = await authenticateKycRequest(req)
    const allowed = await withKycUserTransaction(auth, async ({ userId, admin }) => {
      const bucketKey = createHash('sha256').update(`idswyft-kyc-init:${userId}`).digest('hex')
      const { data, error } = await admin.rpc('consume_auth_email_code_limit', {
        p_bucket_key: bucketKey,
        p_window_seconds: 86400,
        p_limit: 5,
      })
      if (error) throw new KycError('Verification rate limiting is unavailable.', 503)
      return data === true
    })
    if (!allowed) throw new KycError('You have started the maximum number of verification sessions for today.', 429)
    const session = await initializeProviderSession(auth.userId)
    await createKycSession(auth, session)
    return sendKycResponse(res, 201, {
      session: { id: session.id, status: session.status, metadata: session.metadata },
    })
  } catch (error) {
    return kycErrorResponse(res, error)
  }
}
