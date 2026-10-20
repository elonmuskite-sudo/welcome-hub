# Store listing copy — Nexus Chat

Ready-to-paste listing copy for **Google Play Console** and **Apple App Store
Connect**. Master locale **en-GB**. Character limits are noted and each field is
within them.

App: **Nexus Chat** · `com.nexus.chat.app` · free, no in-app purchases · 13+.

---

## 1. Google Play Console

### Main store listing

| Field | Limit | Value |
| --- | --- | --- |
| App name | 30 | `Nexus Chat` |
| Short description | 80 | `Encrypted messaging, voice calls and a private social feed. Free, no ads.` |
| Full description | 4000 | see below |
| App category | — | **Communication** (alternative: Social) |
| Tags | up to 5 | `Messaging`, `Encrypted chat`, `Voice calls`, `Social`, `Privacy` |
| Contact email | — | `support@nexus-chat-world.com` |
| Privacy policy URL | — | `https://nexus-chat-world.com/privacy` |
| Website | — | `https://nexus-chat-world.com` |

**Short description (80 char check):**
`Encrypted messaging, voice calls and a private social feed. Free, no ads.` (74)

**Full description:**

```
Nexus Chat is a secure, modern way to stay in touch. Send end-to-end encrypted
messages, make voice calls, share photos, videos and files, and keep up with a
private social feed — all for free, with no subscriptions, no paid tiers and no
in-app purchases.

PRIVATE BY DESIGN
• Text messages are end-to-end encrypted on your device when E2EE is enabled.
  New accounts have E2EE enabled by default when setup succeeds.
• If a contact's key is unavailable or encryption fails, the app will not send
  that text message. You can manage E2EE in Settings → Privacy.
• Attachments and voice notes are not covered by end-to-end encryption.

MESSAGING THAT KEEPS UP
• One-to-one and group conversations with delivery status.
• Voice notes you record, review, then choose to send or delete.
• Share photos, videos, documents and office files with progress and size checks.
• Reactions, replies and message metadata carried over a versioned protocol so
  nothing breaks as the app evolves.

VOICE CALLS
• Crystal-clear voice calls with cross-device signalling, so you can call from
  phone, tablet or desktop.

YOUR CONTACTS, FOUND SAFELY
• Add people with their 10-digit Nexus ID — no address book upload required.
• Search a Nexus ID to Message, Call or Save the person.

A PRIVATE SOCIAL FEED
• Post updates, photos and thoughts to your feed.
• Comment and react with a live, real-time timeline.
• Report any post, comment or member, and block anyone so their content is hidden
  from your view. Blocked accounts are managed in Settings.

VERIFY WHO YOU TALK TO
• Optional verification badges: instant on-device face matching, or manual review
  of a government ID and selfie by our team.

BUILT TO BE SAFE
• Content is sanitised before display and media links are validated.
• Reports and blocks are logged so moderators can act quickly.

FREE, HONESTLY
• Nexus Chat is free to use. There are no hidden paywalls, storage upgrades,
  subscriptions or in-app purchases. Storage is a single fixed allowance on every
  account.

Your account, your choice: edit your profile any time, and delete your account and
its data from Settings → Account or at https://nexus-chat-world.com/delete-account.

Nexus Chat is for users aged 13 and over.
```

### Graphics / store assets (Play)

| Asset | Spec | Status |
| --- | --- | --- |
| App icon | 512 × 512 PNG, 32-bit, no alpha | from `android/app/src/main/res/mipmap-*` (upscale from xxxhdpi 192px art) |
| Feature graphic | 1024 × 500 PNG/JPEG, no alpha | **to produce** |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side | see `screenshots/` (generated) |
| 7" tablet screenshots | up to 8, 320–3840 px | from the same shots, tablet viewport |
| 10" tablet screenshots | up to 8, 320–3840 px | from the same shots, tablet viewport |

---

## 2. Apple App Store Connect

### App information

| Field | Limit | Value |
| --- | --- | --- |
| Name | 30 | `Nexus Chat` |
| Subtitle | 30 | `Encrypted chat & voice calls` |
| Primary category | — | **Social Networking** |
| Secondary category | — | **Communication** |
| Age rating | — | **12+** (UGC, no unrestricted web access) |
| Privacy policy URL | — | `https://nexus-chat-world.com/privacy` |
| Support URL | — | `https://nexus-chat-world.com` |

### Version information

| Field | Limit | Value |
| --- | --- | --- |
| Promotional text | 170 | see below |
| Description | 4000 | see below |
| Keywords | 100 | see below |
| What's New | 4000 | see below |

**Promotional text (170 char check):**
`Now with end-to-end encryption on by default for every new account. Free messaging, voice calls and a private social feed — no ads, no subscriptions, no in-app purchases.` (172 → trim to 170)

Use this trimmed version (166 chars):
```
End-to-end encryption on by default for every new account. Free messaging, voice calls and a private social feed — no ads, no subscriptions, no in-app purchases.
```

**Keywords (100 char check):**
```
messaging,encrypted,chat,private,voice,call,secure,social,feed,privacy,free,messages,dm
```
(94 chars — no spaces, comma-separated, no brand names.)

**Description:** use the same body as the Google Play full description above
(Apple allows 4000 chars; the copy is 2.4k and within limit).

**What's New (1.0):**
```
First release of Nexus Chat.

• End-to-end encrypted private messages, enabled by default for new accounts.
• Voice calls with cross-device signalling.
• Contacts by 10-digit Nexus ID — no address book upload.
• Private social feed with posts, comments, reactions, reporting and blocking.
• Optional identity verification badges.
• Free to use: no purchases, no subscriptions, no ads.
```

### Screenshots (Apple)

Required device sizes (latest spec):

| Display | Required? | Resolution (portrait) |
| --- | --- | --- |
| 6.9"/6.7" iPhone | **Required** | 1320 × 2868 or 1290 × 2796 |
| 6.5" iPhone | Optional if 6.7" supplied | 1242 × 2688 |
| 5.5" iPhone | Optional | 1242 × 2208 |
| iPad 13"/12.9" | Required if app supports iPad | 2064 × 2752 or 2048 × 2732 |

Portrait only (app is portrait-oriented on phones). 3–10 shots per size,
no device frames required, no alpha channel.

---

## 3. Localization

Store the master strings above in en-GB. To localize, create one column per
locale below and have a native speaker translate/verify before publishing.
Fields to localize (per locale): **name** (usually kept as brand), **short
description / subtitle**, **full description**, **promotional text**,
**keywords**, **What's New**.

| Field | en-GB (master) | fr-FR | de-DE | es-ES | pt-BR | ar | hi | zh-Hans |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| App name | Nexus Chat | — | — | — | — | — | — | — |
| Subtitle / short desc | Encrypted chat & voice calls | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| Promotional text | … | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| Full description | … | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| Keywords | … | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

> Do not ship machine-only translations for the Arabic, Hindi and Chinese
> listings; review them with a native speaker so store review and users see
> correct copy. Right-to-left (ar) needs its own screenshot set.
