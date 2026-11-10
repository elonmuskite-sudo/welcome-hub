# R2 object storage + 10GB per-user quota

Implementation record for the R2/S3 storage pipeline that runs alongside the
existing Supabase `chat-files` pipeline. Supabase remains the production default;
R2 is additive and takes over only when configured.

## Created files

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261028120000_user_storage.sql` | `user_storage` quota table (10GB default), `reserve_user_storage` / `commit_user_storage` row-locking functions, signup trigger, `attachments` registry table, RLS policies, and explicit function grants. |
| `api/storage/presign.js` | JWT-verified endpoint. Checks quota via `reserve_user_storage`, then returns a 900s presigned `PutObjectCommand` URL plus the object key. Returns 503 when R2 is unconfigured. |
| `api/storage/confirm.js` | Verifies the object key lives under the caller's folder, calls `commit_user_storage`, inserts the `attachments` row (idempotent on `23505`), and returns a signed read URL. Reverses the quota deduction if the registry insert fails. |
| `api/storage/url.js` | Authorises reads from the server-owned `attachments` row — never the client-supplied `channelId`. Owners, members of the owning chat, and any signed-in member for `channel_id = 'feed'` may read. Returns a stable public URL for feed media when a public base is configured. |
| `src/hooks/useChatUploader.ts` | React hook: client quota pre-check with the inline quota toast, presign request, direct binary PUT with XHR progress, then confirm. Carries `error.status` so callers can distinguish 503. |

## Modified files

| File | Change |
| --- | --- |
| `src/lib/chatFileUrl.js` | Added the `r2://` scheme: `R2_FILE_REFERENCE_PREFIX`, `createR2FileReference`, `r2PathFromFileUrl` (reuses `isValidStoragePath` for traversal rejection). |
| `src/lib/storageManager.js` | Added `resolveFeedMediaUrl`; added the R2 branch to `resolveChatFileUrl`; quota raised to 10GB. |
| `src/components/chat/MessageInput.jsx` | R2-first `uploadAttachment` helper; falls back to `uploadChatFile` only on HTTP 503. |
| `src/lib/feedContent.js` | `isSafeMediaUrl` now accepts durable `r2://` / `storage://` references. |
| `src/pages/FeedsPage.jsx` | Resolves feed/composer media URLs at read time via `resolveFeedMediaUrl`. |
| `server/appwriteGateway.js`, `AGENTS.md` | Quota raised from 5GB to 10GB. |
| `docs/supabase-schema.sql` | Inline `user_storage` + `attachments` block for the production `psql` apply. |
| `scripts/lib/supabase-schema.js` | Added the new tables and functions to the schema verification lists. |
| `scripts/generate-runtime-env.js`, `.env.example` | Registered the `R2_*` server vars and `VITE_R2_PUBLIC_BASE_URL`. |
| `package.json` | Added `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. |
| `tests/chatFileUrl.test.mjs` | Added R2 round-trip and traversal-rejection tests. |

## Required environment variables

Server-only: `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. Browser-safe: `VITE_R2_PUBLIC_BASE_URL` — currently
**empty by design**; every object, feed media included, is served by short-lived
signed URLs (see Bucket configuration below).

## Bucket configuration

Applied to the `nexuschat` bucket. Nothing here is managed by
infrastructure-as-code — there is no Terraform/Pulumi in the repo and
`wrangler.jsonc` declares no R2 binding — so this section is the source of truth.
Both settings are reproducible: CORS with the S3 API (`PutBucketCors`) using the
`R2_*` credentials, public access with
`PUT /accounts/{account_id}/r2/buckets/nexuschat/domains/managed`.

### CORS

Before this change the bucket had **no** CORS policy at all (`GetBucketCors` →
`NoSuchCORSConfiguration`), so browser-side direct uploads failed. The single
rule now in force:

| Field | Value |
| --- | --- |
| `AllowedOrigins` | `https://nexus-chat-world.com`, `https://www.nexus-chat-world.com`, `https://welcome-hub-tau.vercel.app`, `https://localhost`, `capacitor://localhost`, `http://localhost:5173` |
| `AllowedMethods` | `GET`, `PUT`, `HEAD` |
| `AllowedHeaders` | `content-type` |
| `ExposeHeaders` | `ETag`, `Content-Type`, `Content-Length` |
| `MaxAgeSeconds` | `3600` |

