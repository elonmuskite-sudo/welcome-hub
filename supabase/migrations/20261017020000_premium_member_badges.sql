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

-- Admin-only grant/revoke of Premium Member status.
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

-- Badge levels: 'premium' (blue, admin-granted) > 'authenticated' (gold, KYC
-- approved by an admin) > 'none'. A confirmed email never grants a badge.
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

-- KYC decisions are admin-only and now recorded in the audit log as well.
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
