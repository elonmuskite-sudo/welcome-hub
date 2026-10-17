# Chat refresh
## Account verification and welcome email
- [ ] Restore native email verification, sign-up, sign-in, and safe password recovery.
- [ ] Add a branded animated welcome email sent once after email confirmation via connected Resend.
- [ ] Verify account flows and delivery; document any production prerequisites.

- [x] Repair message history, realtime cache updates, and sending errors; reject non-shareable attachments.
- [x] Add reaction event persistence, replies, copy, and conversation search.
- [x] Restore chat styling, transitions, and mobile chat access.
- [x] Run focused tests, lint, preview build checks, and isolated browser interaction/persistence checks.
- [ ] Verify real account-to-account message delivery and reactions — blocked by unavailable signed-in test session for the existing external authentication service.
- [x] Enable file and voice delivery via Supabase Storage (chat-files bucket, storage_files tracking).
- [ ] Verify encrypted delivery — blocked by missing peer public-key exchange; unsafe self-key fallback now fails explicitly.

# Spec: attachments, identity, sessions, sync
- [x] 5GB per-user storage quota with real-time upload validation (45s video cap, format checks, quota blocking).
- [x] Settings → Storage section: usage metrics, per-type breakdown, individual/bulk delete with instant stats refresh.
- [x] Persistent sessions (Supabase persistSession + autoRefreshToken) and logout only in Settings and header profile dropdown.
- [x] Contacts synced to Supabase per user with realtime updates across devices.
- [x] Paid storage upgrades via NOWPayments (needs NOWPAYMENTS_API_KEY / NOWPAYMENTS_IPN_SECRET).
- [x] Facial ID verification (on-device face match) + blue/gold badges + admin review RPC; apply new schema SQL to production.

# Backend credentials
- [x] Use own Supabase; strip Appwrite; schema SQL + admin bootstrap; build needs only Supabase keys
- [ ] Fill Vercel env vars, run schema SQL, set NOWPayments/Resend function secrets in Supabase — waiting on user
- [x] Admin diagnostics page (/admin/diagnostics) and member billing history (Settings → Billing history)
- [ ] Run schema + push Vercel env via GitHub Action "Set up production" — waiting on user's repo secrets

# GitHub sync
- [x] Verify project syncs to a connected GitHub repository — confirmed: private repo `elonmuskite-sudo/connect-hub`, tracked branch `main`; a commit landed on `main` within seconds, and app files verified present there.
