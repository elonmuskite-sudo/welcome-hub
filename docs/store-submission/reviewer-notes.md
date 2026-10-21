# App reviewer notes — Nexus Chat

Notes for Google Play and Apple App Review. App: **Nexus Chat** ·
`com.nexus.chat.app` · 13+.

---

## 0. Demo accounts for review

Sign-up requires a one-time email code, so reviewers cannot create their own
account. **Two accounts are already created and pre-verified** in the live
project — no email is needed to sign in. Paste the passwords below into the store
console's review/access form (they are deliberately not stored in this
repository).

| | Account 1 | Account 2 |
| --- | --- | --- |
| Email | `demo1@nexus-chat-world.com` | `demo2@nexus-chat-world.com` |
| Password | see `.demo-accounts.local.json` (gitignored) | see `.demo-accounts.local.json` (gitignored) |
| Nexus ID | `1000000001` | `1000000002` |
| Display name | Demo Reviewer One | Demo Reviewer Two |
| Email state | confirmed server-side (`email_verified = true`) | confirmed server-side (`email_verified = true`) |
| E2EE | enabled (`e2ee_enabled = true`) | enabled (`e2ee_enabled = true`) |

Verified on creation by `node scripts/create-demo-accounts.mjs`, which checks the
`public.members` row and then performs a real password-grant sign-in as the app
does. Re-run that script any time to rotate the passwords (it rewrites
`.demo-accounts.local.json` and re-verifies both accounts).

The feed already contains three posts authored by these two accounts (with
reactions and a comment) so the signed-in surfaces do not look empty on first
launch. They are ordinary posts — created by the accounts themselves, not
injected as system content — and can be reported or blocked from the UI like any
other. No conversation exists between the two accounts at submission time, so
test case 2 starts from a genuinely empty thread.

### How to sign in

1. Launch the app and choose **Sign in**.
2. Enter the email in the table above.
3. Enter the matching password from `.demo-accounts.local.json`.
4. Tap **Sign in**. **Do not** tap "Create account" — that path sends an email
   code and is not needed for either demo account.

These demo accounts use the regular member role and do not receive privileged
admin access. Admin/reviewer accounts with privileged dashboard access must use
Supabase Auth and complete the required TOTP authenticator setup or challenge
before any admin route is available. Never put authenticator secrets or OTP
codes in the store review notes. The opt-in Appwrite provider does not yet
support privileged admin routes or identity-review decisions.

Successful sign-ins send a security alert to the account's confirmed email
address. Privileged admin alerts are sent only after TOTP verification.
Supabase identity-review decisions send an approved/rejected status email to
the reviewed account's confirmed email address; SMS is not used. Appwrite
identity-review decisions remain unavailable until provider-specific MFA is
implemented.

### Suggested review test cases

| # | Test | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Sign in | Account 1, per above | Lands on the chat home screen |
| 2 | Encrypted messaging | Account 1 → New chat → search Nexus ID `1000000002` → send a message | Message delivers; Account 2 receives it |
| 3 | Read receipt from the other side | Sign in as Account 2 and open the conversation | Account 1's message is visible |
| 4 | Voice note confirmation | Record a voice note in a chat | A Send / Delete confirmation modal appears; nothing is sent automatically |
| 5 | Feed + UGC controls | Open **Feed** with Account 1 | Posts from Account 2 are visible, shown under the author's display name |
| 6 | Report content | Feed → **⋯** on a post → **Report** → pick a reason | Report is accepted and confirmed |
| 7 | Block a member | Feed → **⋯** on Account 2's post → **Block** | Account 2's posts and comments disappear from the feed |
| 8 | Manage blocks | **Settings → Account → Blocked accounts** | Account 2 is listed and can be unblocked |
| 9 | E2EE status | **Settings → Privacy & Security** | End-to-end encryption shows as enabled |
| 10 | Free, no paywalls | **Settings** | No purchase, upgrade or billing entry anywhere |
| 11 | Delete account (optional) | **Settings → Account → Delete account** → type `DELETE` | Account removed and signed out — see §3. Reviewers can use a second account for this. |

> Deleting an account is irreversible. Reviewers should use Account 2 for test
> case 11, or create a throwaway account, so Account 1 stays available.

---

## 1. Business model — free, with no paywalls

Nexus Chat is **completely free**. There is nothing to buy and no way to pay us.

- No subscriptions, no paid tiers, no storage upgrades, no in-app purchases.
- No advertising and no ad SDK.
- Storage is a single fixed allowance included with every account.

**How to verify (no purchase UI can be found):**
1. Sign in and open **Settings** — there is no billing, upgrade, or purchase entry.
2. Open **Settings → Storage** — usage is shown, but there is no "buy more" action.
3. There is no payment gateway, checkout, or IAP product anywhere in the build
   (`package.json` contains no payment or billing SDK).

**For Google Play reviewers:** the app declares **no in-app products**, so the
"App access" → purchase flow does not exist.

---

## 2. End-to-end encryption (E2EE)

Text-message and sticker bodies must be end-to-end encrypted on the device. Encryption is
mandatory for existing and new accounts and cannot be disabled.

