// WebRTC ICE configuration.
//
// STUN lets two peers discover their public addresses; TURN relays the media
// when both sides sit behind strict or symmetric NATs (common on mobile
// networks), so a TURN server is required for calls to connect "without
// limits". STUN is public and free; TURN credentials come from the operator and
// are read from the build environment:
//
//   VITE_STUN_URL           optional, comma-separated (defaults to Google STUN)
//   VITE_TURN_URL           optional, comma-separated turn:/turns: URLs
//   VITE_TURN_USERNAME      optional TURN username
//   VITE_TURN_CREDENTIAL    optional TURN credential
//
// TURN credentials are visible in the browser by design (that is how WebRTC
// works); issue short-lived credentials where your provider supports them.

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function validateIceConfiguration(env = {}) {
  const stunUrls = list(env.VITE_STUN_URL)
  if (stunUrls.some((url) => !/^stuns?:/i.test(url))) {
    throw new Error('VITE_STUN_URL must contain only stun: or stuns: URLs.')
  }

  const turnUrls = list(env.VITE_TURN_URL)
  if (turnUrls.some((url) => !/^turns?:/i.test(url))) {
    throw new Error('VITE_TURN_URL must contain only turn: or turns: URLs.')
  }

  const username = String(env.VITE_TURN_USERNAME ?? '').trim()
  const credential = String(env.VITE_TURN_CREDENTIAL ?? '').trim()
  if (Boolean(username) !== Boolean(credential)) {
    throw new Error('VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL must be set together.')
  }
  if (turnUrls.length && (!username || !credential)) {
    throw new Error('TURN URLs require both VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL.')
  }
  if (!turnUrls.length && (username || credential)) {
    throw new Error('TURN credentials require VITE_TURN_URL.')
  }
}

export function buildIceServers(env = {}) {
  validateIceConfiguration(env)
  const stun = list(env.VITE_STUN_URL)
  const iceServers = [{ urls: stun.length ? stun : [...DEFAULT_STUN_URLS] }]

  const turnUrls = list(env.VITE_TURN_URL)
  if (turnUrls.length) {
    const username = String(env.VITE_TURN_USERNAME ?? '').trim()
    const credential = String(env.VITE_TURN_CREDENTIAL ?? '').trim()
    iceServers.push({ urls: turnUrls, username, credential })
  }

  return { iceServers }
}

export const ICE_SERVERS = buildIceServers(import.meta.env || {})
