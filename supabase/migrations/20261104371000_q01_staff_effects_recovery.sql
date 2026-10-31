-- Q01 lanjutan: quest progress that failed after payment can be re-applied safely.
--
-- Problem: the new-customer claim is written inside the payment finalizer, but quest progress is
-- written later by a separate apply_sale_staff_effects call whose error is only logged. A lost
-- call left the claim locked with no progress and nothing ever retried it.
--
-- Design (smallest change, no new state):
--   * apply_sale_staff_effects was already idempotent per sale (sale_staff_effects row), so a
--     retry can never double count; what was missing is (a) a retry and (b) retry correctness;
--   * (b) quest period, the new-customer period test and the streak day now come from the sale's
--     payment time (WIB) instead of the time of the call. For the normal call, seconds after
--     payment, this is the same day; for a late retry the progress lands in the period the sale
--     belongs to, and a retry of an older day never rewinds the streak;
--   * (a) apply_pending_sale_staff_effects() re-applies the caller's own paid, non-void, tracked
--     receipts (recent, still-open shift or back-office) that have no effect row yet, oldest first,
--     each in its own subtransaction. Checkouts call it after every paid sale (/kasir and
--     /pos/transaksi), so a failed call is repaired by the cashier's next checkout.
-- Grants, SECURITY DEFINER, search_path and the reversal contract are unchanged.

do $patch$
declare
  signature regprocedure := 'public.apply_sale_staff_effects(uuid)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  day_old text := E' if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then return jsonb_build_object(''applied'',true);end if;';
  day_new text := day_old
    || E'\n -- Q01 recovery: the period is the sale''s payment day (WIB), not the day of the (re)try.\n'
    || E' d:=(s.payments_finalized_at at time zone ''Asia/Jakarta'')::date;';
  streak_old text := ' if st.last_active_date is distinct from d then';
  streak_new text := ' if st.last_active_date is null or st.last_active_date<d then';
  count_of text;
begin
  if position('Q01 recovery' in definition) > 0 then
    return;                                        -- already applied (idempotent re-run)
  end if;
  foreach count_of in array array[day_old, streak_old] loop
    if (length(definition) - length(replace(definition, count_of, ''))) / length(count_of) <> 1 then
      raise exception 'Q01_RECOVERY_DRIFT: apply_sale_staff_effects changed; review before release';
    end if;
  end loop;
  definition := replace(definition, day_old, day_new);
  definition := replace(definition, streak_old, streak_new);
  execute definition;
end
$patch$;
-- CREATE OR REPLACE keeps the ACL; restate it so a fresh database matches exactly.
revoke all on function public.apply_sale_staff_effects(uuid) from public, anon, service_role;
grant execute on function public.apply_sale_staff_effects(uuid) to authenticated;

create index if not exists sales_staff_effects_pending_idx
  on public.sales (cashier_id, payments_finalized_at)
  where channel is null and quest_effects_tracked and voided_at is null and payments_finalized_at is not null;

create or replace function public.apply_pending_sale_staff_effects() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_applied integer := 0; v_failed integer := 0;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  for r in
    select s.id from public.sales s
    where s.cashier_id = auth.uid() and s.channel is null and s.quest_effects_tracked
      and s.voided_at is null and s.payments_finalized_at is not null
      and s.payments_finalized_at > now() - interval '7 days'
      -- apply_sale_staff_effects only accepts a sale whose shift is still open (or back-office).
      and (s.shift_id is null or exists (select 1 from public.cashier_shifts cs
                                         where cs.id = s.shift_id and cs.status = 'open'))
      and not exists (select 1 from public.sale_staff_effects e where e.sale_id = s.id)
    order by s.payments_finalized_at, s.id
    limit 50
  loop
    begin
      perform public.apply_sale_staff_effects(r.id);   -- own checks + per-sale idempotency
      v_applied := v_applied + 1;
    exception when others then
      v_failed := v_failed + 1;                        -- one bad receipt never blocks the rest
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end $$;
revoke all on function public.apply_pending_sale_staff_effects() from public, anon, authenticated, service_role;
grant execute on function public.apply_pending_sale_staff_effects() to authenticated;
comment on function public.apply_pending_sale_staff_effects() is
  'Q01: re-applies the caller''s own paid receipts whose staff quest effects are missing (idempotent per sale).';
