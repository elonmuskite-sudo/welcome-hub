-- End-to-end encryption key directory.
--
-- The client encrypts 1:1 messages with ECDH P-256 key agreement + AES-256-GCM.
-- That needs each participant's public key, but the keys were previously only
-- held in memory (registerPeerPublicKey), so encryption could never complete.
-- This adds a server directory for public keys and a participant-scoped read so
-- a caller can only ever fetch keys of chats they belong to.
--
-- Only public keys are stored; private keys never leave the device.
-- Idempotent: safe to run more than once.

create table if not exists public.e2ee_public_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  algorithm text not null default 'ECDH-P256',
  updated_at timestamptz not null default now()
);
alter table public.e2ee_public_keys enable row level security;
-- No direct client access: reads go through list_chat_public_keys (participant
-- scoped) and writes through publish_e2ee_public_key (caller scoped).
revoke all on public.e2ee_public_keys from public, anon, authenticated;
grant all on public.e2ee_public_keys to service_role;

-- Publish (or rotate) the caller's own public key.
create or replace function public.publish_e2ee_public_key(p_public_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_public_key is null or length(p_public_key) < 40 or length(p_public_key) > 800 then
    raise exception 'Invalid public key';
  end if;
  insert into public.e2ee_public_keys (user_id, public_key, updated_at)
  values (auth.uid(), p_public_key, now())
  on conflict (user_id) do update
    set public_key = excluded.public_key, updated_at = now();
end $$;
revoke execute on function public.publish_e2ee_public_key(text) from public, anon;
grant execute on function public.publish_e2ee_public_key(text) to authenticated, service_role;

-- Fetch the public keys of the other participants in a chat the caller belongs
-- to. Caller-scoped: a non-member gets no rows.
create or replace function public.list_chat_public_keys(p_chat_id uuid)
returns table (profile_id uuid, public_key text)
language sql stable security definer set search_path = public as $$
  select m.profile_id, k.public_key
  from public.chat_members m
  join public.e2ee_public_keys k on k.user_id = m.profile_id
  where m.chat_id = p_chat_id
    and m.profile_id <> auth.uid()
    and exists (
      select 1 from public.chat_members me
      where me.chat_id = p_chat_id and me.profile_id = auth.uid()
    )
$$;
revoke execute on function public.list_chat_public_keys(uuid) from public, anon;
grant execute on function public.list_chat_public_keys(uuid) to authenticated, service_role;
