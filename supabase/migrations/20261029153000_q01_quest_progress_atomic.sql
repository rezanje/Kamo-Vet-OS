-- Q01 follow-up (audit 29 Oct 2026): staff quest progress is applied inside the payment finalizer.
--
-- Before: the new-customer claim was written by a trigger inside the finalizer transaction, but
-- quest progress (all quest kinds, streak, points) was a separate RPC call made by /kasir after the
-- payment had committed. A failed call was only logged, so the claim stayed locked while progress
-- never moved, and /pos/transaksi (back-office POS) never made the call at all.
--
-- After: an AFTER UPDATE OF payments_finalized_at trigger applies the staff effects for the same
-- sale in the same transaction, right after q01_claim_new_customer (PostgreSQL fires triggers of
-- one event in name order: q01_claim_new_customer < q01_staff_effects). Claim, progress, points,
-- money and stock therefore commit together or not at all, for every POS entry point that
-- finalizes through finalize_pos_sale / cashier_post_stock_atomic (/kasir and /pos/transaksi).
-- If the staff effects cannot be recorded, the payment does not finalize (fail-closed) instead of
-- silently losing progress. Eligibility is unchanged: the claim rules (Rp0, imported cards, same
-- phone, earlier receipts/invoices) stay in quest_claim_new_customer, and the effect rules stay in
-- the existing effect function body, which is carried over verbatim.
--
-- Shape: the existing body of apply_sale_staff_effects (including the Q01 new_customer patch) is
-- moved, by an anchored and counted rewrite that fails on drift, into the internal function
-- sale_staff_effects_apply(uuid) without the caller checks (the finalizer has already asserted the
-- cashier). apply_sale_staff_effects(uuid) stays as the same client RPC (same checks, same ACL) and
-- delegates to it, so an older app build that still calls it after payment gets the idempotent
-- {"applied": true}. Void is unchanged: cancel_posted_sale -> reverse_sale_staff_effects removes
-- progress/points/streak, and q01_release_new_customer releases the claim.
--
-- Future patches of quest-effect logic target public.sale_staff_effects_apply(uuid).

do $move$
declare
  public_fn regprocedure := 'public.apply_sale_staff_effects(uuid)'::regprocedure;
  definition text := pg_get_functiondef(public_fn);
  old_header text := 'CREATE OR REPLACE FUNCTION public.apply_sale_staff_effects(p_sale_id uuid)';
  new_header text := 'CREATE OR REPLACE FUNCTION public.sale_staff_effects_apply(p_sale_id uuid)';
  old_access text := E' if not found or auth.uid() is null or auth.role() is distinct from ''authenticated'' or s.cashier_id is distinct from auth.uid() then raise exception ''Penjualan tidak dapat diakses'' using errcode=''42501'';end if;\n'
    || E' perform public.pos_sale_assert_actor(s);\n';
  new_access text := E' if not found then raise exception ''Penjualan tidak ditemukan'';end if;\n';
  internal text;
begin
  if to_regprocedure('public.sale_staff_effects_apply(uuid)') is not null then
    if position('public.sale_staff_effects_apply(' in definition) = 0 then
      raise exception 'Q01_ATOMIC_DRIFT: sale_staff_effects_apply exists but apply_sale_staff_effects does not delegate to it';
    end if;
    return;                                        -- already applied (idempotent re-run)
  end if;
  if position('quest_new_customer_claims' in definition) = 0 then
    raise exception 'Q01_ATOMIC_DRIFT: apply 20261028180000_q01_new_customer_quest.sql first';
  end if;
  if (length(definition) - length(replace(definition, old_header, ''))) / length(old_header) <> 1
     or (length(definition) - length(replace(definition, old_access, ''))) / length(old_access) <> 1
     or position('auth.' in replace(definition, old_access, '')) > 0 then
    raise exception 'Q01_ATOMIC_DRIFT: apply_sale_staff_effects changed; review before release';
  end if;
  internal := replace(replace(definition, old_header, new_header), old_access, new_access);
  execute internal;
end
$move$;
revoke all on function public.sale_staff_effects_apply(uuid) from public, anon, authenticated, service_role;
comment on function public.sale_staff_effects_apply(uuid) is
  'Q01: staff quest/streak/points effects of one finalized POS sale. Internal: called by the finalizer trigger and by apply_sale_staff_effects. Idempotent per sale (sale_staff_effects row).';

-- Same client RPC, same caller checks and ACL; the effects themselves now live in one place.
create or replace function public.apply_sale_staff_effects(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;
begin
 -- Effects (incl. new-customer quests reading public.quest_new_customer_claims) are applied by
 -- public.sale_staff_effects_apply, normally already inside the payment finalizer. Naming the
 -- claim table here also keeps the re-run guard of 20261028180000 a no-op.
 select * into s from public.sales where id=p_sale_id for update;
 if not found or auth.uid() is null or auth.role() is distinct from 'authenticated' or s.cashier_id is distinct from auth.uid() then raise exception 'Penjualan tidak dapat diakses' using errcode='42501';end if;
 perform public.pos_sale_assert_actor(s);
 return public.sale_staff_effects_apply(s.id);
end $$;
revoke all on function public.apply_sale_staff_effects(uuid) from public, anon, service_role;
grant execute on function public.apply_sale_staff_effects(uuid) to authenticated;

create or replace function public.apply_sale_staff_effects_on_finalize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.payments_finalized_at is null and new.payments_finalized_at is not null
     and new.channel is null and new.quest_effects_tracked
     and new.cashier_id is not null and new.voided_at is null then
    perform public.sale_staff_effects_apply(new.id);
  end if;
  return null;
end $$;
revoke all on function public.apply_sale_staff_effects_on_finalize() from public, anon, authenticated, service_role;
drop trigger if exists q01_staff_effects on public.sales;
create trigger q01_staff_effects after update of payments_finalized_at on public.sales
  for each row execute function public.apply_sale_staff_effects_on_finalize();

do $order$
begin
  -- The claim must be written before progress reads it; both are AFTER triggers of one event.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'q01_claim_new_customer')
     or not ('q01_claim_new_customer'::name < 'q01_staff_effects'::name) then
    raise exception 'Q01_ATOMIC_DRIFT: claim trigger missing or would fire after the staff effects trigger';
  end if;
end
$order$;
