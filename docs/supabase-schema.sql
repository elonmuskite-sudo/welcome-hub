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

create table public.user_storage_quotas (user_id uuid primary key, quota_bytes bigint not null default 5368709120, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant select on public.user_storage_quotas to authenticated; grant all on public.user_storage_quotas to service_role;
alter table public.user_storage_quotas enable row level security;
create policy "Own quota" on public.user_storage_quotas for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create trigger trg_quota_updated before update on public.user_storage_quotas for each row execute function public.update_updated_at_column();

create table public.storage_purchases (id uuid primary key default gen_random_uuid(), user_id uuid not null, tier text not null, added_bytes bigint not null, amount_cents integer not null, currency text not null default 'usd', status text not null default 'pending', checkout_session_id text unique, receipt_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant select on public.storage_purchases to authenticated; grant all on public.storage_purchases to service_role;
alter table public.storage_purchases enable row level security;
create policy "Own purchases" on public.storage_purchases for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create trigger trg_purchases_updated before update on public.storage_purchases for each row execute function public.update_updated_at_column();

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

create or replace function public.get_verification_badge(_user_id uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from public.identity_verifications where user_id=_user_id and status='approved') then 'authenticated'
    when exists(select 1 from auth.users where id=_user_id and email_confirmed_at is not null) then 'verified'
    else 'none' end $$;
grant execute on function public.get_verification_badge(uuid) to anon, authenticated;

create policy "ID docs own upload" on storage.objects for insert to authenticated with check (bucket_id='identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ID docs own or admin read" on storage.objects for select to authenticated using (bucket_id='identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));
create policy "Chat files own upload" on storage.objects for insert to authenticated with check (bucket_id='chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Chat files signed-in read" on storage.objects for select to authenticated using (bucket_id='chat-files');
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
create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  order_id text, payment_id text, payment_status text,
  signature_valid boolean not null default false,
  outcome text not null default 'received',
  error text, payload jsonb
);
grant select on public.payment_webhook_events to authenticated;
grant all on public.payment_webhook_events to service_role;
alter table public.payment_webhook_events enable row level security;
create policy "Admins read webhook events" on public.payment_webhook_events for select to authenticated using (public.has_role(auth.uid(),'admin'));
create index on public.payment_webhook_events (received_at desc);
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
  file_url text, file_name text, duration numeric, encrypted boolean not null default false, created_at timestamptz not null default now()
);
create index idx_chat_members_profile on public.chat_members(profile_id);
create index idx_messages_chat_created on public.messages(chat_id, created_at);
grant select, insert, update, delete on public.chats, public.chat_members, public.messages to authenticated;
grant all on public.chats, public.chat_members, public.messages to service_role;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
create or replace function public.is_chat_member(_chat uuid, _user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = _chat and profile_id = _user) $$;
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
alter publication supabase_realtime add table public.storage_purchases;
-- USDT payments + admin claim
create table if not exists public.payment_settings (
  id int primary key default 1 check (id = 1),
  wallet_address text not null,
  qr_image_url text,
  network text not null default 'BEP20',
  updated_at timestamptz not null default now()
);
grant select on public.payment_settings to authenticated;
grant insert, update on public.payment_settings to authenticated;
grant all on public.payment_settings to service_role;
alter table public.payment_settings enable row level security;
create policy "Signed-in read wallet" on public.payment_settings for select to authenticated using (true);
create policy "Admins insert wallet" on public.payment_settings for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "Admins update wallet" on public.payment_settings for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

alter table public.storage_purchases add column if not exists tx_reference text;
alter table public.storage_purchases add column if not exists reviewed_by uuid;
alter table public.storage_purchases add column if not exists reviewed_at timestamptz;

