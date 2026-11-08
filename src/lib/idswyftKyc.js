import { getAppwriteJwt, isAppwriteAuthEnabled } from './appwrite.js'
import { supabase } from './supabase.js'

async function authorizationHeaders() {
  if (isAppwriteAuthEnabled()) {
    return { Authorization: `Bearer ${await getAppwriteJwt()}` }
  }
  if (!supabase) throw new Error('Sign in to continue verification.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session?.access_token) throw new Error('Sign in to continue verification.')
  return { Authorization: `Bearer ${data.session.access_token}` }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(await authorizationHeaders()),
    },
    cache: 'no-store',
  })
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`The verification service returned HTTP ${response.status}.`)
  }
  if (!response.ok) throw new Error(result?.error || 'The verification request could not be completed.')
  return result
}

export function getKycSession(id) {
  const query = id ? `?id=${encodeURIComponent(id)}` : ''
  return request(`/api/kyc/status${query}`)
}

export function startKycSession() {
  return request('/api/kyc/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true }),
  })
}

export function uploadKycFile({ id, stage, file }) {
  const body = new FormData()
  body.set('verification_id', id)
  body.set('stage', stage)
  body.set(stage === 'selfie' ? 'selfie' : 'document', file)
  return request('/api/kyc/upload', { method: 'POST', body })
}
