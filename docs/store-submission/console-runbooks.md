# Manual submission steps — runbooks

Four tasks from the pre-launch list cannot be executed from this machine because
they need accounts and vaults I have no access to: a secure credential store, the
Apple Developer portal, and the Google Play Console. Everything that *can* be
prepared locally has been; these are the exact steps to finish each one.

---

## 1. Back up the signing material (do this first)

### What must be backed up

| Item | Path | Size | SHA-256 |
| --- | --- | --- | --- |
| Android release keystore | `android/app/nexus-release.keystore` | 2,756 B | `5F33A5395D2737F51CE2C23B9D0828C3755B34A973403B3A025DF64BC47ABB56` |
| Keystore + key passwords | `android/key.properties` | 198 B | `58B10E6ACA5DED3E3B9A4A43D409E15855A5812D9C57A1D29EB5859D454BEFED` |
| Demo account passwords | `.demo-accounts.local.json` | 883 B | (rotates each run — re-hash after any rotation) |

Both signing files are gitignored and must **never** be committed. The passwords
in `android/key.properties` were generated on this machine and were deliberately
never printed to any console or log — the file is the only copy.

### Certificate identity (for verification after restore)

```
Owner:             CN=Nexus Chat, OU=Mobile, O=Nexus Chat, L=London, ST=England, C=GB
Alias:             nexus-upload
Store type:        PKCS12
Key:               2048-bit RSA, SHA384withRSA
Certificate SHA-256: A8:11:DE:F1:5F:F2:A6:DE:C1:CF:91:36:12:EC:C5:2F:94:3E:78:0B:7B:88:4A:3E:3E:44:3F:92:25:80:9B:33
```

### Procedure

1. **Deposit into your password manager** (or an equivalent encrypted secret
   store). Create one secure note/attachment entry per file:
   - `Nexus Chat — Android upload keystore` (attach the `.keystore`; record the
     store password, key alias and key password as separate fields)
   - `Nexus Chat — Google Play demo accounts` (attach/enter
     `.demo-accounts.local.json`)
2. **Make it redundant** — a second independent copy in a different location
   (second vault, encrypted disk image in off-site storage, or a sealed physical
   copy). Never email the keystore or put it in cloud file storage that is not
   encrypted with a passphrase you hold.
3. **Restrict access** — owner-only. Do not add it to shared team drives.
4. **Verify the deposit** — after uploading, compare the SHA-256 of the stored
   copy against the table above:

   ```powershell
   Get-FileHash .\nexus-release.keystore -Algorithm SHA256
   ```

5. **Test restore once** — download the copy back out, then confirm the key is
   readable and the certificate matches:

   ```powershell
   keytool -list -v -keystore .\nexus-release.keystore -storetype PKCS12 `
     -alias nexus-upload -storepass '<store password from the vault>'
   ```

   The certificate SHA-256 must equal `A8:11:DE:…:9B:33`. A backup you have never
   restored is not a backup.

6. **Record the retention rule** — retain for the lifetime of the app plus the
   period Google requires after the app is removed from Play (Play keeps your
   upload key usable for app updates; losing it without Play App Signing means
   you can never publish an update to this app again).

> **Enrolling in Play App Signing (§3) is what makes a lost upload key
> recoverable.** Do both.

### Where this material must never travel

Two independent ignore lists have to hold, because they cover different exits:

| Exit | Guard | Covers |
| --- | --- | --- |
| `git push` | `.gitignore` | `android/key.properties`, `*.keystore`, `*.jks`, `.demo-accounts.local.json`, `.env`, `.env.*`, `supabase/backups/` |
| `vercel deploy` (CLI) | `.vercelignore` | the same paths, plus `*.pem` — a CLI deployment uploads the project directory and `.gitignore` does **not** apply to it |

Only `.env.example` belongs in git as a template. The tracked `.env` is a
deliberate exception: it carries browser-safe Supabase values (URL, anon key,
auth provider) and its server-only slots — `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, `ADMIN_SESSION_SECRET` — must stay empty. Live values live in
`.env.local` for local work and in Vercel env vars for production.

The one `.pem` that is safe to track is
`docs/store-submission/upload_certificate.pem`: it is a public certificate with
no private key, and it is re-included in `.gitignore` for that reason.

---

## 2. Apple Developer: App ID, certificate, provisioning profile

Everything project-side is ready: bundle ID `com.nexus.chat.app`, deployment
target iOS 13.0, `arm64` required capability, export compliance declared. The
remaining steps need your Apple Developer Program account.

1. **Create the App ID** — Certificates, Identifiers & Profiles → Identifiers →
   **+** → App IDs → App:
   - Bundle ID: **explicit**, `com.nexus.chat.app`
   - Description: `Nexus Chat`
   - Capabilities: enable only what the build uses. The app requires **no** push,
     Sign in with Apple, HealthKit or Wallet. Do **not** enable iCloud or Push
     unless you are deliberately shipping them — the App ID capability set must
     match the app's entitlements.
2. **Create the distribution certificate** — Certificates → **+** → Apple
   Distribution. Easiest path: let Xcode manage it (Xcode → Settings → Accounts →
   your team → Manage Certificates → **+** → Apple Distribution). Install it in
   the login keychain. Verify with Keychain Access: the certificate must be paired
   with a private key.
3. **Create the provisioning profile** — Profiles → **+** → Distribution →
   **App Store Connect** → select App ID `com.nexus.chat.app` → select the
   distribution certificate → name it (e.g. `Nexus Chat App Store`) → Generate →
   Download.
4. **Bind the profile to the project** — open `ios/App/App.xcworkspace` → App
   target → Signing & Capabilities → set **Team**; either leave *Automatically
   manage signing* on, or switch to manual and select the profile from step 3.
   Confirm the capability list is empty (matching step 1).
