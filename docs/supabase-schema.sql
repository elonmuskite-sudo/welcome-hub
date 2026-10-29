-- Nexus Chat schema for your own Supabase project.
-- Paste into Supabase -> SQL Editor on a fresh project and run once.

insert into storage.buckets (id, name, public) values ('chat-files','chat-files', false), ('identity-docs','identity-docs', false) on conflict do nothing;

-- from 20261012105742_7f3801e7-d165-4bbd-a733-0f29089dd2ad.sql
create type public.app_role as enum ('admin','user');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade not null, role public.app_role not null, created_at timestamptz not null default now(), unique(user_id, role));
grant select on public.user_roles to authenticated; grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create policy "Users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.update_updated_at_column() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;

create table public.identity_verifications (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, status text not null default 'pending', match_score numeric, selfie_path text not null, id_document_path text not null, reviewer_note text, reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant select, insert, update on public.identity_verifications to authenticated; grant all on public.identity_verifications to service_role;
alter table public.identity_verifications enable row level security;
create policy "Own or admin read" on public.identity_verifications for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "Submit own pending" on public.identity_verifications for insert to authenticated with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
create policy "Resubmit own after rejection" on public.identity_verifications for update to authenticated using (user_id = auth.uid() and status = 'rejected') with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
create policy "Admins review" on public.identity_verifications for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger trg_idv_updated before update on public.identity_verifications for each row execute function public.update_updated_at_column();

create table public.storage_files (id uuid primary key default gen_random_uuid(), user_id uuid not null, chat_id text, file_name text not null, file_type text not null, mime_type text, size_bytes bigint not null default 0, duration_seconds numeric, storage_path text not null, created_at timestamptz not null default now());
grant select, insert, delete on public.storage_files to authenticated; grant all on public.storage_files to service_role;
alter table public.storage_files enable row level security;
create policy "Own files" on public.storage_files for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Per-user 10GB storage quota counter and the R2/S3 attachment registry.
create table public.user_storage (user_id uuid primary key references auth.users(id) on delete cascade, used_bytes bigint not null default 0 check (used_bytes >= 0), max_bytes bigint not null default 10737418240, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant select on public.user_storage to authenticated; grant all on public.user_storage to service_role;
alter table public.user_storage enable row level security;
create policy "Own storage quota read" on public.user_storage for select to authenticated using (user_id = auth.uid());
create trigger trg_user_storage_updated before update on public.user_storage for each row execute function public.update_updated_at_column();

create or replace function public.reserve_user_storage(p_user_id uuid, p_file_size bigint) returns boolean language plpgsql security definer set search_path = public as $$
declare v_limit bigint; v_used bigint;
begin
  if p_file_size is null or p_file_size < 0 then raise exception 'INVALID_FILE_SIZE'; end if;
  insert into public.user_storage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select max_bytes, used_bytes into v_limit, v_used from public.user_storage where user_id = p_user_id for update;
  if v_used + p_file_size > v_limit then raise exception 'STORAGE_QUOTA_EXCEEDED'; end if;
  return true;
end $$;

create or replace function public.commit_user_storage(p_user_id uuid, p_file_size bigint) returns bigint language plpgsql security definer set search_path = public as $$
declare v_limit bigint; v_used bigint;
begin
  insert into public.user_storage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select max_bytes, used_bytes into v_limit, v_used from public.user_storage where user_id = p_user_id for update;
  if v_used + p_file_size > v_limit then raise exception 'STORAGE_QUOTA_EXCEEDED'; end if;
  if v_used + p_file_size < 0 then raise exception 'STORAGE_USAGE_UNDERFLOW'; end if;
  update public.user_storage set used_bytes = used_bytes + p_file_size, updated_at = now() where user_id = p_user_id returning used_bytes into v_used;
  return v_used;
end $$;

create or replace function public.create_user_storage() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_storage (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created_storage after insert on auth.users for each row execute function public.create_user_storage();

insert into public.user_storage (user_id) select id from auth.users on conflict (user_id) do nothing;

revoke execute on function public.reserve_user_storage(uuid, bigint) from public, anon;
grant execute on function public.reserve_user_storage(uuid, bigint) to authenticated, service_role;
revoke execute on function public.commit_user_storage(uuid, bigint) from public, anon;
grant execute on function public.commit_user_storage(uuid, bigint) to authenticated, service_role;
revoke execute on function public.create_user_storage() from public, anon, authenticated;

create table public.attachments (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, channel_id text, file_name text not null default '', file_key text unique, storage_type text not null default 'external_bucket' check (storage_type in ('inline_base64', 'external_bucket')), file_data text, mime_type text not null, file_size bigint not null default 0 check (file_size >= 0), created_at timestamptz not null default now(), constraint attachments_payload_check check ((storage_type = 'inline_base64' and file_data is not null and file_key is null) or (storage_type = 'external_bucket' and file_key is not null and file_data is null)));
create index idx_attachments_user on public.attachments(user_id);
create index idx_attachments_channel on public.attachments(channel_id);
grant select, insert, delete on public.attachments to authenticated; grant all on public.attachments to service_role;
alter table public.attachments enable row level security;
create policy "Own attachments" on public.attachments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.call_push_subscriptions (
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
create index call_push_subscriptions_user_id_idx on public.call_push_subscriptions (user_id);
grant select, insert, update, delete on public.call_push_subscriptions to authenticated;
grant select, delete on public.call_push_subscriptions to service_role;
alter table public.call_push_subscriptions enable row level security;
create policy "Users manage their own call push subscriptions"
  on public.call_push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.get_verification_badge(_user_id uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from public.identity_verifications where user_id=_user_id and status='approved') then 'authenticated'
    when exists(select 1 from auth.users where id=_user_id and email_confirmed_at is not null) then 'verified'
    else 'none' end $$;
grant execute on function public.get_verification_badge(uuid) to anon, authenticated;

create policy "ID docs own upload" on storage.objects for insert to authenticated with check (bucket_id='identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ID docs own or admin read" on storage.objects for select to authenticated using (bucket_id='identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));
create policy "Chat files own upload" on storage.objects for insert to authenticated with check (bucket_id='chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Chat files own delete" on storage.objects for delete to authenticated using (bucket_id='chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
-- from 20261012105808_722066b4-005b-47d7-aa9a-df0f18f3aeed.sql
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.get_verification_badge(uuid) from public, anon;
grant execute on function public.get_verification_badge(uuid) to authenticated;
-- from 20261012110244_880a9c2a-16c5-4d14-8803-b9bf93c0faab.sql
create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  auth_user_id uuid not null unique,
  member_id text not null unique,
  first_name text, last_name text, full_name text,
  email text not null unique,
  email_verified boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Appwrite identity links are server-only and may only be changed by the trusted API.
create table public.appwrite_identity_links (
  appwrite_user_id text primary key,
  supabase_user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_email text not null,
  linked_at timestamptz not null default now()
);
alter table public.appwrite_identity_links enable row level security;
revoke all on public.appwrite_identity_links from public, anon, authenticated;
grant all on public.appwrite_identity_links to service_role;
grant select, update on public.members to authenticated;
grant all on public.members to service_role;
alter table public.members enable row level security;
create policy "Read own profile" on public.members for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "Edit own profile" on public.members for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger trg_members_updated before update on public.members for each row execute function public.update_updated_at_column();

-- Block people from changing protected fields on their own profile
create or replace function public.protect_member_fields() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.member_id := old.member_id; new.email := old.email;
    new.email_verified := old.email_verified; new.auth_user_id := old.auth_user_id;
  end if;
  return new;
end $$;
create trigger trg_members_protect before update on public.members for each row execute function public.protect_member_fields();

create or replace function public.handle_new_member() returns trigger language plpgsql security definer set search_path = public as $$
declare mid text := coalesce(nullif(new.raw_user_meta_data->>'member_id',''), '10' || lpad((floor(random()*100000000))::text, 8, '0'));
begin
  insert into public.members (id, auth_user_id, member_id, first_name, last_name, full_name, email, email_verified)
  values (new.id, new.id, mid, new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name',
    nullif(trim(coalesce(new.raw_user_meta_data->>'first_name','') || ' ' || coalesce(new.raw_user_meta_data->>'last_name','')), ''),
    lower(new.email), new.email_confirmed_at is not null)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_member();

create or replace function public.sync_member_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.members set email = lower(new.email), email_verified = new.email_confirmed_at is not null where id = new.id;
  return new;
end $$;
create trigger on_auth_user_updated after update of email, email_confirmed_at on auth.users for each row execute function public.sync_member_email();
revoke execute on function public.handle_new_member() from public, anon, authenticated;
revoke execute on function public.sync_member_email() from public, anon, authenticated;

-- Backfill existing accounts
insert into public.members (id, auth_user_id, member_id, first_name, last_name, full_name, email, email_verified)
select u.id, u.id, coalesce(nullif(u.raw_user_meta_data->>'member_id',''), '10' || lpad((floor(random()*100000000))::text, 8, '0')),
  u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name',
  nullif(trim(coalesce(u.raw_user_meta_data->>'first_name','') || ' ' || coalesce(u.raw_user_meta_data->>'last_name','')), ''),
  lower(u.email), u.email_confirmed_at is not null
from auth.users u where u.email is not null on conflict do nothing;

-- Find a person by their Nexus number (only public details)
create or replace function public.lookup_member_by_nexus_id(p_member_id text)
returns table (id uuid, member_id text, first_name text, last_name text, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select id, member_id, first_name, last_name, full_name, avatar_url from public.members where member_id = p_member_id limit 1 $$;
revoke execute on function public.lookup_member_by_nexus_id(text) from public, anon;
grant execute on function public.lookup_member_by_nexus_id(text) to authenticated;
-- from 20261012113128_6f6c8415-a46e-4446-84e3-c5951468a2fe.sql
alter table public.members add column if not exists bio text, add column if not exists interests text[];
-- from 20261012122632_31486d60-08f7-48ec-a6e7-0d32384bd185.sql
CREATE TABLE public.auth_email_code_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);

GRANT ALL ON public.auth_email_code_limits TO service_role;

ALTER TABLE public.auth_email_code_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_auth_email_code_limit(p_bucket_key text, p_window_seconds integer, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamp with time zone;
  v_count integer;
BEGIN
  INSERT INTO public.auth_email_code_limits (bucket_key, window_start, count)
  VALUES (p_bucket_key, now(), 1)
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT window_start, count INTO v_start, v_count
  FROM public.auth_email_code_limits
  WHERE bucket_key = p_bucket_key
  FOR UPDATE;

  IF v_start < now() - make_interval(secs => p_window_seconds) THEN
    UPDATE public.auth_email_code_limits
    SET window_start = now(), count = 1
    WHERE bucket_key = p_bucket_key;
    RETURN true;
  END IF;

  IF v_count >= p_limit THEN
    RETURN false;
  END IF;

  UPDATE public.auth_email_code_limits
  SET count = count + 1
  WHERE bucket_key = p_bucket_key;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_auth_email_code_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_email_code_limit(text, integer, integer) TO service_role;
-- Contacts
create table if not exists public.contacts (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, nexus_id text not null, avatar_url text, created_at timestamptz not null default now(), unique (user_id, nexus_id));
grant select, insert, update, delete on public.contacts to authenticated; grant all on public.contacts to service_role;
alter table public.contacts enable row level security;
create policy "Own contacts" on public.contacts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Chat transport (replaces Appwrite)
create table public.chats (
  id uuid primary key default gen_random_uuid(), title text not null default 'New Chat', type text not null default 'private',
  avatar_url text, encrypted boolean not null default false, owner_id uuid, created_at timestamptz not null default now()
);
create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade, profile_id uuid not null,
  joined_at timestamptz not null default now(), primary key (chat_id, profile_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid, content text not null check (char_length(content) between 1 and 65535), type text not null default 'text',
  file_url text, file_name text, duration numeric, encrypted boolean not null default false, created_at timestamptz not null default now(),
  constraint messages_text_requires_encryption check (
    type in ('reaction', 'receipt', 'image', 'video', 'voice', 'file', 'document', 'call') or (
      encrypted is true
      and jsonb_typeof(content::jsonb) = 'object'
      and (content::jsonb - 'alg' - 'iv' - 'data') = '{}'::jsonb
      and content::jsonb ->> 'alg' = 'ECDH-P256+AES-256-GCM'
      and content::jsonb ->> 'alg' is not null
      and content::jsonb ->> 'iv' is not null
      and content::jsonb ->> 'data' is not null
      and (content::jsonb ->> 'iv') ~ '^[A-Za-z0-9+/]{16}$'
      and (content::jsonb ->> 'data') ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
      and length(content::jsonb ->> 'data') >= 24
      and mod(length(content::jsonb ->> 'data'), 4) = 0
      and (3 * (length(content::jsonb ->> 'data') / 4)
        - case
            when right(content::jsonb ->> 'data', 2) = '==' then 2
            when right(content::jsonb ->> 'data', 1) = '=' then 1
            else 0
          end) >= 17
    )
  )
);
create index idx_chat_members_profile on public.chat_members(profile_id);
create index idx_messages_chat_created on public.messages(chat_id, created_at);
grant select, insert, update, delete on public.chats, public.chat_members, public.messages to authenticated;
grant all on public.chats, public.chat_members, public.messages to service_role;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
create or replace function public.is_chat_member(_chat uuid, _user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select _user = (select auth.uid())
    and exists (select 1 from public.chat_members where chat_id = _chat and profile_id = _user) $$;
drop policy if exists "Chat files signed-in read" on storage.objects;
create policy "Chat members read chat files" on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_chat_member(
          ((storage.foldername(name))[2])::uuid,
          (select auth.uid())
        )
      else false
    end
  )
);
create policy "View own chats" on public.chats for select to authenticated using (owner_id = auth.uid() or public.is_chat_member(id, auth.uid()));
create policy "Create owned chats" on public.chats for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners update chats" on public.chats for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete chats" on public.chats for delete to authenticated using (owner_id = auth.uid());
create policy "View memberships of my chats" on public.chat_members for select to authenticated using (public.is_chat_member(chat_id, auth.uid()));
create policy "Owners add members" on public.chat_members for insert to authenticated with check (exists (select 1 from public.chats c where c.id = chat_id and c.owner_id = auth.uid()));
create policy "Leave chats" on public.chat_members for delete to authenticated using (profile_id = auth.uid());
create policy "Members read messages" on public.messages for select to authenticated using (public.is_chat_member(chat_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy "Members send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_chat_member(chat_id, auth.uid()));
create policy "Senders delete messages" on public.messages for delete to authenticated using (sender_id = auth.uid());
revoke execute on function public.is_chat_member(uuid, uuid) from public, anon;
grant execute on function public.is_chat_member(uuid, uuid) to authenticated, service_role;
revoke execute on function public.handle_new_member() from public, anon, authenticated;
revoke execute on function public.sync_member_email() from public, anon, authenticated;
revoke execute on function public.lookup_member_by_nexus_id(text) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.lookup_member_by_nexus_id(text) to authenticated, service_role;

alter publication supabase_realtime add table public.contacts;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.chat_members;

create or replace function public.admin_exists() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where role='admin') $$;
revoke execute on function public.admin_exists() from public, anon;
grant execute on function public.admin_exists() to authenticated;

drop policy if exists "Own ID docs upload" on storage.objects;
drop policy if exists "Own ID docs read or admin" on storage.objects;
create policy "Own ID docs upload" on storage.objects for insert to authenticated with check (bucket_id='identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Own ID docs read or admin" on storage.objects for select to authenticated using (bucket_id='identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));
-- 20261013212651_a266bd67-bc53-4083-af85-83df904ae8ad.sql
create unique index if not exists identity_verifications_user_id_key on public.identity_verifications(user_id);
create or replace function public.stamp_idv_review() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('approved','rejected') and new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_idv_review on public.identity_verifications;
create trigger trg_idv_review before update on public.identity_verifications for each row execute function public.stamp_idv_review();-- security hardening
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- move privileged bodies into the non-exposed schema
alter function public.admin_exists() set schema private;
alter function public.get_verification_badge(uuid) set schema private;
alter function public.lookup_member_by_nexus_id(text) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.admin_exists(), private.get_verification_badge(uuid),
  private.lookup_member_by_nexus_id(text) to authenticated;

-- thin invoker wrappers keep the same API names
create function public.admin_exists() returns boolean language sql stable security invoker set search_path = public as $$ select private.admin_exists() $$;
create function public.get_verification_badge(_user_id uuid) returns text language sql stable security invoker set search_path = public as $$ select private.get_verification_badge(_user_id) $$;
create function public.lookup_member_by_nexus_id(p_member_id text) returns table(id uuid, member_id text, first_name text, last_name text, full_name text, avatar_url text) language sql stable security invoker set search_path = public as $$ select * from private.lookup_member_by_nexus_id(p_member_id) $$;
revoke execute on function public.admin_exists(), public.get_verification_badge(uuid), public.lookup_member_by_nexus_id(text) from public, anon;
grant execute on function public.admin_exists(), public.get_verification_badge(uuid), public.lookup_member_by_nexus_id(text) to authenticated;

-- rate limiter is server-only
revoke execute on function public.consume_auth_email_code_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_auth_email_code_limit(text,integer,integer) to service_role;

-- server-only table: explicit deny policy documents intent
create policy "No client access" on public.auth_email_code_limits for all to authenticated, anon using (false) with check (false);

-- Admin member management (admin-only RPCs)
create schema if not exists private;
create or replace function private.admin_update_member(_member_id uuid, _first_name text, _last_name text, _bio text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update public.members set first_name = left(trim(_first_name),80), last_name = left(trim(_last_name),80),
    full_name = left(trim(coalesce(_first_name,'')||' '||coalesce(_last_name,'')),161), bio = left(_bio,500), updated_at = now()
  where id = _member_id;
end $$;
create or replace function private.admin_set_admin_role(_user_id uuid, _grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if _grant then
    insert into public.user_roles(user_id, role) select _user_id, 'admin'
    where not exists (select 1 from public.user_roles where user_id=_user_id and role='admin');
  else
    if _user_id = auth.uid() then raise exception 'You cannot remove your own admin role'; end if;
    delete from public.user_roles where user_id=_user_id and role='admin';
  end if;
end $$;
create or replace function private.admin_list_admins()
returns table(user_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query select r.user_id from public.user_roles r where r.role='admin';
end $$;
grant usage on schema private to authenticated;
grant execute on function private.admin_update_member(uuid,text,text,text), private.admin_set_admin_role(uuid,boolean), private.admin_list_admins() to authenticated;
create or replace function public.admin_update_member(_member_id uuid, _first_name text, _last_name text, _bio text)
returns void language sql set search_path = public as $$ select private.admin_update_member(_member_id,_first_name,_last_name,_bio) $$;
create or replace function public.admin_set_admin_role(_user_id uuid, _grant boolean)
returns void language sql set search_path = public as $$ select private.admin_set_admin_role(_user_id,_grant) $$;
create or replace function public.admin_list_admins()
returns table(user_id uuid) language sql stable set search_path = public as $$ select * from private.admin_list_admins() $$;
revoke all on function public.admin_update_member(uuid,text,text,text), public.admin_set_admin_role(uuid,boolean), public.admin_list_admins() from public, anon;
grant execute on function public.admin_update_member(uuid,text,text,text), public.admin_set_admin_role(uuid,boolean), public.admin_list_admins() to authenticated;

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
-- 20261017020000_premium_member_badges.sql
-- Premium Member badges (blue) are granted ONLY by an admin through the admin
-- panel. KYC (gold) badges are granted ONLY when an admin approves an ID check.
-- Nothing is auto-assigned at signup, and every grant/revoke/review is recorded
-- in an admin audit log so badge assignments are traceable to an admin action.
create table if not exists public.premium_members (
  user_id uuid primary key,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  note text
);
revoke all on public.premium_members from public, anon;
grant select on public.premium_members to authenticated;
grant all on public.premium_members to service_role;
alter table public.premium_members enable row level security;
drop policy if exists "Own or admin read premium" on public.premium_members;
create policy "Own or admin read premium" on public.premium_members
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_user_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
revoke all on public.admin_audit_log from public, anon;
grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;
alter table public.admin_audit_log enable row level security;
drop policy if exists "Admins read audit log" on public.admin_audit_log;
create policy "Admins read audit log" on public.admin_audit_log
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function private.admin_set_premium_member(_user_id uuid, _grant boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if _user_id is null then raise exception 'A member is required'; end if;

  if _grant then
    insert into public.premium_members (user_id, granted_by, granted_at, note)
    values (_user_id, auth.uid(), now(), nullif(left(trim(coalesce(_note, '')), 500), ''))
    on conflict (user_id) do update
      set granted_by = excluded.granted_by, granted_at = excluded.granted_at, note = excluded.note;
  else
    delete from public.premium_members where user_id = _user_id;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (
    auth.uid(),
    case when _grant then 'premium_member.granted' else 'premium_member.revoked' end,
    _user_id,
    jsonb_build_object('note', nullif(left(trim(coalesce(_note, '')), 500), ''))
  );
end $$;
grant execute on function private.admin_set_premium_member(uuid, boolean, text) to authenticated;

create or replace function public.admin_set_premium_member(_user_id uuid, _grant boolean, _note text default null)
returns void language sql security invoker set search_path = public as $$
  select private.admin_set_premium_member(_user_id, _grant, _note)
$$;
revoke all on function public.admin_set_premium_member(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_premium_member(uuid, boolean, text) to authenticated;

-- Badge levels: 'premium' (blue, admin-granted) > 'authenticated' (blue, either
-- identity-verification tier approved) > 'none'. A confirmed email never grants a badge.
create or replace function private.get_verification_badge(_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.premium_members where user_id = _user_id) then 'premium'
    when exists (select 1 from public.identity_verifications where user_id = _user_id and status = 'approved') then 'authenticated'
    else 'none' end $$;
grant execute on function private.get_verification_badge(uuid) to authenticated;

create or replace function public.get_verification_badge(_user_id uuid)
returns text language sql stable security invoker set search_path = public as $$
  select private.get_verification_badge(_user_id)
$$;
revoke execute on function public.get_verification_badge(uuid) from public, anon;
grant execute on function public.get_verification_badge(uuid) to authenticated;

-- Batch lookup so user directories (contacts) resolve every badge in one call.
create or replace function private.get_verification_badges(_member_ids text[])
returns table(member_id text, badge text) language sql stable security definer set search_path = public as $$
  select m.member_id,
    case
      when exists (select 1 from public.premium_members p where p.user_id = m.id) then 'premium'
      when exists (select 1 from public.identity_verifications v where v.user_id = m.id and v.status = 'approved') then 'authenticated'
      else 'none' end
  from public.members m
  where m.member_id = any(_member_ids)
  limit 500 $$;
revoke execute on function private.get_verification_badges(text[]) from public, anon;
grant execute on function private.get_verification_badges(text[]) to authenticated;

create or replace function public.get_verification_badges(_member_ids text[])
returns table(member_id text, badge text) language sql stable security invoker set search_path = public as $$
  select * from private.get_verification_badges(_member_ids)
$$;
revoke execute on function public.get_verification_badges(text[]) from public, anon;
grant execute on function public.get_verification_badges(text[]) to authenticated;

create or replace function public.review_identity_verification(_id uuid, _approve boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _user_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update public.identity_verifications
    set status = case when _approve then 'approved' else 'rejected' end,
        reviewer_note = case when _approve then null else nullif(left(trim(coalesce(_note, '')), 500), '') end,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = _id and status = 'pending'
    returning user_id into _user_id;
  if _user_id is null then raise exception 'This ID check is no longer waiting for review'; end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (
    auth.uid(),
    case when _approve then 'kyc.approved' else 'kyc.rejected' end,
    _user_id,
    jsonb_build_object('verification_id', _id, 'note', nullif(left(trim(coalesce(_note, '')), 500), ''))
  );
end $$;
revoke execute on function public.review_identity_verification(uuid, boolean, text) from public, anon;
grant execute on function public.review_identity_verification(uuid, boolean, text) to authenticated;
-- 20261017030000_identity_verification_tiers.sql
-- APPLIED to production woavhlkgylarngqyvphf ("Nexus Next") on 2026-10-17. See the deployment record at the end of this file.
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

-- 20261017040000_social_feed.sql
-- APPLIED to production woavhlkgylarngqyvphf ("Nexus Next") on 2026-10-17. See the deployment record at the end of this file.
-- Facebook-style social feed: text, image and short-video posts with threaded
-- comments, multi-emoji reactions and admin moderation. Idempotent.
create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  content text not null default '' check (char_length(content) <= 5000),
  media jsonb not null default '[]'::jsonb,
  is_admin_post boolean not null default false,
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_feed_posts_created on public.feed_posts(created_at desc);
create index if not exists idx_feed_posts_author on public.feed_posts(author_id);

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  author_id uuid not null,
  parent_id uuid references public.feed_comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 3000),
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_feed_comments_post on public.feed_comments(post_id, created_at);
create index if not exists idx_feed_comments_parent on public.feed_comments(parent_id);

create table if not exists public.feed_reactions (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.feed_comment_reactions (
  comment_id uuid not null references public.feed_comments(id) on delete cascade,
  user_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

grant select, insert, update, delete on public.feed_posts, public.feed_comments to authenticated;
grant select, insert, update, delete on public.feed_reactions, public.feed_comment_reactions to authenticated;
grant all on public.feed_posts, public.feed_comments to service_role;
grant all on public.feed_reactions, public.feed_comment_reactions to service_role;

alter table public.feed_posts enable row level security;
alter table public.feed_comments enable row level security;
alter table public.feed_reactions enable row level security;
alter table public.feed_comment_reactions enable row level security;

drop trigger if exists trg_feed_posts_updated on public.feed_posts;
create trigger trg_feed_posts_updated before update on public.feed_posts
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_feed_comments_updated on public.feed_comments;
create trigger trg_feed_comments_updated before update on public.feed_comments
  for each row execute function public.update_updated_at_column();

-- Posts: everyone signed in can read active posts; authors manage their own;
-- admins can moderate any post.
drop policy if exists "Read feed posts" on public.feed_posts;
create policy "Read feed posts" on public.feed_posts for select to authenticated
  using (status = 'active' or author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Create own feed posts" on public.feed_posts;
create policy "Create own feed posts" on public.feed_posts for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "Manage own feed posts" on public.feed_posts;
create policy "Manage own feed posts" on public.feed_posts for update to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Delete own feed posts" on public.feed_posts;
create policy "Delete own feed posts" on public.feed_posts for delete to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Comments: readable with the post; authors edit/delete their own; admins moderate.
drop policy if exists "Read feed comments" on public.feed_comments;
create policy "Read feed comments" on public.feed_comments for select to authenticated
  using (status = 'active' or author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Create own feed comments" on public.feed_comments;
create policy "Create own feed comments" on public.feed_comments for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "Manage own feed comments" on public.feed_comments;
create policy "Manage own feed comments" on public.feed_comments for update to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Delete own feed comments" on public.feed_comments;
create policy "Delete own feed comments" on public.feed_comments for delete to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Reactions: readable by all signed-in members; each member owns their own row.
drop policy if exists "Read post reactions" on public.feed_reactions;
create policy "Read post reactions" on public.feed_reactions for select to authenticated using (true);
drop policy if exists "Manage own post reactions" on public.feed_reactions;
create policy "Manage own post reactions" on public.feed_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Read comment reactions" on public.feed_comment_reactions;
create policy "Read comment reactions" on public.feed_comment_reactions for select to authenticated using (true);
drop policy if exists "Manage own comment reactions" on public.feed_comment_reactions;
create policy "Manage own comment reactions" on public.feed_comment_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live feed updates across users and admins.
do $$ begin alter publication supabase_realtime add table public.feed_posts; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_comments; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_reactions; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_comment_reactions; exception when others then null; end $$;

-- 20261017080000_e2ee_default_enabled.sql
-- Default-on end-to-end encryption for newly registered accounts. PREPARED, not
-- yet applied to production (see the deployment record below).
-- The column is created with a false default so existing rows are stamped false
-- (pre-existing accounts keep their opt-in behaviour); the default is then
-- switched to true, so accounts created afterwards are recorded as encrypted by
-- default. The private key never leaves the device, so this column is a status
-- mirror used for audit and post-signup verification, not a sending switch.
alter table public.members
  add column if not exists e2ee_enabled boolean not null default false;
alter table public.members
  add column if not exists e2ee_key_published_at timestamptz;
alter table public.members
  alter column e2ee_enabled set default true;

-- Members record their own provisioning outcome; security definer so the narrow
-- write cannot be widened into an edit of other protected profile columns.
create or replace function public.set_my_e2ee_status(p_enabled boolean, p_key_published boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.members
     set e2ee_enabled = coalesce(p_enabled, e2ee_enabled),
         e2ee_key_published_at = case
           when p_key_published then now()
           else e2ee_key_published_at
         end
   where id = auth.uid();
end $$;
revoke execute on function public.set_my_e2ee_status(boolean, boolean) from public, anon;
grant execute on function public.set_my_e2ee_status(boolean, boolean) to authenticated;

-- ===========================================================================
-- Deployment record (audit trail)
-- ===========================================================================
-- Project   woavhlkgylarngqyvphf ("Nexus Next", org dopuwyqqfvopcvdppvkt, West EU (Ireland))
-- Date      2026-10-17
-- Scope     the two migrations above, applied in dependency order:
--             1. 20261017030000_identity_verification_tiers.sql
--             2. 20261017040000_social_feed.sql
-- Method    `supabase db push --linked`. The 9 migrations already present on the
--           remote database but missing from the CLI's migration history were
--           temporarily excluded so that only these two were pushed, then
--           restored. `--include-all` was deliberately not used, because it would
--           have tried to recreate objects that already exist.
-- Pre-check `supabase db push --linked --dry-run` listed exactly those two files.
-- Backup    supabase/backups/2026-10-17T16-30-17-468Z_public_data.sql
--           SHA-256 39260c6c7d908185760ab7d07853ab2904a85e1543c4b932fe4cabe0bf5b0314
--           16 public tables / 15 rows, produced by scripts/backup-supabase.js
--           Rollback: psql "$SUPABASE_DB_URL" -f supabase/backups/<that file>
--                     (FK checks are disabled for the duration of the restore)
-- Verified  Automated read-only checks against the live database: 74 of 77 passed.
--           - identity_verifications gained tier, full_legal_name, date_of_birth,
--             document_type, document_number, issuing_country (all nullable);
--             id_document_path is now nullable; identity_verifications_tier_check
--             enforces tier in ('instant','manual'); submit_instant_identity_verification
--             (text, numeric) is SECURITY DEFINER with search_path pinned, and is
--             executable by authenticated and service_role but not by anon.
--           - feed_posts, feed_comments, feed_reactions and feed_comment_reactions
--             created with RLS enabled, 12 policies, 4 indexes, 2 updated_at
--             triggers, 4 ON DELETE CASCADE foreign keys, grants for
--             authenticated/service_role, and all four added to the
--             supabase_realtime publication.
--           - No data loss: members 3, chats 1, chat_members 2, messages 3,
--             contacts 1, storage_files 1 and auth_email_code_limits 4 all match
--             the pre-migration backup exactly.
--           - No invalid indexes in public and no deadlocks recorded.
-- Notes     1. public.profiles and public.current_member_profile_id() do not exist
--              on this project. That predates this deployment (neither migration
--              drops or renames anything), so the REQUIRED_TABLES and
--              REQUIRED_FUNCTIONS lists in scripts/lib/supabase-schema.js do not
--              fully describe this project. Reconcile separately.
--           2. Supabase logs were not reachable from this workspace: the CLI
--              exposes no log command and no Management API token is stored here.
--              Health was assessed from pg_stat_database instead. Review
--              Dashboard -> Logs -> Postgres for the same window if required.
--           3. Both migrations are also recorded in the CLI's
--              supabase_migrations.schema_migrations history.
-- ===========================================================================

-- ===========================================================================
-- Repository maintenance  2026-10-17  Retired superseded migrations
-- ---------------------------------------------------------------------------
-- Removed    supabase/migrations/20261006000000_initial_nexus_schema.sql
--            supabase/migrations/20261006010000_authenticated_member_lookup.sql
-- Reason     Both files belong to the abandoned profiles-based design. Nothing
--            they create survives on a provisioned project: 20261012110244
--            recreates public.members, the protected-field and Auth triggers
--            (on_auth_user_created / on_auth_user_updated), the account backfill
--            and lookup_member_by_nexus_id; 20261012122632 recreates the
--            email-code rate-limit table and RPC; 20261017000000 recreates
--            chats / chat_members / messages. public.profiles,
--            verify_member_login, current_member_profile_id(),
--            current_member_is_admin(), create_member_for_auth_user(),
--            sync_member_email_from_auth_user(), auth_email_code_rate_limits,
--            on_auth_user_created_nexus_member and
--            on_auth_user_updated_nexus_email are absent from the live schema.
-- DDL        None. No production statement was executed by this change.
-- Effect     Fresh `npm run db:setup` still provisions the full schema from the
--            remaining migration files. A project whose
--            public.nexus_schema_migrations history still lists the retired
--            versions reports them as "exists in source: false" in
--            `npm run db:verify`; that is expected and does not apply to
--            woavhlkgylarngqyvphf, which tracks history in
--            supabase_migrations.schema_migrations.
-- Follow-up  This resolves note 1 above: scripts/lib/supabase-schema.js no longer
--            lists the profiles-based objects, so REQUIRED_TABLES /
--            REQUIRED_FUNCTIONS now match the live schema.
-- ===========================================================================

-- 20261020100000_content_reports_and_blocks.sql
-- User-generated content controls required by the Google Play and Apple App
-- Store policies: members can report offensive content and block abusive
-- members, and admins review the report queue.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_type text not null check (target_type in ('post', 'comment', 'member')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'misinformation', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_reports_status on public.content_reports(status, created_at desc);
create index if not exists idx_content_reports_reporter on public.content_reports(reporter_id);
create unique index if not exists uq_content_reports_open
  on public.content_reports(reporter_id, target_type, target_id)
  where status = 'open';

create table if not exists public.blocked_users (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists idx_blocked_users_blocked on public.blocked_users(blocked_id);

grant select, insert, update on public.content_reports to authenticated;
grant select, insert, delete on public.blocked_users to authenticated;
grant all on public.content_reports, public.blocked_users to service_role;

alter table public.content_reports enable row level security;
alter table public.blocked_users enable row level security;

drop trigger if exists trg_content_reports_updated on public.content_reports;
create trigger trg_content_reports_updated before update on public.content_reports
  for each row execute function public.update_updated_at_column();

drop policy if exists "Create own reports" on public.content_reports;
create policy "Create own reports" on public.content_reports for insert to authenticated
  with check (reporter_id = auth.uid());
drop policy if exists "Read own or all reports" on public.content_reports;
create policy "Read own or all reports" on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins review reports" on public.content_reports;
create policy "Admins review reports" on public.content_reports for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Read own blocks" on public.blocked_users;
create policy "Read own blocks" on public.blocked_users for select to authenticated
  using (blocker_id = auth.uid());
drop policy if exists "Create own blocks" on public.blocked_users;
create policy "Create own blocks" on public.blocked_users for insert to authenticated
  with check (blocker_id = auth.uid());
drop policy if exists "Delete own blocks" on public.blocked_users;
create policy "Delete own blocks" on public.blocked_users for delete to authenticated
  using (blocker_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.blocked_users; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.content_reports; exception when others then null; end $$;

-- 20261020110000_member_profile_directory_rpc.sql
-- Author names must resolve for every member. public.members is readable only for
-- the caller's own row ("Read own profile" above), so the direct members lookups
-- in src/lib/feeds.js and src/lib/moderation.js returned nothing for other
-- authors and every post, comment and blocked account rendered as the
-- "Nexus member" placeholder. This resolver returns directory fields for a list
-- of ids, following the same shape as lookup_member_by_nexus_id and
-- list_my_contacts: security definer, directory fields only, authenticated only.
create or replace function public.list_member_profiles(p_ids uuid[])
returns table (id uuid, member_id text, full_name text, first_name text, last_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select m.id, m.member_id, m.full_name, m.first_name, m.last_name, m.avatar_url
  from public.members m
  where m.id = any(coalesce(p_ids, array[]::uuid[]))
  limit 500
$$;
revoke execute on function public.list_member_profiles(uuid[]) from public, anon;
grant execute on function public.list_member_profiles(uuid[]) to authenticated, service_role;

-- ===========================================================================
-- Deployment record   2026-10-20
-- ===========================================================================
-- Scope     supabase/migrations/20261020110000_member_profile_directory_rpc.sql
--           (adds public.list_member_profiles(uuid[])), applied on its own after
--           20261017080000, 20261020090000 and 20261020100000 were confirmed
--           already present on the remote project.
-- Method    scripts/apply-pending-migrations.mjs — one transaction behind an
--           advisory lock, each version recorded in
--           supabase_migrations.schema_migrations; the three earlier files
--           reported SKIP (already applied).
-- Backup    supabase/backups/2026-10-20T18-22-28-217Z_public_data.sql
--           SHA-256 8d0b7415a7d44197e22e76e9ebb3aab9d42bc14c224cb3e954b86a1787ef0239
--           19 public tables / 65 rows, produced by scripts/backup-supabase.js
--           Rollback: drop function public.list_member_profiles(uuid[]);
--           No table, row or policy is touched, so the data backup is
--           precautionary only.
-- Verified  scripts/verify-migration-objects.mjs: 22 of 22 checks passed —
--           list_member_profiles exists, is executable by authenticated and is
--           NOT executable by anon (confirmed via has_function_privilege).
--           Browser check signed in as demo1 on /app/feeds: a post authored by
--           demo2 now renders "Demo Reviewer Two" instead of the
--           "Nexus member" fallback produced by the previous direct table read.
-- ===========================================================================