- Protocol: **ECDH P-256** key agreement deriving an **AES-256-GCM** key
  (see `src/lib/crypto/e2ee.js`, protocol tag `ECDH-P256+AES-256-GCM`).
- Private keys are generated and stored **on the device only** and never leave it.
- For encrypted text messages, the server stores **ciphertext** and cannot
  decrypt the message body.
- If the sender or recipient key is unavailable or encryption fails, the text
  message is **not sent**. The sender sees an error and can retry after encryption is ready.
- Attachments and voice notes are not covered by E2EE. Do not claim these are
  end-to-end encrypted.
- The outcome is recorded server-side as `members.e2ee_enabled`; a failed key
  publication is recorded with the key-published status off.

**How to verify:**
1. Sign in and open a conversation.
2. Open **Settings → Privacy & Security** — text-message encryption is marked
   required, with a security code shown.
3. Send a message from the demo account to the second demo account; the message
   sends encrypted (keys are exchanged automatically on first contact).

**Notes for review:**
- E2EE applies to **all text messages**. Public social-feed posts
  are not encrypted (they are public by nature), and attachments and voice notes
  are not end-to-end encrypted.
- Verify fail-closed behavior by attempting to send while the recipient key is
  unavailable: no message should be created or delivered; the sender sees an
  error instead. There is no plaintext opt-out.

---

## 3. Account deletion (in-app, no email required)

Users can delete their account and data entirely from inside the app.

**Step-by-step:**
1. Sign in and open **Settings**.
2. Choose **Account**.
3. Scroll to **Delete account** and tap **Delete my account**.
4. In the confirmation dialog, type **`DELETE`** to confirm.
5. Tap **Delete account**. The app calls the server function `delete-account`,
   which verifies the signed-in session, then removes the account and its
   associated personal data and signs the user out.

**Verification:** the confirmation is gated on typing the exact word `DELETE`,
and the deletion is performed server-side (a client cannot delete an account it
does not own). Account deletion is therefore available in-app, satisfying both
stores' account-deletion requirements.

---

## 4. User reporting and content blocking (UGC safety)

The social feed is user-generated content, and every surface with UGC provides
**report** and **block**.

### Report content or a member
1. In the **feed**, tap the **⋯** menu on any post (or **Report** on a comment).
2. Choose a reason (for example spam, harassment, or objectionable content).
3. Submit. The report is recorded with the reason and the reporter.

Reports are stored in `content_reports` and surfaced to moderators in the **admin
dashboard**, where each report can be reviewed and resolved. This is the
mechanism by which objectionable content is actioned.

### Block a member
1. In the **feed**, open the **⋯** menu on a post by that member and choose
   **Block**, or report first and block from the same menu.
2. The member's **posts and comments are immediately hidden** from your own feed.
3. Manage or unblock anyone from **Settings → Account → Blocked accounts**.

Blocks are stored in `blocked_users`; the feed filters blocked authors out
client-side and server-side.

**Compliance notes:**
- Objectionable content can be reported from the post, the comment, and the
  member's actions menu.
- Blocking removes the abusive user's content from the reporter's view.
- Reports and moderation actions are logged for traceability.

---

## 5. Posted-content moderation (for Apple 1.2 & Play UGC policy)

- The Terms of service state there is **no tolerance for objectionable content or
  abusive behaviour**.
- Users can report and block as above.
- Moderators review the report queue and can remove content or suspend accounts.
- Support contact for abuse reports: **support@nexus-chat-world.com**.

---

## 6. Permissions and privacy

- **Microphone** (`RECORD_AUDIO` on Android, `NSMicrophoneUsageDescription` on
  iOS): used only when the user records a voice note or starts a voice call.
- **Camera/photos**: used only when the user picks media to send or chooses
  manual identity verification.
- **No tracking:** there is no analytics, attribution, crash-reporting, or
  advertising SDK, and no IDFA/Advertising ID access. The app does **not** use
  data for tracking, so App Tracking Transparency is not required and no
  `NSUserTrackingUsageDescription` is present.
- The app does **not** read the device address book; contacts are found by a
  10-digit Nexus ID.

---

## 7. Final cross-check before submission

| # | Item | Where | Status |
| --- | --- | --- | --- |
| 1 | Free model, no paywalls stated in listing + notes | `store-listing.md`, §1 here | ✅ |
| 2 | E2EE described (protocol + verification steps) | `privacy-disclosures.md`, §2 here | ✅ |
| 3 | Account deletion steps correct (Settings → Account → `DELETE`) | §3 here | ✅ |
| 4 | Report + block steps correct | §4 here | ✅ |
| 5 | Data Safety / App Privacy answers complete | `privacy-disclosures.md` | ✅ |
| 6 | Listing copy within all character limits | `store-listing.md` | ✅ |
| 7 | Screenshots at required resolutions | `screenshots/` | ✅ 45 generated, public + signed-in incl. encrypted chat thread |
| 8 | Demo accounts created and pre-verified | §0 here | ✅ created; sign-in verified |
| 9 | Release signed and bundle compiles | `signing.md` | ✅ verified (AAB signed, fingerprint matches) |
| 10 | Privacy policy reachable without an account | `/privacy`, `/terms` | ✅ |
