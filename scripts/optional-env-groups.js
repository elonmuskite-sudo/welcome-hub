export const OPTIONAL_ENV_GROUPS = [
  { name: 'Idswyft KYC', keys: ['IDSWYFT_API_URL', 'IDSWYFT_API_KEY', 'IDSWYFT_SESSION_ENCRYPTION_KEY'] },
  { name: 'Twilio SMS', keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID'] },
  { name: 'file scanning', keys: ['FILE_SCAN_API_URL', 'FILE_SCAN_API_KEY'] },
  { name: 'R2 storage credentials', keys: ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] },
  { name: 'Web Push', keys: ['VITE_WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_VAPID_SUBJECT'] },
  { name: 'TURN relay credentials', keys: ['VITE_TURN_URL', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL'] },
]

export function getPartialOptionalEnvGroups(config, isInvalidValue) {
  return OPTIONAL_ENV_GROUPS.flatMap((group) => {
    const configured = group.keys.filter((key) => !isInvalidValue(config[key]))
    if (configured.length === 0 || configured.length === group.keys.length) return []

    return [{
      name: group.name,
      missingKeys: group.keys.filter((key) => isInvalidValue(config[key])),
    }]
  })
}
