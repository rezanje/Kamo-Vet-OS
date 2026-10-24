-- Complete A01 capture for refund sources added after the main audit registry.
-- Keep the existing private metadata-only policy and source permissions intact.
do $$
declare source_name text;
begin
  foreach source_name in array array['sales_refund_requests', 'sales_refund_payouts'] loop
    if not exists (
      select 1 from public.activity_log_sources
      where entity = source_name and metadata_only
    ) or not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', source_name)::regclass
        and tgname = 'a01_activity_change' and tgenabled <> 'D'
    ) then
      raise exception 'Refund activity source % is not ready for delete capture', source_name;
    end if;
    if exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', source_name)::regclass
        and tgname = 'a01_activity_delete'
    ) then
      raise exception 'Refund activity delete capture already exists on %', source_name;
    end if;
    execute format(
      'create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',
      source_name
    );
  end loop;
end $$;
