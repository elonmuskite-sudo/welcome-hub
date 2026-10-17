-- Bring a project provisioned from docs/supabase-schema.sql up to date with the
-- objects the app needs. Idempotent: safe to run more than once.

-- Appwrite identity links (server-only; may only be changed by the trusted API).
create table if not exists public.appwrite_identity_links (
  appwrite_user_id text primary key,
  supabase_user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_email text not null,
  linked_at timestamptz not null default now()
);
alter table public.appwrite_identity_links enable row level security;
revoke all on public.appwrite_identity_links from public, anon, authenticated;
grant all on public.appwrite_identity_links to service_role;

-- Contacts
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  nexus_id text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  unique (user_id, nexus_id)
);
grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;
alter table public.contacts enable row level security;
drop policy if exists "Own contacts" on public.contacts;
create policy "Own contacts" on public.contacts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Chat transport (replaces Appwrite)
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New Chat',
  type text not null default 'private',
  avatar_url text,
  encrypted boolean not null default false,
  owner_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  profile_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (chat_id, profile_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid,
  content text not null check (char_length(content) between 1 and 65535),
  type text not null default 'text',
  file_url text,
  file_name text,
  duration numeric,
  encrypted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_members_profile on public.chat_members(profile_id);
create index if not exists idx_messages_chat_created on public.messages(chat_id, created_at);
grant select, insert, update, delete on public.chats, public.chat_members, public.messages to authenticated;
grant all on public.chats, public.chat_members, public.messages to service_role;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_chat_member(_chat uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = _chat and profile_id = _user) $$;

drop policy if exists "View own chats" on public.chats;
create policy "View own chats" on public.chats for select to authenticated
  using (owner_id = auth.uid() or public.is_chat_member(id, auth.uid()));
drop policy if exists "Create owned chats" on public.chats;
create policy "Create owned chats" on public.chats for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "Owners update chats" on public.chats;
create policy "Owners update chats" on public.chats for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Owners delete chats" on public.chats;
create policy "Owners delete chats" on public.chats for delete to authenticated
  using (owner_id = auth.uid());
drop policy if exists "View memberships of my chats" on public.chat_members;
create policy "View memberships of my chats" on public.chat_members for select to authenticated
  using (public.is_chat_member(chat_id, auth.uid()));
drop policy if exists "Owners add members" on public.chat_members;
create policy "Owners add members" on public.chat_members for insert to authenticated
  with check (exists (select 1 from public.chats c where c.id = chat_id and c.owner_id = auth.uid()));
drop policy if exists "Leave chats" on public.chat_members;
create policy "Leave chats" on public.chat_members for delete to authenticated
  using (profile_id = auth.uid());
drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages" on public.messages for select to authenticated
  using (public.is_chat_member(chat_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
drop policy if exists "Members send messages" on public.messages;
create policy "Members send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id, auth.uid()));
drop policy if exists "Senders delete messages" on public.messages;
create policy "Senders delete messages" on public.messages for delete to authenticated
  using (sender_id = auth.uid());
revoke execute on function public.is_chat_member(uuid, uuid) from public, anon;
grant execute on function public.is_chat_member(uuid, uuid) to authenticated, service_role;

-- Admin review of ID checks: only admins, only pending rows, records reviewer and time.
create or replace function public.review_identity_verification(_id uuid, _approve boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admins only'; end if;
  update public.identity_verifications
    set status = case when _approve then 'approved' else 'rejected' end,
        reviewer_note = case when _approve then null else nullif(left(trim(coalesce(_note,'')), 500), '') end,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = _id and status = 'pending';
  if not found then raise exception 'This ID check is no longer waiting for review'; end if;
end $$;
revoke execute on function public.review_identity_verification(uuid,boolean,text) from public, anon;
grant execute on function public.review_identity_verification(uuid,boolean,text) to authenticated;

-- Realtime for live chat/contacts UI (ignore if already published)
do $$ begin alter publication supabase_realtime add table public.contacts; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.messages; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_members; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.storage_purchases; exception when others then null; end $$;
