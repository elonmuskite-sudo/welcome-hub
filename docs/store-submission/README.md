# Store submission package — Nexus Chat

Index of the pre-launch materials and the final cross-check across all five
submission tasks. App: **Nexus Chat** · `com.nexus.chat.app`.

---

## Materials

| File | Covers |
| --- | --- |
| [privacy-disclosures.md](./privacy-disclosures.md) | Google Play **Data safety** and Apple **App Privacy** answers |
| [store-listing.md](./store-listing.md) | Title, short/full descriptions, promotional text, keywords, category, localization matrix |
| [reviewer-notes.md](./reviewer-notes.md) | App reviewer notes (free model, E2EE, deletion, report/block) + demo accounts + reviewer checklist |
| [signing.md](./signing.md) | Android release signing (configured + verified) and iOS distribution signing steps |
| [console-runbooks.md](./console-runbooks.md) | Credential backup, Apple Developer setup, Play App Signing enrolment, console paste map |
| [upload_certificate.pem](./upload_certificate.pem) | Public upload certificate for the Play Console (no private key) |
| [screenshots/](./screenshots/) | Device-specific screenshots + the 1024 × 500 feature graphic |

---

## 1. Database migrations — complete

Three migrations were pending, not two (`20261017080000`, `20261020090000`,
`20261020100000`). All three are applied to the production project.

| Step | Result |
| --- | --- |
| Pre-migration backup (`scripts/backup-supabase.js`) | 21 tables / 55 rows; SHA-256 `085a150c…f934f5` |
| Apply (`scripts/apply-pending-migrations.mjs`) | 3 migrations in one transaction, recorded in `supabase_migrations.schema_migrations` |
| Object verification (`scripts/verify-migration-objects.mjs`) | 19 / 19 checks pass |
| Schema verification (`npm run db:verify`) | 22 migrations listed, pass |
| `payment-qr` storage bucket | Removed via the Storage API (`scripts/remove-payment-qr-bucket.mjs`) |

Data integrity: the original attempt failed mid-transaction on a Supabase
`storage.protect_delete()` trigger and rolled back atomically — no partial
writes. The retry committed cleanly.

---

## 2. Signing configuration — Android done, iOS needs your Apple account

| Item | Status |
| --- | --- |
| Android release keystore + alias + strong random passwords | ✅ generated (`android/app/nexus-release.keystore`, `android/key.properties`) |
| `signingConfigs.release` wired into `android/app/build.gradle` | ✅ |
| Release bundle builds and is signed | ✅ `BUILD SUCCESSFUL`, `app-release.aab` (6.9 MB), certificate fingerprint verified |
| Public upload certificate for Play | ✅ `upload_certificate.pem` exported (no private key) |
| iOS arm64 capability fix | ✅ (`armv7` → `arm64`) |
| iOS signing identity | ✅ legacy `CODE_SIGN_IDENTITY = "iPhone Developer"` removed from the Release config so an archive resolves `Apple Distribution`, not a development identity (`ITMS-90034`) |
| `.vercelignore` secret guard | ✅ `.env*`, `*.keystore`, `*.jks`, `*.pem`, `android/key.properties`, `.demo-accounts.local.json` are excluded from CLI deployments, not just from git |
| iOS App ID / distribution certificate / provisioning profile | **manual** — requires your Apple Developer account |
| Play App Signing enrolment | **manual** — Play Console |

> **Back up `android/key.properties` and the keystore now.** The passwords were
> generated on this machine and deliberately never printed. Fingerprints to verify
> the restore against are in
> [console-runbooks.md](./console-runbooks.md) §1.

---

## 3. Privacy disclosures — complete

- Google Play **Data safety**: 12 collected data types catalogued, no data
  shared/sold, no advertising ID, encryption-in-transit = Yes, deletion = Yes.
- Apple **App Privacy**: no tracking (no ATT needed); data linked to the user is
  limited to name, email, user ID, photos/videos, audio, other user content and
  optional government-ID verification — all for **App Functionality**.
- Consistent with the published policy at `https://nexus-chat-world.com/privacy`
  and with the code (no analytics/ads SDK in `package.json`).

Both forms still have to be pasted into the consoles manually — the answers are
final, the submission is not automatable from here.

---

## 4. Listing assets — complete

- Copy written and within every character limit (Play short 74/80, Apple
  promotional 166/170, keywords 94/100, descriptions under 4000).
- Category/age recommendations: Play **Communication**; Apple **Social
  Networking** (secondary Communication), rating **12+**.
- Localization matrix provided for fr-FR, de-DE, es-ES, pt-BR, ar, hi, zh-Hans;
  translations must be verified by a native speaker before publishing.
- 45 screenshots generated at store resolutions (9 per device set: welcome,
  sign-in, create account, home, feed, contacts, privacy & security, account,
  encrypted chat thread), plus the **1024 × 500 Play feature graphic**
  (`screenshots/feature-graphic-1024x500.png`) with the app name and value
  proposition overlaid.

