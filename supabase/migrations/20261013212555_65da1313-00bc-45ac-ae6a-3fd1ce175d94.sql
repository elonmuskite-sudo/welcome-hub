create table if not exists public.payment_settings (
  id int primary key default 1 check (id = 1),
  wallet_address text not null,
  qr_image_url text,
  network text not null default 'BEP20',
  updated_at timestamptz not null default now()
);
grant select on public.payment_settings to authenticated;
grant insert, update on public.payment_settings to authenticated;
grant all on public.payment_settings to service_role;
alter table public.payment_settings enable row level security;
create policy "Signed-in read wallet" on public.payment_settings for select to authenticated using (true);
create policy "Admins insert wallet" on public.payment_settings for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "Admins update wallet" on public.payment_settings for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

alter table public.storage_purchases add column if not exists tx_reference text;
alter table public.storage_purchases add column if not exists reviewed_by uuid;
alter table public.storage_purchases add column if not exists reviewed_at timestamptz;

create or replace function public.submit_usdt_payment(_tier text, _tx_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bytes bigint; v_cents int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from public.payment_settings where id=1) then raise exception 'Payments are not set up yet'; end if;
  case _tier
    when 'plus_50' then v_bytes := 50::bigint*1073741824; v_cents := 199;
    when 'plus_200' then v_bytes := 200::bigint*1073741824; v_cents := 499;
    when 'plus_1000' then v_bytes := 1000::bigint*1073741824; v_cents := 1499;
    else raise exception 'Unknown plan';
  end case;
  if (select count(*) from public.storage_purchases where user_id=auth.uid() and status='awaiting_approval') >= 3 then
    raise exception 'You already have payments waiting for approval';
  end if;
  insert into public.storage_purchases(user_id,tier,added_bytes,amount_cents,currency,status,tx_reference)
  values (auth.uid(),_tier,v_bytes,v_cents,'usdt','awaiting_approval',nullif(left(trim(coalesce(_tx_reference,'')),120),''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.submit_usdt_payment(text,text) from public, anon;
grant execute on function public.submit_usdt_payment(text,text) to authenticated;

create or replace function public.review_usdt_payment(_purchase_id uuid, _approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p public.storage_purchases;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admins only'; end if;
  select * into p from public.storage_purchases where id=_purchase_id for update;
  if p.id is null or p.status <> 'awaiting_approval' then raise exception 'Payment is not waiting for approval'; end if;
  update public.storage_purchases set status = case when _approve then 'completed' else 'rejected' end,
    reviewed_by=auth.uid(), reviewed_at=now() where id=_purchase_id;
  if _approve then
    insert into public.user_storage_quotas(user_id, quota_bytes) values (p.user_id, 5368709120 + p.added_bytes)
    on conflict (user_id) do update set quota_bytes = public.user_storage_quotas.quota_bytes + p.added_bytes;
  end if;
end $$;
revoke execute on function public.review_usdt_payment(uuid,boolean) from public, anon;
grant execute on function public.review_usdt_payment(uuid,boolean) to authenticated;

create or replace function public.admin_exists() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where role='admin') $$;
revoke execute on function public.admin_exists() from public, anon;
grant execute on function public.admin_exists() to authenticated;

drop function if exists public.claim_first_admin();
create function public.claim_first_admin() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
  perform pg_advisory_xact_lock(424242);
  if exists(select 1 from public.user_roles where role='admin') then raise exception 'An admin already exists'; end if;
  insert into public.user_roles(user_id, role) values (auth.uid(),'admin');
end $$;
revoke execute on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;

-- one pending/approved ID check per user max
create policy "Signed-in read QR" on storage.objects for select to authenticated using (bucket_id='payment-qr');
create policy "Admins upload QR" on storage.objects for insert to authenticated with check (bucket_id='payment-qr' and public.has_role(auth.uid(),'admin'));
create policy "Admins change QR" on storage.objects for update to authenticated using (bucket_id='payment-qr' and public.has_role(auth.uid(),'admin'));

drop policy if exists "Own ID docs upload" on storage.objects;
drop policy if exists "Own ID docs read or admin" on storage.objects;
create policy "Own ID docs upload" on storage.objects for insert to authenticated with check (bucket_id='identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Own ID docs read or admin" on storage.objects for select to authenticated using (bucket_id='identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));

do $$ begin
  alter publication supabase_realtime add table public.storage_purchases;
exception when others then null; end $$;