# Supabase Auth and Resend setup

The application uses Supabase Auth for credentials and recovery, Supabase `members` rows for Nexus profiles, and Appwrite for the existing chat data. A Vercel serverless function or the `email-code` Edge Function creates an unconfirmed Supabase user, generates a native Auth OTP, and sends signup, resend, and recovery codes directly through the Resend API. The browser verifies that six-digit code with `verifyOtp`; email verification links are not part of the flow. `RESEND_API_KEY` is server-only and must never be exposed through a `VITE_` variable or browser bundle.

## 1. Apply the database migration

Schema changes are versioned SQL files under `supabase/migrations/`. Builds and browser-facing code never apply SQL. An operator explicitly runs `npm run db:setup:dry` to review migration files, then `npm run db:setup` to apply pending migrations. The CLI applies each migration in a transaction, takes an advisory lock, records its version and SHA-256 checksum in `public.nexus_schema_migrations`, and verifies the required tables, functions, and Auth triggers. Editing an already-applied migration is rejected; create a new timestamped migration instead. The earliest remaining migration, `20261012110244_880a9c2a-16c5-4d14-8803-b9bf93c0faab.sql`, creates `public.members` for Supabase Auth users, applies RLS and the protected-field trigger, installs the `on_auth_user_created`/`on_auth_user_updated` Auth triggers and the `lookup_member_by_nexus_id` function, and backfills existing accounts; `20261012122632_31486d60-08f7-48ec-a6e7-0d32384bd185.sql` then installs the persistent email-code rate-limit RPC and its `public.auth_email_code_limits` table required by the Vercel email endpoint.

The superseded `20261006000000_initial_nexus_schema.sql` and `20261006010000_authenticated_member_lookup.sql` migrations were retired from this directory. They belonged to the abandoned `profiles`-based design (`public.profiles`, `verify_member_login`, `current_member_profile_id`, `current_member_is_admin`, `create_member_for_auth_user`, `sync_member_email_from_auth_user`, `auth_email_code_rate_limits`, and the `on_auth_user_created_nexus_member`/`on_auth_user_updated_nexus_email` triggers), and every object they created is re-created by the later migrations above. Do not re-add them. A project whose `public.nexus_schema_migrations` history still lists those versions will report them as "exists in source: false" in `npm run db:verify`; that is expected and does not apply to the live project, which tracks history in `supabase_migrations.schema_migrations`.

Set `SUPABASE_DB_URL` locally in ignored `.env.local` to a PostgreSQL connection string from Supabase (prefer the Session pooler connection string when the operator machine cannot connect directly). It is a highly privileged secret. The Supabase anon and service-role API keys cannot execute arbitrary DDL; the CLI checks them against Supabase Auth endpoints, but only the explicit migration command uses the database URL to apply checked-in migration files. Do not upload `SUPABASE_DB_URL` to Vercel, expose it to browser code, or run migrations from a browser bot or build hook.

Projects provisioned before the superseded migrations were retired may still carry the legacy nullable `members.password` column; no current migration creates it. New accounts never write to it. Existing browser/Appwrite accounts without verified email addresses cannot be automatically linked safely; have those users register with an email and follow a supervised recovery/relink process. After legacy account disposition, remove the old column with:

```sql
alter table public.members drop column if exists password;
```

Create admin identities through Supabase Auth, then promote only the intended account in the SQL Editor:

```sql
update public.members
set role = 'admin'
where auth_user_id = (
  select id from auth.users where lower(email) = lower('admin@your-domain.com')
);
```

## 2. Configure auth URLs

In Supabase Dashboard, open **Authentication → URL Configuration**:

- Site URL: `https://nexus-chat-world.com`
- Redirect URLs are not used to complete email verification. Users enter the Resend OTP on `/verify-email` and `/verify-email?purpose=recovery`.
- For local development, open `http://localhost:5173/verify-email` after registration or recovery.

Keep **Confirm email** enabled in **Authentication → Providers → Email**. App verification codes expire after 10 minutes, allow at most five guesses, and are rate-limited by the database RPC installed by the schema migration. Do not send Supabase's built-in confirmation or recovery links; Resend delivers the OTP instead.

## 3. Configure Resend API

`nexus-chat-world.com` is registered in Resend and reported as **verified** with sending **enabled** (confirmed against `GET https://api.resend.com/domains` on 2026-10-17; domain id `4346b5a9-7004-470b-95ca-047171b0673c`, region `us-east-1`). Create or reuse an API key with send-only permissions. The server function sends through `https://api.resend.com/emails` using these Vercel Production variables:

- `RESEND_API_KEY` (encrypted server variable)
- `RESEND_FROM=Nexus Chat <admin@nexus-chat-world.com>`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (encrypted server variable)

