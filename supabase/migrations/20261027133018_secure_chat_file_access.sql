create or replace function public.is_chat_member(_chat uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user = (select auth.uid())
    and exists (
      select 1
      from public.chat_members
      where chat_id = _chat
        and profile_id = _user
    )
$$;

revoke execute on function public.is_chat_member(uuid, uuid) from public, anon;
grant execute on function public.is_chat_member(uuid, uuid) to authenticated, service_role;

drop policy if exists "Chat files signed-in read" on storage.objects;
drop policy if exists "Chat members read chat files" on storage.objects;
-- Chat object paths are {uploader}/{chat UUID}/{file}; CASE avoids casting other folders.
create policy "Chat members read chat files"
on storage.objects
for select
to authenticated
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