5. **Archive and upload** — Product → Archive → Distribute App → App Store
   Connect → Upload. (CLI equivalent in [signing.md](./signing.md).)
6. **Confirm the deployment target is acceptable** — iOS 13.0 is what Capacitor 6
   requires and is below Apple's current minimum, so no change is needed. If a
   future Xcode/SDK upgrade raises the floor, change it in the App target's build
   settings (`IPHONEOS_DEPLOYMENT_TARGET`) and rebuild.

---

## 3. Google Play App Signing enrolment

Enrolment happens when you create the app in Play Console and publish the first
release.

1. **Create the app** in Play Console. New apps are enrolled in Play App Signing
   automatically.
2. **Choose who holds the app signing key** — Release → Setup → **App signing**:
   - **Recommended: let Google manage and protect your app signing key.** Google
     generates and holds the app signing key; your keystore becomes the *upload
     key*. This is what makes a lost keystore recoverable.
   - Alternative: export and upload your own app signing key. Only choose this if
     you must keep an existing signing identity (for example, migrating a
     published app). It is riskier, because losing that key is unrecoverable.
3. **Register your upload key.** Upload the public certificate that has already
   been exported for you:

   ```
   docs/store-submission/upload_certificate.pem
   ```

   (App signing → Upload key certificate → **Update upload key** → upload that
   `.pem`.) It contains only the public certificate — no private key — so it is
   safe to keep in the repository. If the console asks for a fingerprint instead,
   use the SHA-256 from §1.
4. **Verify after your first upload.** Once the first bundle is processed, App
   signing shows two certificates:
   - *App signing key certificate* — held by Google, used to sign what users
     download.
   - *Upload key certificate* — must match `A8:11:DE:…:9B:33`.

   If the upload is rejected with a signing/key mismatch, the bundle was not
   signed with `nexus-upload`; rebuild with `android/key.properties` in place.
5. **Complete the other Setup items** — App content (privacy policy, ads = No,
   in-app purchases = No, content rating questionnaire, target audience 13+,
   data safety → §4), and Store listing → §4.

---

## 4. Pasting the disclosure and listing content into the consoles

All content is written and length-checked; this is a pure copy/paste mapping.

### Google Play Console

**App content** (complete these before the listing will go live):

| Console section | Answer |
| --- | --- |
| Privacy policy | `https://nexus-chat-world.com/privacy` |
| Account deletion URL | `https://nexus-chat-world.com/delete-account` — public instructions and email request path; also disclose in-app **Settings → Account → Delete account** |
| App access | Provide the demo credentials from §0 of [reviewer-notes.md](./reviewer-notes.md) |
| Ads | **No ads** |
| In-app purchases | **No** |
| Content rating | Complete the questionnaire; expected outcome 12+/Teen (UGC with reporting + blocking) |
| Target audience | 13+ |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | Paste from [privacy-disclosures.md](./privacy-disclosures.md), §1 — 12 collected types, all "Not shared", encryption in transit = Yes; disclose E2EE only applies to text while enabled and attachments/voice notes are not E2EE |
| Data deletion | Complete the account-deletion questions and use the public URL above; explain that in-app deletion is also available and requests are verified before processing |
| Government apps | No |
| Financial features | **None** |

**Store listing:**

| Field | Source |
| --- | --- |
| App name | [store-listing.md](./store-listing.md) §1 — `Nexus Chat` |
| Short description | §1 — 74/80 chars |
| Full description | §1 — the fenced block |
| App category | Communication |
| Tags | Messaging, Encrypted chat, Voice calls, Social, Privacy |
| Contact email / website | `support@nexus-chat-world.com` / `https://nexus-chat-world.com` |
| App icon | 512 × 512 PNG, no alpha |
| Feature graphic | `screenshots/feature-graphic-1024x500.png` (1024 × 500, ready) |
| Phone screenshots | `screenshots/play-phone/` (1080 × 1920) |
| 7" tablet screenshots | `screenshots/play-tablet-7/` (1200 × 1920) |
| 10" tablet screenshots | `screenshots/play-tablet-10/` (1600 × 2560) |

### Apple App Store Connect

| Section | Source |
| --- | --- |
| App name | [store-listing.md](./store-listing.md) §2 — `Nexus Chat` |
| Subtitle | §2 — `Encrypted chat & voice calls` |
| Promotional text | §2 — the 166-char version |
| Description | §2 (same body as Play) |
| Keywords | §2 — 94 chars |
| Support URL / Privacy policy URL | `https://nexus-chat-world.com` / `https://nexus-chat-world.com/privacy` |
| Primary / secondary category | Social Networking / Communication |
| Age rating | 12+ (UGC, reporting + blocking) |
| App Privacy | Paste from [privacy-disclosures.md](./privacy-disclosures.md), §2 — tracking = No; linked data limited to the seven rows listed |
| App review information | Paste §0 and §1–§4 of [reviewer-notes.md](./reviewer-notes.md) |
| Demo account | Sign-in required → provide both demo emails and the passwords from `.demo-accounts.local.json` |
| Export compliance | Uses only exempt encryption (standard OS cryptography) → answer accordingly |
| Screenshots (6.7" / 13") | `screenshots/ios-6.7/` (1290 × 2796) and `screenshots/ios-ipad-13/` (2048 × 2732) |

### After pasting — verify

1. Each console reports the field as saved without a length or format warning.
2. Automated compliance checks pass (Play: Data safety validated; App Store
   Connect: privacy questionnaire complete, no "missing information" banners).
3. Cross-check against the reviewer test cases in
   [reviewer-notes.md](./reviewer-notes.md) §0 so the credentials in the console
   match the accounts that actually work.
