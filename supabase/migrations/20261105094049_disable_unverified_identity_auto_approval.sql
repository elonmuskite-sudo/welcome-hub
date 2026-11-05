-- Client-side face detection cannot authenticate identity documents or prove liveness.
-- Revoke old selfie-only approvals and remove the RPC that allowed self-approval.
update public.identity_verifications
set status = 'rejected',
    tier = 'manual',
    match_score = null,
    reviewer_note = 'Selfie-only automated checks are no longer accepted. Submit a government-issued document and selfie for manual review.',
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
where tier = 'instant';

update public.identity_verifications
set tier = 'manual',
    match_score = null
where tier is distinct from 'manual';

alter table public.identity_verifications
  drop constraint if exists identity_verifications_tier_check;

alter table public.identity_verifications
  add constraint identity_verifications_tier_check
  check (tier = 'manual');

drop function if exists public.submit_instant_identity_verification(text, numeric);