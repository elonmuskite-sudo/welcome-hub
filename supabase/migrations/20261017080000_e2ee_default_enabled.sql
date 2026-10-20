-- Default-on end-to-end encryption for newly registered accounts.
--
-- New member rows carry e2ee_enabled = true so the server has a durable record
-- that the account was provisioned for encryption. Accounts that already exist
-- keep their current (opt-in) behaviour: the column is created with a false
-- default, so the existing rows are stamped false, and only then is the default
-- switched to true for accounts created from now on. Re-running is a no-op.
--
-- The device remains the source of truth for whether a given browser actually
-- encrypts: the private key never leaves the device, so this column is a status
-- mirror used for audit and post-signup verification, not a sending switch.

alter table public.members
  add column if not exists e2ee_enabled boolean not null default false;

alter table public.members
  add column if not exists e2ee_key_published_at timestamptz;

alter table public.members
  alter column e2ee_enabled set default true;

-- Members record their own provisioning outcome. security definer so the narrow
-- write cannot be widened into an edit of other protected profile columns; the
-- existing protect_member_fields trigger still guards member_id/email/etc.
create or replace function public.set_my_e2ee_status(p_enabled boolean, p_key_published boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.members
     set e2ee_enabled = coalesce(p_enabled, e2ee_enabled),
         e2ee_key_published_at = case
           when p_key_published then now()
           else e2ee_key_published_at
         end
   where id = auth.uid();
end $$;

revoke execute on function public.set_my_e2ee_status(boolean, boolean) from public, anon;
grant execute on function public.set_my_e2ee_status(boolean, boolean) to authenticated;
