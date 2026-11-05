-- Allow owners, contacts, and active-feed viewers to read only the currently
-- selected profile photo, while preserving blocked-user visibility rules.
-- The existing chat-files bucket remains private; regular attachments retain
-- the chat-member policy and are not exposed by this profile-photo policy.

create or replace function public.can_read_contact_avatar(_owner_id text, _path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.members m
     where m.id::text = _owner_id
       and m.avatar_url = 'storage://' || _path
       and (
         m.id = auth.uid()
         or (
           (
             exists (
               select 1 from public.contacts c
                where c.nexus_id = m.member_id and c.user_id = auth.uid()
             )
             or exists (
               select 1 from public.feed_posts p
                where p.author_id = m.id and p.status = 'active'
             )
             or exists (
               select 1
                 from public.feed_comments fc
                 join public.feed_posts fp on fp.id = fc.post_id
                where fc.author_id = m.id
                  and (fp.status = 'active' or fp.author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
                  and (fc.status = 'active' or fc.author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
             )
             or public.has_role(auth.uid(), 'admin')
           )
           and not exists (
             select 1 from public.blocked_users bu
              where bu.blocker_id = auth.uid() and bu.blocked_id = m.id
           )
         )
       )
  )
$$;

revoke execute on function public.can_read_contact_avatar(text, text) from public, anon;
grant execute on function public.can_read_contact_avatar(text, text) to authenticated, service_role;

drop policy if exists "Contacts read active profile photos" on storage.objects;
create policy "Contacts read active profile photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-files'
    and public.can_read_contact_avatar((storage.foldername(name))[1], name)
  );
