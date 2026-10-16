ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}';
GRANT UPDATE (bio,interests) ON public.profiles TO authenticated;
CREATE VIEW public.members WITH (security_invoker=true) AS SELECT id,nexus_id AS member_id,first_name,last_name,full_name,avatar_url,bio,interests,created_at FROM public.profiles;
GRANT SELECT ON public.members TO authenticated;
GRANT UPDATE (first_name,last_name,full_name,avatar_url,bio,interests) ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;