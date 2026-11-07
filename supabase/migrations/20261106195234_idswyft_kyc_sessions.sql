create table public.kyc_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token text not null,
  status text not null check (status in (
    'AWAITING_FRONT',
    'AWAITING_BACK',
    'AWAITING_LIVE',
    'PROCESSING',
    'APPROVED',
    'HARD_REJECTED',
    'SOFT_REJECTED',
    'LIVENESS_FAILED',
    'REVIEW_REQUIRED',
    'FAILED',
    'EXPIRED'
  )),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kyc_sessions_user_created_idx
  on public.kyc_sessions (user_id, created_at desc);

alter table public.kyc_sessions enable row level security;
revoke all on public.kyc_sessions from public, anon, authenticated;
grant select, insert, update on public.kyc_sessions to authenticated;
grant all on public.kyc_sessions to service_role;

create policy "Users manage own KYC sessions"
  on public.kyc_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_kyc_sessions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_kyc_sessions_updated
  before update on public.kyc_sessions
  for each row execute function public.set_kyc_sessions_updated_at();