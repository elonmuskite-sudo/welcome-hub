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
`R2_SECRET_ACCESS_KEY`. Browser-safe: `VITE_R2_PUBLIC_BASE_URL` (feed media only;
leave blank to use short-lived signed links). The bucket CORS must allow `PUT`
and `GET` from the app origin.

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
