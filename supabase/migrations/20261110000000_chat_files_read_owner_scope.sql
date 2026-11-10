-- Tighten reads on the shared chat-files bucket.
--
-- The previous "Chat files signed-in read" policy granted every authenticated
-- member SELECT on every object in the bucket, so any signed-in user could list
-- and download another member's private chat attachments. Recipients never read
-- the object directly: uploads persist a long-lived signed URL on the message
-- (or feed post) and render that URL, and the server-side scanner plus the
-- Appwrite gateway act with the service-role key. Narrowing SELECT to the owner
-- folder (plus admins, for moderation) therefore does not affect delivery.
--
-- Forward-only: drop the broad policy and replace it with an owner/admin scope,
-- mirroring the existing "ID docs own or admin read" policy.

drop policy if exists "Chat files signed-in read" on storage.objects;

drop policy if exists "Chat files own or admin read" on storage.objects;
create policy "Chat files own or admin read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(), 'admin'))
  );
