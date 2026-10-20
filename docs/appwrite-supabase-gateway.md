# Appwrite identity with Supabase data

Appwrite JWTs are not Supabase access tokens. A Vercel API must verify the JWT
against Appwrite before it can act for a user in Supabase.

## Migrated paths

When `VITE_AUTH_PROVIDER=appwrite`, the client uses Appwrite for email/password
sign-in and OTP password recovery. Email verification is not link-based: signup
codes are delivered as six-digit OTPs through Resend, never as verification links.
After Appwrite confirms the session, the gateway creates a Supabase Auth identity
with a random inaccessible password for new accounts, relying on the existing
auth trigger to create the corresponding member profile. Existing Supabase
accounts are linked only when their email is confirmed and matches.

`POST /api/data/gateway` verifies each Appwrite JWT with
`GET {APPWRITE_ENDPOINT}/account`, resolves the immutable Appwrite user ID to a
Supabase Auth UUID, and executes supported user data actions inside a database
transaction using `SET LOCAL ROLE authenticated` and transaction-local JWT
claims. Existing RLS remains the row authorization boundary. The gateway
currently supports profile and directory lookup, chat/message reads and writes,
chat/contact synchronization, message polling, and chat-file storage metadata.
Chat files upload directly to Supabase Storage only through a short-lived
single-object signed upload token; the server first authorizes the path through
RLS and never exposes a service-role key to the browser.

The service-role key is used for identity mapping/Auth account linking and
scoped Storage signing/removal after a user-scoped RLS lookup. It is not used
for arbitrary user-data queries. The database pooler connection must
authenticate as the Supabase `postgres` role so the gateway can switch to
`authenticated` within each transaction.

Admin authorization and data now have gateway actions for the dashboard,
member management, verification review, and configuration diagnostics. The
verification-status, badge, and submission screens use those actions when
Appwrite is selected. Queues poll the gateway instead of opening Supabase
Realtime channels. Identity-document uploads use scoped, single-object Storage
upload tokens; the gateway validates the stored object's actual type and size
before saving its path. Browsers still need the Supabase project URL and public
key to redeem these upload tokens; no service-role key is sent to the browser.

## Not yet migrated

This remains a staged cutover. The BioWriter Edge Function is deliberately
disabled while Appwrite is selected; it still uses Supabase Auth and needs a
verified Appwrite-backed server path before it can be re-enabled. Other
ancillary Supabase-backed flows also need migration and verification. Supabase
Auth/Data/Storage/Realtime remain the default provider and fallback. Do not set
`VITE_AUTH_PROVIDER=appwrite` in production until all enabled screens and
operations have been migrated, the migration applied, and the complete
Appwrite path tested in the deployed environment. No production database or
Vercel configuration has been applied from this workspace.

The production workflow's explicit Appwrite switch applies the identity-link
migration or fresh-project schema, validates the required server settings and
an explicit staging-readiness confirmation, sets the provider for Vercel
Production, and triggers the configured Production deploy hook. The workflow
only confirms the deployment was queued;
verify the deployment reaches Ready and test sign-in/data access before
considering production cut over. Leave the switch off to keep Vercel on
Supabase Auth.

## Server configuration

Configure these as Vercel server environment variables, never as `VITE_`
variables:

- `APPWRITE_ENDPOINT` — Appwrite API endpoint, such as `https://cloud.appwrite.io/v1`.
- `APPWRITE_PROJECT_ID` — Appwrite project ID.
- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only key for identity linking and Auth user lookup.
- `SUPABASE_POOLER_URL` — Supabase transaction-pooler connection URL using the
  `postgres.<project-ref>` database user, port `6543`, and `sslmode=require`.

For a client build, also set the browser-visible Vite variables:
`VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID`, and
`VITE_AUTH_PROVIDER`. Appwrite endpoint/project IDs are public identifiers, not
secrets. A Vercel build also needs these values in its build environment. Keep
the provider set to `supabase` until the complete migration is ready.

For the GitHub production workflow, add a Vercel Production deploy hook URL as
the `VERCEL_DEPLOY_HOOK_URL` Actions secret. It is required only when enabling
Appwrite and is treated like a credential; do not commit or share it.

In the Appwrite Console, allow the production web origin (`nexus-chat-world.com`)
as a Web platform and enable the password policy option that rejects breached
passwords and blocks sign-in with them. This Appwrite policy is the project-wide
password restriction; the app itself applies no password policy (no length
minimum and no breach check) so that the console settings are the single place
that governs it.

The `appwrite_identity_links` migration and the SQL grants/policies must be
applied before using the gateway. The migration has not been applied to the
production Supabase project. Never send the pooler URL or service-role key to
the browser.
