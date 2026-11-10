# Hybrid attachment storage (Supabase Storage + Cloudflare R2)

Chat attachments and feed media are stored in two tiers. Small files keep using
Supabase Storage, so nothing changes for the common case. Large files are
offloaded to a Cloudflare R2 bucket to relieve the single fixed 5 GB Supabase
quota every account shares.

## Routing rule

- `size <= 2 MiB` → Supabase Storage (unchanged path).
- `2 MiB < size <= 50 MiB` → Cloudflare R2 via a server-issued presigned `PUT`.
- `size > 50 MiB` → rejected by the server with `413`.

The threshold lives in `src/lib/storageReferences.js`
(`R2_UPLOAD_THRESHOLD_BYTES`) and is re-checked server-side
(`R2_MAX_UPLOAD_BYTES` in `server/r2.js`). Client code never sees R2
credentials.

## Reference format

R2 objects are persisted as `r2://<objectKey>`, where the key is
`<ownerId>/<scope>/<timestamp>-<name>`:

- `ownerId` — the uploading member's Supabase auth UUID (authorises signing and
  deletion).
- `scope` — the chat id, the literal `feed`, or `direct`.
- A `r2://` reference is stored in the existing `messages.file_url` and
  `feed_posts.media[].url` fields; no schema change is required.

## Server endpoint: `POST /api/storage`

`api/storage.js` authenticates the caller's Supabase access token, then handles:

| Action | Purpose |
| --- | --- |
| `prepare` | Validate size and presign a `PUT` for a new object. Returns `{ objectKey, uploadUrl, reference }`. |
| `finish` | Verify the object exists (`HEAD`), virus-scan it when a scanner is configured, and insert a `storage_files` row with `storage_path = 'r2://<key>'`. Deletes the object on failure or an infected result. |
| `sign` | Issue short-lived signed `GET` URLs (up to 50 keys per call) for objects the caller may read. |
| `delete` | Remove the caller's own objects and their `storage_files` rows. |

Read access (`canReadKey`) is granted when the caller owns the key, the key is
public feed media (`scope === 'feed'`), the key is referenced by a message in one
of the caller's chats, or the caller is an admin. Everything else is silently
omitted from the response.

## Read-back path

`src/lib/storageManager.js` exposes `resolveMediaUrl(reference)`. `r2://`
references are resolved to a signed `GET` URL (1 hour TTL) on demand; the
requests made in the same tick are coalesced into one `sign` call and the results
are cached until shortly before expiry. `src/hooks/useMediaUrl.js` wraps this for
React components. Renders that can hold R2 media:

- `src/components/chat/MessageBubble.jsx` (chat attachments)
- `src/pages/FeedsPage.jsx` (feed grid + composer)
- `src/components/AdminFeedManager.jsx` (admin feed composer)

## Fallback

When R2 is not configured the server answers `503`, and `uploadChatFile` falls
back to the Supabase Storage path, so a large upload still succeeds (subject to
the 5 GB quota). A partially configured R2 group blocks the Vercel env sync and
is reported by `npm run env:validate`.

## Environment

Server-only keys (synced to Vercel Production as **encrypted** variables):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

`VITE_R2_PUBLIC_BASE_URL` must stay **empty**. The bucket's public access
(`r2.dev`) is disabled; re-enabling it would expose private chat attachments to
anyone holding the object URL.

## Storage RLS hardening (chat-files)

The `chat-files` bucket read policy was narrowed from any signed-in user to the
owner's own folder (or an admin). See
`supabase/migrations/20261110000000_chat_files_read_owner_scope.sql` and the
canonical `docs/supabase-schema.sql`. Apply the migration to the production
Supabase project (it is not managed from this workspace).

## Verification

- `node --test tests/*.test.mjs` — routing/reference rules and feed media
  acceptance (`tests/storageReferences.test.mjs`, `tests/feedContent.test.mjs`).
- `npm run build` — client compiles with the new read-back path.
- `npm run vercel:env:dry` — confirms the R2 keys are staged for sync.

## Deployment checklist

1. Apply the chat-files RLS migration to production Supabase.
2. `npm run vercel:env:sync` — push the R2 keys (encrypted) to Vercel Production.
3. `npm run build` and deploy to Vercel Production.
4. Smoke-test a >2 MiB upload in a chat and in the feed, then confirm the signed
   `GET` URL resolves and the object is registered in `storage_files`.
5. Watch Vercel function logs for `/api/storage` 4xx/5xx and R2 latency after
   rollout.
