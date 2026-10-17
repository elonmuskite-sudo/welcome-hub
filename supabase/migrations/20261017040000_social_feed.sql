-- Facebook-style social feed: text, image and short-video posts with threaded
-- comments, multi-emoji reactions and admin moderation. Idempotent.

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  content text not null default '' check (char_length(content) <= 5000),
  media jsonb not null default '[]'::jsonb,
  is_admin_post boolean not null default false,
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_feed_posts_created on public.feed_posts(created_at desc);
create index if not exists idx_feed_posts_author on public.feed_posts(author_id);

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  author_id uuid not null,
  parent_id uuid references public.feed_comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 3000),
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_feed_comments_post on public.feed_comments(post_id, created_at);
create index if not exists idx_feed_comments_parent on public.feed_comments(parent_id);

create table if not exists public.feed_reactions (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.feed_comment_reactions (
  comment_id uuid not null references public.feed_comments(id) on delete cascade,
  user_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

grant select, insert, update, delete on public.feed_posts, public.feed_comments to authenticated;
grant select, insert, update, delete on public.feed_reactions, public.feed_comment_reactions to authenticated;
grant all on public.feed_posts, public.feed_comments to service_role;
grant all on public.feed_reactions, public.feed_comment_reactions to service_role;

alter table public.feed_posts enable row level security;
alter table public.feed_comments enable row level security;
alter table public.feed_reactions enable row level security;
alter table public.feed_comment_reactions enable row level security;

drop trigger if exists trg_feed_posts_updated on public.feed_posts;
create trigger trg_feed_posts_updated before update on public.feed_posts
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_feed_comments_updated on public.feed_comments;
create trigger trg_feed_comments_updated before update on public.feed_comments
  for each row execute function public.update_updated_at_column();

-- Posts: everyone signed in can read active posts; authors manage their own;
-- admins can moderate any post.
drop policy if exists "Read feed posts" on public.feed_posts;
create policy "Read feed posts" on public.feed_posts for select to authenticated
  using (status = 'active' or author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Create own feed posts" on public.feed_posts;
create policy "Create own feed posts" on public.feed_posts for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "Manage own feed posts" on public.feed_posts;
create policy "Manage own feed posts" on public.feed_posts for update to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Delete own feed posts" on public.feed_posts;
create policy "Delete own feed posts" on public.feed_posts for delete to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Comments: readable with the post; authors edit/delete their own; admins moderate.
drop policy if exists "Read feed comments" on public.feed_comments;
create policy "Read feed comments" on public.feed_comments for select to authenticated
  using (status = 'active' or author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Create own feed comments" on public.feed_comments;
create policy "Create own feed comments" on public.feed_comments for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "Manage own feed comments" on public.feed_comments;
create policy "Manage own feed comments" on public.feed_comments for update to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists "Delete own feed comments" on public.feed_comments;
create policy "Delete own feed comments" on public.feed_comments for delete to authenticated
  using (author_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Reactions: readable by all signed-in members; each member owns their own row.
drop policy if exists "Read post reactions" on public.feed_reactions;
create policy "Read post reactions" on public.feed_reactions for select to authenticated using (true);
drop policy if exists "Manage own post reactions" on public.feed_reactions;
create policy "Manage own post reactions" on public.feed_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Read comment reactions" on public.feed_comment_reactions;
create policy "Read comment reactions" on public.feed_comment_reactions for select to authenticated using (true);
drop policy if exists "Manage own comment reactions" on public.feed_comment_reactions;
create policy "Manage own comment reactions" on public.feed_comment_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live feed updates across users and admins.
do $$ begin alter publication supabase_realtime add table public.feed_posts; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_comments; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_reactions; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feed_comment_reactions; exception when others then null; end $$;
