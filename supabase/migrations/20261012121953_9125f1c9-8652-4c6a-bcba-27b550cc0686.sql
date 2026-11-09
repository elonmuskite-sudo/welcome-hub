revoke execute on function public.handle_new_member() from public, anon, authenticated;
revoke execute on function public.sync_member_email() from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.get_verification_badge(uuid) from public, anon;
revoke execute on function public.lookup_member_by_nexus_id(text) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.get_verification_badge(uuid) to authenticated, service_role;
grant execute on function public.lookup_member_by_nexus_id(text) to authenticated, service_role;