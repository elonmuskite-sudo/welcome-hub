# Mandatory end-to-end encryption for text messages

All text and sticker messages must be end-to-end encrypted (E2EE). New accounts provision
encryption during signup; existing accounts enable it on their next signed-in
app boot. Users cannot switch E2EE off.

## What "enabled by default" means

- Every account gets a device key pair before it can send text messages.
- Private keys are generated on the device and stay in `localStorage`
  (`nexus_e2ee_keys`). They are never uploaded; only the public key is published.
- Messages are encrypted with the protocol `ECDH-P256+AES-256-GCM`: an ECDH P-256
  key agreement deriving an AES-256-GCM key, implemented with the Web Crypto API.

## Signup pipeline

1. The user submits the signup form, then verifies the email OTP.
2. `verifyEmailCode` (in `src/lib/AuthContext.jsx`) detects `purpose === 'signup'`
   and calls `provisionE2EEForNewAccount()` from `src/lib/crypto/e2ee.js`.
3. Provisioning records the default decision, enables the E2EE flag, generates the
   device key pair, and publishes the public key to `public.e2ee_public_keys`.
4. The outcome (`e2eeProvisioned`, `e2eeError`) is returned to `VerifyEmail.jsx`.

## Validation and fallback

- `VerifyEmail.jsx` blocks the redirect to `/app` when provisioning fails and shows
  a recoverable "Continue to Nexus" panel instead of stranding the user.
- If key material cannot be created on the device, the account remains in the
  app, but text-message sending fails until key setup succeeds.
- If the recipient has not published a key, or encryption fails, the message is
  not sent. No plaintext fallback is permitted.
- Both persistence adapters validate the encrypted envelope before sending, and
  the database rejects new text/sticker rows without the versioned E2EE envelope.
- Existing accounts are switched to mandatory E2EE at app boot. Their public key
  is published and the server-side status is synchronized; failed publication
  leaves text sending blocked and can be retried from Privacy & Security settings.

## Compliance controls

- **Purpose limitation / data minimisation**: private keys are device-only; the
  server never holds key material capable of decrypting message content.
- **Auditability**: `public.members.e2ee_enabled` and `e2ee_key_published_at` mirror
  the device outcome for audit. Only the authenticated owner can write them, via
  `public.set_my_e2ee_status(...)` (RLS-safe, `security definer`, `auth.uid()` guarded).
- **Transparency**: a one-time, dismissible notice ("Your messages are end-to-end
  encrypted by default on this device...") is shown in `ChatLayout.jsx` after
  provisioning and can be acknowledged.
- **No opt-out**: both the settings UI and send path enforce encryption for all
  text messages, including on accounts whose prior setting was off.
- **Integrity after signup**: the device key pair is reused across launches and
  is never regenerated automatically.

## Known limitation

Because private keys are device-only, a message encrypted on one device cannot be
read on another device signed into the same account. This is an intentional
trade-off: it keeps the server unable to decrypt message content. Multi-device key
sharing is out of scope.

## Schema change

The status columns and the RPC live in
`supabase/migrations/20261017080000_e2ee_default_enabled.sql`. The migration adds
`e2ee_enabled` with `default false`, so existing rows stay off, then switches the
column default to `true` so only new rows are enabled by default.
