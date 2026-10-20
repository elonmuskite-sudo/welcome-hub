-- User-generated content controls required by app store policies: members can
-- report offensive content and block abusive members, and admins review the
-- reports. Idempotent forward migration.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_type text not null check (target_type in ('post', 'comment', 'member')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'misinformation', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_reports_status on public.content_reports(status, created_at desc);
create index if not exists idx_content_reports_reporter on public.content_reports(reporter_id);
-- One open report per member per target keeps the review queue meaningful.
create unique index if not exists uq_content_reports_open
  on public.content_reports(reporter_id, target_type, target_id)
  where status = 'open';

create table if not exists public.blocked_users (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists idx_blocked_users_blocked on public.blocked_users(blocked_id);

grant select, insert, update on public.content_reports to authenticated;
grant select, insert, delete on public.blocked_users to authenticated;
grant all on public.content_reports, public.blocked_users to service_role;

alter table public.content_reports enable row level security;
alter table public.blocked_users enable row level security;

drop trigger if exists trg_content_reports_updated on public.content_reports;
create trigger trg_content_reports_updated before update on public.content_reports
  for each row execute function public.update_updated_at_column();

-- Reports: members file their own and can see what they filed; admins review all.
drop policy if exists "Create own reports" on public.content_reports;
create policy "Create own reports" on public.content_reports for insert to authenticated
  with check (reporter_id = auth.uid());
drop policy if exists "Read own or all reports" on public.content_reports;
create policy "Read own or all reports" on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins review reports" on public.content_reports;
create policy "Admins review reports" on public.content_reports for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Blocks: each member manages their own block list.
drop policy if exists "Read own blocks" on public.blocked_users;
create policy "Read own blocks" on public.blocked_users for select to authenticated
  using (blocker_id = auth.uid());
drop policy if exists "Create own blocks" on public.blocked_users;
create policy "Create own blocks" on public.blocked_users for insert to authenticated
  with check (blocker_id = auth.uid());
drop policy if exists "Delete own blocks" on public.blocked_users;
create policy "Delete own blocks" on public.blocked_users for delete to authenticated
  using (blocker_id = auth.uid());

-- Keep block lists and the report queue live across a member's tabs.
do $$ begin alter publication supabase_realtime add table public.blocked_users; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.content_reports; exception when others then null; end $$;
