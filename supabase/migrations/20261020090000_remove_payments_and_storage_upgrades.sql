-- Remove storage upgrades and all payment processing.
--
-- Storage tiers and USDT/NOWPayments purchases are retired. Every account now
-- has one fixed 5 GB quota held in application code, so the per-user quota table
-- and everything that fed it are dropped. This is a pure removal migration:
-- no application table other than the payment tables is touched, and no user
-- content (messages, files, profiles, contacts) is affected.
--
-- Idempotent: every statement uses IF EXISTS / DROP ... CASCADE so the migration
-- is safe to run against a database where some of these objects were never
-- created. Apply in sequence after 20261017080000_e2ee_default_enabled.sql.

-- 1. Storage policies for the retired payment QR bucket.
drop policy if exists "Signed-in read QR" on storage.objects;
drop policy if exists "Admins upload QR" on storage.objects;
drop policy if exists "Admins change QR" on storage.objects;
drop policy if exists "Admins upload payment QR" on storage.objects;
drop policy if exists "Admins update payment QR" on storage.objects;
drop policy if exists "Signed-in read payment QR" on storage.objects;

-- 2. Payment RPCs (both the exposed wrappers and the private bodies).
drop function if exists public.submit_usdt_payment(text, text);
drop function if exists public.review_usdt_payment(uuid, boolean);
drop function if exists private.submit_usdt_payment(text, text);
drop function if exists private.review_usdt_payment(uuid, boolean);

-- 3. Stop streaming purchases over Realtime.
do $$ begin
  alter publication supabase_realtime drop table public.storage_purchases;
exception when others then null; end $$;

-- 4. Payment tables and the quota table they wrote to.
drop table if exists public.payment_webhook_events;
drop table if exists public.payment_settings;
drop table if exists public.storage_purchases;
drop table if exists public.user_storage_quotas;

-- 5. Invoice counter that only existed to number storage purchases.
drop sequence if exists public.invoice_number_seq;

-- 6. The payment QR bucket. Supabase installs a protect_delete trigger on the
--    storage tables, so buckets cannot be dropped with plain SQL (that raises
--    "Direct deletion from storage tables is not allowed"). Remove the bucket
--    through the Storage API instead:
--      curl -X DELETE "$SUPABASE_URL/storage/v1/bucket/payment-qr" \
--           -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
--    The bucket holds no user content and is unreferenced by the app, so this is
--    housekeeping rather than a functional requirement of the migration.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    perform 1 from storage.buckets where id = 'payment-qr';
    if found then
      raise notice 'Storage bucket payment-qr still exists; remove it via the Storage API (see comment above).';
    end if;
  end if;
end $$;
