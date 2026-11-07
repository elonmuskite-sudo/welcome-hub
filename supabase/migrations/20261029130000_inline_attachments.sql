-- Hybrid attachment storage: small files are stored inline as Base64 in the
-- attachments row, larger files stay in the R2/S3 bucket. Both paths share the
-- same 10GB per-user quota via reserve_user_storage / commit_user_storage.
-- Mirrors the user_storage + attachments block in docs/supabase-schema.sql so the
-- CLI (db push) and the production psql apply stay in step.

alter table public.attachments
  add column if not exists file_name text not null default '',
  add column if not exists storage_type text not null default 'external_bucket',
  add column if not exists file_data text;

-- Inline rows carry file_data instead of a bucket key, so file_key becomes
-- optional. The existing UNIQUE constraint is retained: Postgres permits many
-- NULLs, so inline rows never collide with each other or with bucket keys.
alter table public.attachments alter column file_key drop not null;

do $$ begin
  alter table public.attachments
    add constraint attachments_storage_type_check
    check (storage_type in ('inline_base64', 'external_bucket'));
exception when duplicate_object then null; end $$;

-- Exactly one payload must be present, matching the declared storage_type, so a
-- row can never hold both a bucket key and inline bytes (or neither).
do $$ begin
  alter table public.attachments
    add constraint attachments_payload_check
    check (
      (storage_type = 'inline_base64' and file_data is not null and file_key is null)
      or (storage_type = 'external_bucket' and file_key is not null and file_data is null)
    );
exception when duplicate_object then null; end $$;
