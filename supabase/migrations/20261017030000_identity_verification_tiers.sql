-- Dual-tier identity verification.
--
-- Tier 1 (instant, primary): the app matches the selfie on-device and calls the
--   security-definer RPC below, which records an already-approved row for the
--   caller only. The blue verified badge is shown as soon as this succeeds.
-- Tier 2 (manual, secondary): the member completes a structured form and uploads
--   a government ID plus a selfie; the row stays 'pending' until an admin
--   approves it through review_identity_verification.
--
-- Both tiers resolve to the same blue verified badge. Email confirmation never
-- grants any badge, and only this RPC (not the browser) can self-approve.

alter table public.identity_verifications
  add column if not exists tier text,
  add column if not exists full_legal_name text,
  add column if not exists date_of_birth date,
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists issuing_country text;

-- Rows created before this migration are treated as manual submissions.
update public.identity_verifications set tier = 'manual' where tier is null;

-- The instant tier has no government document, so the ID path becomes optional.
alter table public.identity_verifications alter column id_document_path drop not null;

do $$ begin
  alter table public.identity_verifications
    add constraint identity_verifications_tier_check check (tier in ('instant', 'manual'));
exception when duplicate_object then null; end $$;

-- Instant automated verification. security definer so the member cannot mark
-- arbitrary rows approved: the function only ever writes the caller's own row.
create or replace function public.submit_instant_identity_verification(_selfie_path text, _match_score numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to verify your identity'; end if;
  if coalesce(trim(_selfie_path), '') = '' then raise exception 'A selfie is required for instant verification'; end if;

  insert into public.identity_verifications (user_id, status, tier, match_score, selfie_path, id_document_path, reviewed_at)
  values (auth.uid(), 'approved', 'instant', _match_score, _selfie_path, null, now())
  on conflict (user_id) do update
    set status = 'approved',
        tier = 'instant',
        match_score = excluded.match_score,
        selfie_path = excluded.selfie_path,
        id_document_path = null,
        reviewer_note = null,
        reviewed_by = null,
        reviewed_at = now(),
        updated_at = now();
end $$;
revoke execute on function public.submit_instant_identity_verification(text, numeric) from public, anon;
grant execute on function public.submit_instant_identity_verification(text, numeric) to authenticated, service_role;
