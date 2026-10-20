-- Author names must resolve for every member, not just the viewer.
--
-- Root cause: public.members is readable only for the caller's own row
-- ("Read own profile" in docs/supabase-schema.sql), so the direct
-- `from('members').select(...).in('id', ids)` lookups in src/lib/feeds.js and
-- src/lib/moderation.js matched nothing for anyone else. Every post, comment and
-- blocked account authored by another member therefore rendered as the
-- "Nexus member" placeholder. The moderation lookup also asked for a `nexus_id`
-- column that does not exist (the identifier column is `member_id`), so that
-- query failed outright and no name ever resolved there.
--
-- This adds a caller-scoped resolver for a list of ids, following the same shape
-- as lookup_member_by_nexus_id and list_my_contacts: security definer, directory
-- fields only, executable by authenticated users. Idempotent: safe to re-run.

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
