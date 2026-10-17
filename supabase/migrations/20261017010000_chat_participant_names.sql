-- Store both participants' display names on the chat so each viewer can render
-- the *other* participant's name (sender sees the recipient, recipient sees the
-- sender) instead of the shared `title`, which was fixed to whoever created it.
alter table public.chats add column if not exists participant_names jsonb;

-- Backfill existing 1:1 chats from the members directory.
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
where sub.chat_id = c.id and c.participant_names is null;
