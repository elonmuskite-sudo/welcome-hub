export function validateFirebaseServiceAccount(value) {
  let account
  try {
    account = JSON.parse(String(value || ''))
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.')
  }

  if (!account || typeof account !== 'object' || Array.isArray(account)
    || account.type !== 'service_account'
    || typeof account.project_id !== 'string' || !account.project_id.trim()
    || typeof account.client_email !== 'string' || !account.client_email.trim()
    || typeof account.private_key !== 'string'
    || !account.private_key.includes('-----BEGIN PRIVATE KEY-----')
    || !account.private_key.includes('-----END PRIVATE KEY-----')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a complete Firebase service-account JSON object.')
  }
  return account
}
