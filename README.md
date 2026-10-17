# Nexus Chat

A privacy-first real-time chat app.

## Stack

- React + Vite front end with Tailwind CSS
- Supabase for database, auth, realtime chat transport, and file storage
- Resend for transactional and OTP email delivery
- Vercel serverless functions under `api/` plus Cloudflare/Wrangler for deploys

## Authentication setup

Supabase Auth handles account credentials and password recovery. Follow [the Supabase Auth and Resend setup guide](docs/supabase-auth-setup.md) before deploying the auth migration.

## Vercel environment variables

Keep `VITE_AUTH_PROVIDER=supabase` unless the Appwrite identity-link migration
and all required Appwrite server/client environment values are ready. The
GitHub Actions Appwrite cutover also requires a `VERCEL_DEPLOY_HOOK_URL` secret
to trigger a production build after changing Vercel environment values.

The Vercel sync command uploads application environment values to the Production target, encrypts private API credentials, and removes obsolete public-secret variables. It requires a Vercel access token and project ID; the token is read from `VERCEL_TOKEN` and is never written to project files or printed. Builds and browser-facing code do not execute schema changes. Database changes live in versioned files under `supabase/migrations/` and run only through the explicit, operator-invoked `npm run db:setup` command using a local `SUPABASE_DB_URL`. That highly privileged PostgreSQL URL is never uploaded to Vercel or included in generated runtime config.

1. In Vercel, open your account or team settings, select **Tokens**, and create a new token scoped to the team that owns this project. Set an expiration appropriate for your deployment workflow.
2. Find the project ID in the project's **Settings > General** page. For a team project, also find the team ID.
3. Put the deployment values in `.env.local` using the server-only names from `.env.example`. Never use `VITE_` for the Appwrite API key or admin password.
4. In PowerShell, set the project identifiers and enter a fresh token using a secure prompt. This keeps the token out of command history and does not echo it:

```powershell
$env:VERCEL_PROJECT_ID = "prj_your_project_id"
$env:VERCEL_TEAM_ID = "team_your_team_id" # omit for a personal project
$secureToken = Read-Host "Vercel token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $env:VERCEL_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
try {
    npm run vercel:env:dry
    if ($LASTEXITCODE -ne 0) { throw "Vercel environment dry run failed; do not sync yet." }
    $confirmation = Read-Host 'Review the dry-run output. Type SYNC to update Vercel Production variables'
    if ($confirmation -ceq 'SYNC') {
        npm run vercel:env:sync
        if ($LASTEXITCODE -ne 0) { throw "Vercel environment sync failed." }
    } else {
        Write-Output 'Sync cancelled; no Vercel changes were made.'
    }
} finally {
    Remove-Item Env:VERCEL_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:VERCEL_PROJECT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:VERCEL_TEAM_ID -ErrorAction SilentlyContinue
}
```

The dry run reports missing variable names only. The sync command updates existing Production-only variables, creates missing ones, then removes the legacy public secret variables. It fails rather than changing variables currently shared with Preview or Development, so adjust those target scopes in Vercel first if prompted.

## Development

You need Node.js and npm.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
