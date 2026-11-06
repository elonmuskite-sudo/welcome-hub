import { authenticateKycRequest, kycErrorResponse, sendKycResponse } from '../../server/kycAuth.js'
import { fetchProviderStatus, isKycUuid, KycError } from '../../server/idswyftKyc.js'
import { getKycSessionToken, readKycSession, updateKycSession } from '../../server/kycStore.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return sendKycResponse(res, 405, { error: 'Method not allowed.' })

  try {
    const auth = await authenticateKycRequest(req)
    const id = typeof req.query?.id === 'string' ? req.query.id : ''
    if (id && !isKycUuid(id)) throw new KycError('The verification session ID is invalid.')
    const current = await readKycSession(auth, id || undefined)
    if (!current) return sendKycResponse(res, 200, { session: null })

    const providerStatus = await fetchProviderStatus(current.id, getKycSessionToken(current))
    const session = await updateKycSession(auth, current.id, providerStatus)
    if (!session) throw new KycError('The verification session is no longer available.', 404)
    return sendKycResponse(res, 200, { session })
  } catch (error) {
    return kycErrorResponse(res, error)
  }
}