The Supabase service-role key is used only by the Vercel function to generate OTPs; never prefix it with `VITE_`.

### Resend domain DNS records

Outgoing mail is sent `From: Nexus Chat <admin@nexus-chat-world.com>`. Resend signs it with DKIM on the apex domain and uses the `send` subdomain as the envelope (bounce) domain, so relaxed SPF and DKIM alignment both pass once DMARC is published. `nexus-chat-world.com` is delegated to Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), so records are added in **Vercel → Project → Settings → Domains → nexus-chat-world.com → DNS Records** (or at whichever provider holds the nameservers), using the exact values from **Resend → Domains → nexus-chat-world.com**.

Resend manages three records and reports all three as **verified**; DMARC is not part of Resend's record set and must be maintained separately:

| Host | Type | Value | Purpose | State (checked 2026-10-17) |
| --- | --- | --- | --- | --- |
| `send` | MX, priority 10 | `feedback-smtp.eu-west-1.amazonses.com` | Return-path/bounce handling | Published — Resend reports verified |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | SPF for the Resend envelope domain | Published — Resend reports verified |
| `resend._domainkey` | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCpCVO2OQMfD9agOu1Ir+6Kt4vEf5RU30z8qwLGCuD9VExXFfHIVh75N47/eOqB5hqorBoT2cquvEzfy3wfV4qmMsINJrvNmG20ccy/22USQEjlwI58xOoiNd0lXbMUVqh9lHjfpJuwh/dGI6g6QoOyjBwY08zzfWX0DuCAjVgaMQIDAQAB` | DKIM signing for `d=nexus-chat-world.com` | Published — Resend reports verified |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@nexus-chat-world.com` | DMARC policy and aggregate reports | **Missing — add this** |

Observations from the 2026-10-17 probe: the live `send` MX points at the `eu-west-1` SES feedback endpoint while the Resend domain record advertises the `us-east-1` endpoint (`feedback-smtp.us-east-1.amazonses.com`). Only `resend._domainkey.nexus-chat-world.com` and `_dmarc.nexus-chat-world.com` live on the apex; the apex itself intentionally has no SPF TXT, because only the `send` subdomain carries the envelope sender. DMARC sits outside Resend's verification, so adding it does not change the domain's verified status — it is still required to complete SPF/DKIM/DMARC alignment. Tighten `p=none` to `p=quarantine` and then `p=reject` once the aggregate reports show only your own senders.

## 4. Vercel environment

Set these in **Vercel → Project → Settings → Environment Variables** for Production, Preview, and Development as appropriate:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not add `SUPABASE_SERVICE_ROLE_KEY`, the Postgres connection string, or `RESEND_API_KEY` to frontend `VITE_` variables. The database connection string stays local to the operator's migration environment and is not required by the Vercel app. Redeploy after environment changes.

To configure Production and Preview from GitHub, add `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` (when using a team), `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `RESEND_FROM` as repository Actions secrets. Then run **Actions → Set up production** and provide the Supabase project URL and anon/publishable key. The workflow creates or updates the corresponding browser and server variables in Vercel, so it can be rerun after an interrupted setup; it requires the server-side email secrets rather than silently skipping them.

The workflow's **Run database schema** option is only for an empty, fresh Supabase project. Leave it unchecked for any existing project; the baseline schema is not a repeatable migration and will fail on objects such as the existing `app_role` type. Use the versioned migration process above for schema updates.

## 5. Configure NOWPayments Edge Function secrets

NOWPayments credentials are read by Supabase Edge Functions, not by the Vercel app. Add these GitHub Actions repository secrets before running **Actions → Set up production**:

- `SUPABASE_ACCESS_TOKEN` (a scoped Supabase access token authorized to manage Edge Function secrets)
- `SUPABASE_PROJECT_REF` (the project reference shown in the Supabase project URL)
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`

The workflow sends the two NOWPayments values to Supabase using the CLI; they are not added to Vercel. If an API key was pasted into chat or another public/shared location, revoke it and generate a replacement before saving it as a GitHub secret. Regenerating the IPN secret immediately invalidates the previous one, so update its GitHub secret and rerun the workflow promptly to avoid failed payment notifications. Supabase Edge Function secrets take effect without redeploying the functions.

## 6. Verify the flow

1. Register with an email address and an 8-character-minimum password; confirm the six-digit code is delivered by Resend.
2. Verify the code, then sign in; the profile row should be created by the database trigger.
3. Request password recovery; verify the recovery code is delivered by Resend.
4. Verify the code, set a new password, and sign in with it.
5. In Supabase SQL Editor, verify `members.password` is not selected by anon/authenticated roles and that a user can only select their own member row.