create or replace function public.submit_usdt_payment(_tier text, _tx_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bytes bigint; v_cents int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from public.payment_settings where id=1) then raise exception 'Payments are not set up yet'; end if;
  case _tier
    when 'plus_50' then v_bytes := 50::bigint*1073741824; v_cents := 199;
    when 'plus_200' then v_bytes := 200::bigint*1073741824; v_cents := 499;
    when 'plus_1000' then v_bytes := 1000::bigint*1073741824; v_cents := 1499;
    else raise exception 'Unknown plan';
  end case;
  if (select count(*) from public.storage_purchases where user_id=auth.uid() and status='awaiting_approval') >= 3 then
    raise exception 'You already have payments waiting for approval';
  end if;
  insert into public.storage_purchases(user_id,tier,added_bytes,amount_cents,currency,status,tx_reference)
  values (auth.uid(),_tier,v_bytes,v_cents,'usdt','awaiting_approval',nullif(left(trim(coalesce(_tx_reference,'')),120),''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.submit_usdt_payment(text,text) from public, anon;
grant execute on function public.submit_usdt_payment(text,text) to authenticated;

create or replace function public.review_usdt_payment(_purchase_id uuid, _approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p public.storage_purchases;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admins only'; end if;
  select * into p from public.storage_purchases where id=_purchase_id for update;
  if p.id is null or p.status <> 'awaiting_approval' then raise exception 'Payment is not waiting for approval'; end if;
  update public.storage_purchases set status = case when _approve then 'completed' else 'rejected' end,
    reviewed_by=auth.uid(), reviewed_at=now() where id=_purchase_id;
  if _approve then
    insert into public.user_storage_quotas(user_id, quota_bytes) values (p.user_id, 5368709120 + p.added_bytes)
    on conflict (user_id) do update set quota_bytes = public.user_storage_quotas.quota_bytes + p.added_bytes;
  end if;
end $$;
revoke execute on function public.review_usdt_payment(uuid,boolean) from public, anon;
grant execute on function public.review_usdt_payment(uuid,boolean) to authenticated;

create or replace function public.admin_exists() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where role='admin') $$;
revoke execute on function public.admin_exists() from public, anon;
grant execute on function public.admin_exists() to authenticated;

-- one pending/approved ID check per user max
create policy "Signed-in read QR" on storage.objects for select to authenticated using (bucket_id='payment-qr');
create policy "Admins upload QR" on storage.objects for insert to authenticated with check (bucket_id='payment-qr' and public.has_role(auth.uid(),'admin'));
create policy "Admins change QR" on storage.objects for update to authenticated using (bucket_id='payment-qr' and public.has_role(auth.uid(),'admin'));

drop policy if exists "Own ID docs upload" on storage.objects;
drop policy if exists "Own ID docs read or admin" on storage.objects;
create policy "Own ID docs upload" on storage.objects for insert to authenticated with check (bucket_id='identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Own ID docs read or admin" on storage.objects for select to authenticated using (bucket_id='identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));

do $$ begin
  alter publication supabase_realtime add table public.storage_purchases;
exception when others then null; end $$;
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
create trigger trg_idv_review before update on public.identity_verifications for each row execute function public.stamp_idv_review();-- security hardening + invoices
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- move privileged bodies into the non-exposed schema
alter function public.submit_usdt_payment(text,text) set schema private;
alter function public.review_usdt_payment(uuid,boolean) set schema private;
alter function public.admin_exists() set schema private;
alter function public.get_verification_badge(uuid) set schema private;
alter function public.lookup_member_by_nexus_id(text) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.submit_usdt_payment(text,text), private.review_usdt_payment(uuid,boolean),
  private.admin_exists(), private.get_verification_badge(uuid),
  private.lookup_member_by_nexus_id(text) to authenticated;

-- thin invoker wrappers keep the same API names
create function public.submit_usdt_payment(_tier text, _tx_reference text) returns uuid language sql security invoker set search_path = public as $$ select private.submit_usdt_payment(_tier, _tx_reference) $$;
create function public.review_usdt_payment(_purchase_id uuid, _approve boolean) returns void language sql security invoker set search_path = public as $$ select private.review_usdt_payment(_purchase_id, _approve) $$;
create function public.admin_exists() returns boolean language sql stable security invoker set search_path = public as $$ select private.admin_exists() $$;
create function public.get_verification_badge(_user_id uuid) returns text language sql stable security invoker set search_path = public as $$ select private.get_verification_badge(_user_id) $$;
create function public.lookup_member_by_nexus_id(p_member_id text) returns table(id uuid, member_id text, first_name text, last_name text, full_name text, avatar_url text) language sql stable security invoker set search_path = public as $$ select * from private.lookup_member_by_nexus_id(p_member_id) $$;
revoke execute on function public.submit_usdt_payment(text,text), public.review_usdt_payment(uuid,boolean), public.admin_exists(), public.get_verification_badge(uuid), public.lookup_member_by_nexus_id(text) from public, anon;
grant execute on function public.submit_usdt_payment(text,text), public.review_usdt_payment(uuid,boolean), public.admin_exists(), public.get_verification_badge(uuid), public.lookup_member_by_nexus_id(text) to authenticated;

-- rate limiter is server-only
revoke execute on function public.consume_auth_email_code_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_auth_email_code_limit(text,integer,integer) to service_role;

-- server-only table: explicit deny policy documents intent
create policy "No client access" on public.auth_email_code_limits for all to authenticated, anon using (false) with check (false);

-- invoice numbers
create sequence if not exists public.invoice_number_seq start 1001;
alter table public.storage_purchases add column if not exists invoice_number bigint unique default nextval('public.invoice_number_seq');
grant usage on sequence public.invoice_number_seq to service_role;
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

