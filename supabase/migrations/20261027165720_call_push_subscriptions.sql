create table if not exists public.call_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web', 'android', 'ios')),
  endpoint text not null,
  p256dh text,
  auth text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_push_subscription_web_keys check (
    (platform = 'web' and p256dh is not null and auth is not null)
    or (platform in ('android', 'ios') and p256dh is null and auth is null)
  ),
  constraint call_push_subscription_endpoint_unique unique (platform, endpoint)
);

create index if not exists call_push_subscriptions_user_id_idx
  on public.call_push_subscriptions (user_id);

alter table public.call_push_subscriptions enable row level security;

revoke all on public.call_push_subscriptions from public, anon;
grant select, insert, update, delete on public.call_push_subscriptions to authenticated;
grant select, delete on public.call_push_subscriptions to service_role;

drop policy if exists "Users manage their own call push subscriptions" on public.call_push_subscriptions;
create policy "Users manage their own call push subscriptions"
  on public.call_push_subscriptions
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);