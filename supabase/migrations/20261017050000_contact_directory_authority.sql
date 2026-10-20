-- Contact names must follow the live directory, not a stored snapshot.
--
-- Root cause of the shared-name bug: contacts.name is written at save time, so
-- a stale (or cross-account) snapshot persisted the wrong label and every list
-- rendered it. This resolves each contact's display name and avatar from
-- public.members by Nexus number, scoped to the caller's own rows, and repairs
-- the stored snapshot so the raw-table fallback path is correct too.
-- Idempotent: safe to run more than once.

create or replace function public.list_my_contacts()
returns table (id uuid, name text, nexus_id text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(
           nullif(trim(m.full_name), ''),
           nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
           c.name
         ) as name,
         c.nexus_id,
         coalesce(m.avatar_url, c.avatar_url) as avatar_url,
         c.created_at
  from public.contacts c
  left join public.members m on m.member_id = c.nexus_id
  where c.user_id = auth.uid()
  order by c.created_at desc
  limit 500
$$;
revoke execute on function public.list_my_contacts() from public, anon;
grant execute on function public.list_my_contacts() to authenticated, service_role;

-- Repair stored snapshots so the raw-table fallback and any other consumer show
-- the directory name as well.
update public.contacts c
   set name = coalesce(
         nullif(trim(m.full_name), ''),
         nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
         c.name
       )
  from public.members m
 where m.member_id = c.nexus_id
   and c.name is distinct from coalesce(
         nullif(trim(m.full_name), ''),
         nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
         c.name
       );
