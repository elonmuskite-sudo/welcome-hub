-- Backfill per-participant display names on chats created after the original
-- participant_names migration, and on any chat created through a path that did
-- not record them. Without this, chatDisplayName falls back to the shared title,
-- so every participant sees the same name (the recipient saw their own name).
--
-- Names are resolved from the members directory, matching 20261017010000.
-- Idempotent: only touches chats that still have no recorded names.

update public.chats c
set participant_names = sub.names
from (
  select cm.chat_id,
         jsonb_object_agg(
           m.id::text,
           coalesce(
             nullif(trim(m.full_name), ''),
             nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
             m.member_id
           )
         ) as names
  from public.chat_members cm
  join public.members m on m.id = cm.profile_id
  group by cm.chat_id
) sub
where sub.chat_id = c.id
  and (c.participant_names is null or c.participant_names = '{}'::jsonb);