| Device set | Resolution | Listing |
| --- | --- | --- |
| `play-phone` | 1080 × 1920 | Google Play (phone) |
| `play-tablet-7` | 1200 × 1920 | Google Play (7" tablet) |
| `play-tablet-10` | 1600 × 2560 | Google Play (10" tablet) |
| `ios-6.7` | 1290 × 2796 | App Store (6.7" iPhone) |
| `ios-ipad-13` | 2048 × 2732 | App Store (13" iPad) |
| `feature-graphic-1024x500` | 1024 × 500 | Google Play (feature graphic) |

Regenerate with `npm run store:screenshots`. Signed-in surfaces (home, feed,
contacts, privacy & security, account) are captured automatically when
`NEXUS_DEMO_EMAIL` and `NEXUS_DEMO_PASSWORD` are set — the demo passwords in
`.demo-accounts.local.json` can be used for this. The generator waits for the app
shell (`.chat-shell`) before each signed-in capture, so an auth-restore race can
never produce a blank white listing image.

### Seeded demo content

Reviewers expect the listing to look like a used app, so the demo accounts carry
a small amount of real content:

```powershell
node scripts/demo-content.mjs seed-feed      # 3 active posts + reactions + a comment
node scripts/store-screenshots.mjs --seed-chat   # 45 images incl. the chat thread
node scripts/demo-content.mjs cleanup-chat   # remove the seeded conversation
```

`--seed-chat` signs both accounts in on separate browser profiles, enables E2EE
on each, creates one conversation and messages it through the real UI, so
`09-chat-thread.png` shows genuine ciphertext decrypted on a device holding the
private key — not a mock. Any conversation left by an earlier run is cleared
first (its device key no longer exists, so it could never be decrypted again).
The feed posts are intentionally left in place; `--seed-chat` is not needed to
regenerate the other 8 images, and a plain run leaves the existing
`09-chat-thread.png` untouched rather than overwriting it.

---

## 5. Reviewer notes — complete

[reviewer-notes.md](./reviewer-notes.md) documents, with verification steps for
each:

1. **Free to use** — no subscriptions, tiers, storage upgrades, IAP or ads, and
   no purchase UI anywhere.
2. **E2EE** — ECDH P-256 → AES-256-GCM for text messages while enabled; keys
   device-only; sending fails closed if encryption cannot be completed. New
   accounts enable it by default when setup succeeds. Attachments and voice
   notes are not covered by E2EE.
3. **Account deletion** — Settings → Account → Delete account → type `DELETE`,
   executed server-side by the `delete-account` function.
4. **Reporting and blocking** — report from the post/comment/member `⋯` menu,
   block hides the author's content, manage blocks in Settings → Account,
   admins review reports in the dashboard.

Two **pre-verified demo accounts** are live and were confirmed by a real
password-grant sign-in (§0):

| | Account 1 | Account 2 |
| --- | --- | --- |
| Email | `demo1@nexus-chat-world.com` | `demo2@nexus-chat-world.com` |
| Nexus ID | `1000000001` | `1000000002` |

Passwords are in the gitignored `.demo-accounts.local.json`. Re-run
`node scripts/create-demo-accounts.mjs` to rotate them.

---

## Final cross-check

| # | Task | Status | Remaining manual step |
| --- | --- | --- | --- |
| 1 | Database migrations applied + verified | ✅ | — |
| 2 | Android signing configured, bundle builds and is signed | ✅ | Enrol in Play App Signing |
| 2a | Public account-deletion request page | ✅ | Verify URL after website deployment |
| 2b | iOS distribution signing | ⛔ blocked | Requires your Apple Developer account |
| 3 | Data safety + App Privacy answers written | ✅ | Paste into Play Console / App Store Connect |
| 4 | Listing copy + screenshots + feature graphic | ✅ | Paste copy; verify translations if localizing |
| 5 | Reviewer notes + demo accounts | ✅ | Paste reviewer notes + credentials into both consoles |
| 6 | Credential backup runbook + fingerprints | ✅ | Deposit into your vault and do one restore test |

### Open items that only you can close

1. **Deposit the keystore, `android/key.properties` and
   `.demo-accounts.local.json` into your password manager** and run one restore
   test — procedure and fingerprints in
   [console-runbooks.md](./console-runbooks.md) §1.
2. **Apple Developer account**: register the App ID, create the distribution
   certificate and provisioning profile, then archive and upload (§2).
3. **Enrol in Play App Signing** and upload `upload_certificate.pem` (§3).
4. **Paste the disclosures and listing copy** into both consoles using the
   field-by-field map (§4).
5. **Have the localization translations verified** by a native speaker before
   publishing any non-English listing.
