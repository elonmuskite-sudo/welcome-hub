import { Account, Client } from 'appwrite'

const env = import.meta.env || {}
const endpoint = env.VITE_APPWRITE_ENDPOINT || ''
const projectId = env.VITE_APPWRITE_PROJECT_ID || ''
const authProvider = env.VITE_AUTH_PROVIDER || 'supabase'

const client = endpoint && projectId
  ? new Client().setEndpoint(endpoint).setProject(projectId)
  : null

export const appwriteAccount = client ? new Account(client) : null
export const isAppwriteAuthEnabled = () => authProvider === 'appwrite' && Boolean(appwriteAccount)

// Appwrite JWTs stay valid for 15 minutes, but minting one is a network round
// trip. Caching it (and sharing a single in-flight request) removes that extra
// hop from every gateway call, halving the round trips for a sync tick.
const JWT_TTL_MS = 10 * 60 * 1000
let cachedJwt = ''
let cachedJwtExpiresAt = 0
let inFlightJwt = null

export function invalidateAppwriteJwt() {
  cachedJwt = ''
  cachedJwtExpiresAt = 0
}

export async function getAppwriteJwt() {
  if (!appwriteAccount) throw new Error('Appwrite Auth is not configured.')
  if (cachedJwt && Date.now() < cachedJwtExpiresAt) return cachedJwt
  if (inFlightJwt) return inFlightJwt
  inFlightJwt = appwriteAccount.createJWT()
    .then(({ jwt }) => {
      if (!jwt) throw new Error('Appwrite did not issue a session token.')
      cachedJwt = jwt
      cachedJwtExpiresAt = Date.now() + JWT_TTL_MS
      return jwt
    })
    .finally(() => { inFlightJwt = null })
  return inFlightJwt
}

export async function appwriteData(action, payload = {}, options = {}) {
  const send = async (jwt) => {
    const response = await fetch('/api/data/gateway', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...payload }),
      signal: options.signal,
    })
    let result
    try {
      result = await response.json()
    } catch {
      throw new Error(`The secure data gateway returned HTTP ${response.status}.`)
    }
    return { response, result }
  }

  let { response, result } = await send(await getAppwriteJwt())
  // A cached token can expire mid-session. Drop it and retry once so an expired
  // credential never surfaces as a failed sync.
  if (response.status === 401 && cachedJwt) {
    invalidateAppwriteJwt()
    ;({ response, result } = await send(await getAppwriteJwt()))
  }
  if (!response.ok) throw new Error(result?.error || `The secure data gateway returned HTTP ${response.status}.`)
  return result
}

export async function getAppwriteProfile() {
  if (!appwriteAccount) throw new Error('Appwrite Auth is not configured.')
  const account = await appwriteAccount.get()
  if (!account.emailVerification) throw new Error('Verify your email before signing in.')
  const { profile } = await appwriteData('profile.get')
  return { ...profile, email: account.email, email_verified: true }
}

export function createAppwriteRecovery(email) {
  if (!appwriteAccount) throw new Error('Appwrite Auth is not configured.')
  return appwriteAccount.createRecoveryOTP(email, false)
}

export function rememberAppwriteRecoveryCode(code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw new Error('Enter the 6-digit recovery code from your email.')
  try {
    if (!sessionStorage.getItem('nexus-appwrite-recovery-user-id')) {
      throw new Error('Request a new recovery code and try again.')
    }
    sessionStorage.setItem('nexus-appwrite-recovery-code', code)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Request a new')) throw error
    throw new Error('Recovery could not be prepared in this browser. Enable session storage and try again.')
  }
}

export async function completeAppwriteRecovery(password) {
  if (!appwriteAccount) throw new Error('Appwrite Auth is not configured.')
  let userId
  let code
  try {
    userId = sessionStorage.getItem('nexus-appwrite-recovery-user-id')
    code = sessionStorage.getItem('nexus-appwrite-recovery-code')
  } catch {
    throw new Error('Recovery could not be read in this browser. Request a new code and try again.')
  }
  if (!userId || !code) throw new Error('Verify your recovery code before setting a new password.')
  try {
    await appwriteAccount.updateRecoveryOTP(userId, code, password)
  } finally {
    sessionStorage.removeItem('nexus-appwrite-recovery-user-id')
    sessionStorage.removeItem('nexus-appwrite-recovery-code')
  }
}

export async function signOutFromAppwrite() {
  invalidateAppwriteJwt()
  if (!appwriteAccount) return
  try {
    await appwriteAccount.deleteSession('current')
  } catch (error) {
    if (error?.code !== 401) throw error
  }
}
