alter table public.kyc_sessions
  add column if not exists current_step smallint not null default 1,
  add column if not exists ocr_data jsonb,
  add column if not exists liveness_results jsonb,
  add column if not exists cross_validation_results jsonb,
  add column if not exists rejection_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kyc_sessions'::regclass
      and conname = 'kyc_sessions_current_step_check'
  ) then
    alter table public.kyc_sessions
      add constraint kyc_sessions_current_step_check check (current_step between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kyc_sessions'::regclass
      and conname = 'kyc_sessions_ocr_data_object_check'
  ) then
    alter table public.kyc_sessions
      add constraint kyc_sessions_ocr_data_object_check
      check (ocr_data is null or jsonb_typeof(ocr_data) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kyc_sessions'::regclass
      and conname = 'kyc_sessions_liveness_results_object_check'
  ) then
    alter table public.kyc_sessions
      add constraint kyc_sessions_liveness_results_object_check
      check (liveness_results is null or jsonb_typeof(liveness_results) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kyc_sessions'::regclass
      and conname = 'kyc_sessions_cross_validation_results_object_check'
  ) then
    alter table public.kyc_sessions
      add constraint kyc_sessions_cross_validation_results_object_check
      check (cross_validation_results is null or jsonb_typeof(cross_validation_results) = 'object');
  end if;
end;
$$;

update public.kyc_sessions
   set current_step = case status
     when 'AWAITING_FRONT' then 2
     when 'AWAITING_BACK' then 3
     when 'AWAITING_LIVE' then 4
     else 5
   end,
       ocr_data = metadata -> 'ocr',
       liveness_results = metadata -> 'liveness',
       cross_validation_results = metadata -> 'cross_validation'
 where current_step = 1
    or ocr_data is null
    or liveness_results is null
    or cross_validation_results is null;