alter table public.feed_posts
  add column post_type text not null default 'general',
  add column title text,
  add column event_starts_at timestamptz,
  add column event_location text;

alter table public.feed_posts
  add constraint feed_posts_post_type_check
    check (post_type in ('general', 'event')),
  add constraint feed_posts_title_length_check
    check (title is null or char_length(title) <= 160),
  add constraint feed_posts_event_location_length_check
    check (event_location is null or char_length(event_location) <= 240),
  add constraint feed_posts_event_metadata_check
    check (
      (post_type = 'event' and nullif(trim(title), '') is not null and event_starts_at is not null)
      or (post_type = 'general' and event_starts_at is null and event_location is null)
    );