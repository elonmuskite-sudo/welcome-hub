# Supabase migrations

- Add each schema change as a new `YYYYMMDDHHMMSS_description.sql` file in this directory.
- Never rewrite a migration after it has been applied; the runner stores and checks each SHA-256 checksum in `public.nexus_schema_migrations`.
- Retire a migration only when every object it creates is re-created by a later file. The superseded `20261006000000_initial_nexus_schema.sql` (profiles-based design) and `20261006010000_authenticated_member_lookup.sql` were retired on 2026-10-17; do not re-add them.
- Review pending files with `npm run db:setup:dry`, then have an operator apply them using `npm run db:setup` from a trusted terminal with `SUPABASE_DB_URL` in the ignored local `.env.local`.
- Build validation and browser code must not execute SQL. Do not upload `SUPABASE_DB_URL` to Vercel or expose it through a `VITE_` variable.
- The CLI uses a transaction and PostgreSQL advisory lock. Review destructive statements before applying; use a new forward migration for corrections.
