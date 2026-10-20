# End-to-end encryption enabled by default

New accounts are end-to-end encrypted (E2EE) by default. Encryption is provisioned
during signup, before the account reaches the dashboard, and is never silently
switched on or off for an account that already existed.

## What "enabled by default" means

- Every account created through the signup flow gets a device key pair.
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
- If key material cannot be created on the device, provisioning falls back to the
  legacy opt-in state (`e2ee_enabled = false`) rather than claiming encryption that
  cannot be delivered. The decision is pinned so it is never re-derived.
- Messages fail **open**: if a contact has not published a key, the message still
  sends as plaintext and the sender sees a warning banner. Encryption never blocks
  delivery.

## Compliance controls

- **Purpose limitation / data minimisation**: private keys are device-only; the
  server never holds key material capable of decrypting message content.
- **Auditability**: `public.members.e2ee_enabled` and `e2ee_key_published_at` mirror
  the device outcome for audit. Only the authenticated owner can write them, via
  `public.set_my_e2ee_status(...)` (RLS-safe, `security definer`, `auth.uid()` guarded).
- **Transparency**: a one-time, dismissible notice ("Your messages are end-to-end
  encrypted by default on this device...") is shown in `ChatLayout.jsx` after
  provisioning and can be acknowledged.
- **No retroactive change**: accounts that predate automatic enablement keep their
  existing status. `applyE2EEDefaultForExistingAccount()` pins the value on first
  boot, and the auto-enable path is only reachable from the signup branch.
- **Integrity after signup**: the device key pair is reused across launches; a
  later boot never regenerates it or disables encryption.

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
