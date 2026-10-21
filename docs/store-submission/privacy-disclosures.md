# Store privacy disclosures — Nexus Chat

Answers for the **Google Play Console → Data safety** form and the
**Apple App Store Connect → App Privacy** section. Both are written from what the
app actually does (see `src/pages/LegalPage.jsx`, `docs/supabase-schema.sql`, and
`src/lib/e2ee.js`), so they stay consistent with the published Privacy Policy at
`https://nexus-chat-world.com/privacy`.

App: **Nexus Chat** · `com.nexus.chat.app` · free, no purchases · 13+ · no ads, no analytics, no tracking SDKs.

---

## 1. Google Play — Data safety

### Overview answers (top of the form)

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data is deleted? | **Yes** (Settings → Account → Delete account) |
| Does your app collect or share location data? | **No** |
| Has your app been independently reviewed against a global security standard (MASA)? | **No** |
| Is your app designed for children? (Families policy) | **No** — 13+ |

### Data types: collected and/or shared

For every row below **Shared = No** (see "Third parties" note). **Processed
ephemerally = No**. **Required = Optional** unless stated.

| # | Category → Data type | Collected | Purpose | Optional? |
| --- | --- | --- | --- | --- |
| 1 | Personal info → Name | Yes | App functionality, Account management | No (required at signup) |
| 2 | Personal info → Email address | Yes | App functionality, Account management | No (required at signup) |
| 3 | Personal info → Phone number | Yes | Optional account phone verification and transactional SMS alerts | Yes |
| 4 | Personal info → User IDs (Nexus ID / member number) | Yes | App functionality, Account management | No |
| 5 | Personal info → Other info (avatar, bio, interests) | Yes | App functionality | Yes |
| 6 | Photos and videos → Photos | Yes | App functionality (avatar, chat images, feed media) | Yes |
| 7 | Photos and videos → Videos | Yes | App functionality (chat video attachments) | Yes |
| 8 | Files and docs | Yes | App functionality (chat document attachments) | Yes |
| 9 | Audio → Voice or sound recordings | Yes | App functionality (voice notes, call audio) | Yes |
| 10 | Messages → Other in-app messages | Yes | App functionality (delivery of messages) | Yes |
| 11 | App activity → Other user-generated content (posts, comments, reactions) | Yes | App functionality | Yes |
| 12 | Personal info → Government IDs (manual identity verification only) | Yes | App functionality (identity verification) | Yes |
| 13 | Photos and videos → Photos (selfie, manual verification only) | Yes | App functionality (identity verification) | Yes |

### Not collected (leave unchecked)

Location (approx./precise) · Financial info (payment info, purchase history,
credit score) · Health and fitness · Contacts (device address book — the app
looks up members by Nexus ID, it never reads your phone's contacts) · Calendar ·
Web browsing history · Installed apps · Device or other IDs · Advertising ID ·
Crash logs · Diagnostics · Performance data.

> No advertising ID and no device identifiers are read. There is no analytics,
> attribution, crash-reporting, or advertising SDK in `package.json`.

### Messages and encryption note

Text-message and sticker bodies must be end-to-end encrypted on the device (ECDH P-256 key
agreement, AES-256-GCM payloads). Encryption is mandatory for all accounts and
cannot be disabled. If the sender or recipient key is unavailable, or encryption
fails, the app blocks the text message instead of sending plaintext. Attachments
and voice notes are not covered by E2EE and are stored for delivery. Row 9 is
disclosed because message contents and delivery metadata are collected.

### Third parties (for the "sharing" definition)

We do **not** sell data and do **not** share it for advertising. These vendors
are **service providers processing data on our behalf**, which Play treats as
"collection", not "sharing":

- **Supabase** — database, authentication, file storage.
- **Resend** — transactional email (verification codes, one-time welcome email).
- **Twilio** — optional transactional SMS to a phone number the user verifies and
  explicitly opts in to use for sign-in security alerts and identity-review
  status updates. Phone verification codes are sent through Supabase Auth's
  configured Twilio SMS provider. No marketing messages are sent. SMS is not
  currently enabled in production until the provider is configured.
- **Vercel / Cloudflare** — application hosting and delivery.

### Data handling summary (for the "how data is handled" section)

- **Deletion:** users delete their own account in Settings → Account; account and
  associated personal data are removed.
- **Encryption in transit:** TLS for every request.
- **Encryption at rest:** provided by our infrastructure providers.

---

## 2. Apple App Store Connect — App Privacy

### Tracking

| Question | Answer |
| --- | --- |
| Does the app use data for tracking (as defined by Apple)? | **No** |

Because the answer is No, App Tracking Transparency is **not** required and no
`NSUserTrackingUsageDescription` is needed. The privacy manifest should declare
no tracking domains.

### Data Linked to You

Collected and linked to the user's identity, all used for **App Functionality**:

| Category → Data type | Linked to user | Purpose | Notes |
| --- | --- | --- | --- |
| Contact Info → Name | Yes | App Functionality | First/last name at signup |
| Contact Info → Email Address | Yes | App Functionality | Account + verification email |
| Contact Info → Phone Number | Yes | App Functionality | Optional; verified for transactional SMS only |
| Identifiers → User ID | Yes | App Functionality | Nexus ID / member number |
| User Content → Photos or Videos | Yes | App Functionality | Avatar, chat media, feed media |
| User Content → Audio Data | Yes | App Functionality | Voice notes, call audio |
| User Content → Other User Content | Yes | App Functionality | Messages (E2EE ciphertext), posts, comments, bio |
| Sensitive Info → (Government ID / selfie) | Yes | App Functionality | Only if the user opts into manual verification |

### Data Not Linked to You

Only if you later add crash reporting: none today. **Nothing** in the app sends
crash or diagnostics data.

### Not collected

Location · Contacts · Browsing History · Search History · Financial Info ·
Health & Fitness · Usage/Advertising data · Purchases.

### Purposes summary

Every linked data type above is used for **App Functionality** only. There is no
Analytics, Product Personalization, Advertising, or "Other" purpose.

---

## 3. Cross-checks before submitting

- [ ] Play privacy policy URL: `https://nexus-chat-world.com/privacy`
- [ ] Play account-deletion URL: `https://nexus-chat-world.com/delete-account`
      (public request instructions; in-app deletion is also available at
      **Settings → Account → Delete account**)
- [ ] Apple privacy policy URL: `https://nexus-chat-world.com/privacy`
- [ ] Disclosures match the published Policy (name, email, optional phone, messages, media,
      contacts/feed, optional ID verification, technical data).
- [ ] "Free, no purchases" is stated in the listing and reviewer notes so it
      cannot look like a hidden paywall.
- [ ] No analytics/ads SDK present in `package.json` (verified).
