-- Gate instant identity approval on a server-verified Idswyft KYC session.
--
-- The retired instant tier let the browser call submit_instant_identity_verification
-- with a self-computed face score, which a client could forge. Instant approval is now
-- granted only by the server (the Idswyft webhook and the /api/kyc status poll, both
-- running as service_role) once the provider reports APPROVED for the member's session.
alter table public.identity_verifications alter column selfie_path drop not null;

drop function if exists public.submit_instant_identity_verification(text, numeric);

create or replace function public.approve_identity_from_kyc(_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _user_id uuid;
begin
  if _session_id is null then raise exception 'A verification session is required'; end if;
  select user_id into _user_id
    from public.kyc_sessions
   where id = _session_id and status = 'APPROVED';
  if _user_id is null then raise exception 'No approved verification session was found'; end if;

  insert into public.identity_verifications
    (user_id, status, tier, match_score, selfie_path, id_document_path, reviewer_note, reviewed_by, reviewed_at)
  values (_user_id, 'approved', 'instant', null, null, null, null, null, now())
  on conflict (user_id) do update
    set status = 'approved',
        tier = 'instant',
        selfie_path = null,
        id_document_path = null,
        reviewer_note = null,
        reviewed_by = null,
        reviewed_at = now();
end $$;
revoke execute on function public.approve_identity_from_kyc(uuid) from public, anon, authenticated;
grant execute on function public.approve_identity_from_kyc(uuid) to service_role;