`https://localhost` and `capacitor://localhost` are the Capacitor WebView origins
for Android and iOS. The origin list is explicit — no wildcards — and `POST` is
absent because uploads go straight to the bucket with a presigned `PUT`.

`AllowedHeaders` is limited to `content-type` because that is the only header the
app ever sends to the bucket: `putWithProgress` in `src/hooks/useChatUploader.ts`
sets exactly one request header. (The `x-upsert` header in
`src/lib/storageManager.js` goes to a Supabase signed upload URL, not to R2.) Every
other header now fails preflight. `content-type` must be listed because a value
such as `image/png` is not a CORS-safelisted value, so the browser preflights it.

Validation — `OPTIONS` preflight against the bucket:

| `Access-Control-Request-Headers` | Result |
| --- | --- |
| *(none)* | `204` |
| `content-type` | `204`, `Access-Control-Allow-Headers: content-type` |
| `x-upsert` | `403` rejected |
| `authorization` | `403` rejected |
| `content-type, x-custom-header` | `403` rejected |
| *(unapproved origin)* | `403`, no `Access-Control-Allow-Origin` |

An anonymous `GET` on the S3 endpoint is rejected (`400`).

### Content-type is pinned into the upload signature

CORS only constrains browser clients. To enforce the header server-side for any
caller, the presigned URL is generated with
`signableHeaders: new Set(['content-type'])` in `api/storage.js`, which yields
`X-Amz-SignedHeaders=content-type;host`. `Content-Type` is therefore part of the
signed request and a PUT that omits it or sends a different value is rejected by
the bucket with `403` — for browsers and out-of-browser clients alike.

Validation — PUT against a freshly presigned URL signed for `text/plain`:

| PUT `Content-Type` | Result |
| --- | --- |
| `text/plain` (matching) | `200` |
| `application/json` (mismatched) | `403` |
| *(absent)* | `403` |

The client remains compatible because it sends
`file.type || 'application/octet-stream'` — the exact value the server signs
(`src/hooks/useChatUploader.ts` line 55 vs the `ContentType` in the presign
command).

### Public access

**Disabled.** The `r2.dev` managed domain (`pub-e6fa…r2.dev`) was enabled, which
made every object world-readable — including private `chat-attachments/<userId>/…`
keys that `api/storage.js` otherwise protects with signed URLs. R2 cannot scope
public access to a prefix, so it was all-or-nothing and is now off:

```
PUT /accounts/{account_id}/r2/buckets/nexuschat/domains/managed  {"enabled": false}
```

Consequence: `VITE_R2_PUBLIC_BASE_URL` must stay empty — a public base would 404
and would silently publish private attachments. Re-enabling public access means
restoring that variable and rebuilding.

Validation: a presigned `GET` still returns `200`; an anonymous fetch of the same
object via the `r2.dev` host now returns `401`.

R2 has no AWS-style IAM users/policies and no "Block Public Access" toggle.
Authorisation comes from bucket-scoped R2 API tokens — the four `R2_*`
credentials are one such token — plus this single public-access switch.

## File-corruption incident and resolution

During an earlier attempt, fenced code blocks were pasted into open editor
buffers instead of being created at their target paths. That spliced an API
handler into `src/pages/VerifyEmail.jsx`, a SQL migration into
`src/lib/storageManager.js` and `server/appwriteGateway.js`, and produced
misnamed artifacts (`src/lib/-- Per-user 10GB storage quota counter a.sql`,
`src/lib/import { useCallback, useState } from 'r.ts`).

Resolution: the damage was repaired, both misnamed files were deleted, and the
work was redone sequentially — new files created at exact absolute paths, edits
applied as targeted diffs, with verification after each step.

## Verification performed

| Check | Result |
| --- | --- |
| IDE diagnostics | clean |
| `node --test tests/chatFileUrl.test.mjs tests/chatProtocol.test.mjs tests/appwriteGateway.test.mjs tests/resendEmailApi.test.mjs` | 44/44 pass |
| `node --test tests/supabaseSchema.test.mjs` | 11/11 pass |
| `npx vite build` | success (2420 modules) |
| `npx eslint` on changed files | clean |

Note: `src/lib/feedContent.js` line 12 has a pre-existing `no-control-regex`
warning that predates this work and was left untouched.

## Deployment

```bash
npm install
npx supabase db push          # or apply the block in docs/supabase-schema.sql
```

Set the `R2_*` variables on Vercel before enabling the R2 path. Projects without
them keep using the Supabase pipeline unchanged.
