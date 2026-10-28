-- Per-user 10GB storage quota counter and the R2/S3 attachment registry.
-- Mirrors the user_storage + attachments block in docs/supabase-schema.sql so the
-- CLI (db push) and the production psql apply stay in step.

create table if not exists public.user_storage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  max_bytes bigint not null default 10737418240,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_storage enable row level security;
grant select on public.user_storage to authenticated;
grant all on public.user_storage to service_role;
create policy "Own storage quota read" on public.user_storage
  for select to authenticated using ((select auth.uid()) = user_id);
create trigger trg_user_storage_updated before update on public.user_storage
  for each row execute function public.update_updated_at_column();

-- Reserve quota under a row lock so concurrent uploads cannot overshoot 10GB.
create or replace function public.reserve_user_storage(p_user_id uuid, p_file_size bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_limit bigint; v_used bigint;
begin
  if p_file_size is null or p_file_size < 0 then raise exception 'INVALID_FILE_SIZE'; end if;
  insert into public.user_storage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select max_bytes, used_bytes into v_limit, v_used from public.user_storage where user_id = p_user_id for update;
  if v_used + p_file_size > v_limit then raise exception 'STORAGE_QUOTA_EXCEEDED'; end if;
  return true;
end $$;

-- Atomically increment usage after upload (negative reverses a failed confirm).
create or replace function public.commit_user_storage(p_user_id uuid, p_file_size bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_limit bigint; v_used bigint;
begin
  insert into public.user_storage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select max_bytes, used_bytes into v_limit, v_used from public.user_storage where user_id = p_user_id for update;
  if v_used + p_file_size > v_limit then raise exception 'STORAGE_QUOTA_EXCEEDED'; end if;
  if v_used + p_file_size < 0 then raise exception 'STORAGE_USAGE_UNDERFLOW'; end if;
  update public.user_storage set used_bytes = used_bytes + p_file_size, updated_at = now()
    where user_id = p_user_id returning used_bytes into v_used;
  return v_used;
end $$;

create or replace function public.create_user_storage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_storage (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created_storage after insert on auth.users
  for each row execute function public.create_user_storage();

insert into public.user_storage (user_id) select id from auth.users on conflict (user_id) do nothing;

-- SECURITY DEFINER functions in the exposed public schema are callable by every
-- role by default, so revoke the default PUBLIC grant and narrow it explicitly.
revoke execute on function public.reserve_user_storage(uuid, bigint) from public, anon;
grant execute on function public.reserve_user_storage(uuid, bigint) to authenticated, service_role;
revoke execute on function public.commit_user_storage(uuid, bigint) from public, anon;
grant execute on function public.commit_user_storage(uuid, bigint) to authenticated, service_role;
revoke execute on function public.create_user_storage() from public, anon, authenticated;

-- Server-owned registry of R2/S3 objects. channel_id records which surface the
-- object belongs to ('feed' = public feed media, otherwise a chat UUID).
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text,
  file_key text not null unique,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_user on public.attachments(user_id);
create index if not exists idx_attachments_channel on public.attachments(channel_id);
alter table public.attachments enable row level security;
grant select, insert, delete on public.attachments to authenticated;
grant all on public.attachments to service_role;
create policy "Own attachments" on public.attachments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
