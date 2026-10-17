# Supabase Auth and Resend setup

The application uses Supabase Auth for credentials and recovery, Supabase `members` rows for Nexus profiles, and Appwrite for the existing chat data. A Vercel serverless function or the `email-code` Edge Function creates an unconfirmed Supabase user, generates a native Auth OTP, and sends signup, resend, and recovery codes directly through the Resend API. The browser verifies that six-digit code with `verifyOtp`; email verification links are not part of the flow. `RESEND_API_KEY` is server-only and must never be exposed through a `VITE_` variable or browser bundle.

## 1. Apply the database migration

Schema changes are versioned SQL files under `supabase/migrations/`. Builds and browser-facing code never apply SQL. An operator explicitly runs `npm run db:setup:dry` to review migration files, then `npm run db:setup` to apply pending migrations. The CLI applies each migration in a transaction, takes an advisory lock, records its version and SHA-256 checksum in `public.nexus_schema_migrations`, and verifies the required tables, functions, and Auth triggers. Editing an already-applied migration is rejected; create a new timestamped migration instead. The baseline migration provisions member/profile rows for Supabase Auth users, applies RLS, removes public access to the legacy password column, and installs the persistent email-code rate-limit RPC required by the Vercel email endpoint.

Set `SUPABASE_DB_URL` locally in ignored `.env.local` to a PostgreSQL connection string from Supabase (prefer the Session pooler connection string when the operator machine cannot connect directly). It is a highly privileged secret. The Supabase anon and service-role API keys cannot execute arbitrary DDL; the CLI checks them against Supabase Auth endpoints, but only the explicit migration command uses the database URL to apply checked-in migration files. Do not upload `SUPABASE_DB_URL` to Vercel, expose it to browser code, or run migrations from a browser bot or build hook.

The migration retains the old nullable `members.password` column temporarily to avoid silently destroying legacy data. New accounts do not write to it. Existing browser/Appwrite accounts without verified email addresses cannot be automatically linked safely; have those users register with an email and follow a supervised recovery/relink process. After legacy account disposition, remove the old column with:

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

In Resend, use the verified domain `nexus-chat-world.com` and create an API key with send-only permissions. The server function sends through `https://api.resend.com/emails` using these Vercel Production variables:

- `RESEND_API_KEY` (encrypted server variable)
- `RESEND_FROM=Nexus Chat <admin@nexus-chat-world.com>`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (encrypted server variable)

The Supabase service-role key is used only by the Vercel function to generate OTPs; never prefix it with `VITE_`.

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
