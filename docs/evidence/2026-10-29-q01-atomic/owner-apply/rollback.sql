-- Q01 atomic quest progress: rollback. WRITES. Run only if the owner decides to undo this release,
-- and roll the application back to a build that still calls apply_sale_staff_effects after payment
-- (otherwise /kasir progress stops being recorded again).
-- Restores apply_sale_staff_effects byte-for-byte (rebuilt from the internal function by reversing the
-- exact rewrite of the migration) and removes the trigger and the two new functions.
-- Staff effects already recorded at payment are kept: they are ordinary sale_staff_effects rows and a
-- void still reverses them through cancel_posted_sale -> reverse_sale_staff_effects.
begin;

do $restore$
declare
  internal_fn regprocedure := to_regprocedure('public.sale_staff_effects_apply(uuid)');
  definition text;
  old_header text := 'CREATE OR REPLACE FUNCTION public.apply_sale_staff_effects(p_sale_id uuid)';
  new_header text := 'CREATE OR REPLACE FUNCTION public.sale_staff_effects_apply(p_sale_id uuid)';
  old_access text := E' if not found or auth.uid() is null or auth.role() is distinct from ''authenticated'' or s.cashier_id is distinct from auth.uid() then raise exception ''Penjualan tidak dapat diakses'' using errcode=''42501'';end if;\n'
    || E' perform public.pos_sale_assert_actor(s);\n';
  new_access text := E' if not found then raise exception ''Penjualan tidak ditemukan'';end if;\n';
begin
  if internal_fn is null then
    raise notice 'Q01 atomic not applied; nothing to restore';
    return;
  end if;
  definition := pg_get_functiondef(internal_fn);
  if (length(definition) - length(replace(definition, new_header, ''))) / length(new_header) <> 1
     or (length(definition) - length(replace(definition, new_access, ''))) / length(new_access) <> 1 then
    raise exception 'Q01_ATOMIC_ROLLBACK_DRIFT: sale_staff_effects_apply changed after apply; restore by hand';
  end if;
  execute replace(replace(definition, new_header, old_header), new_access, old_access);
end
$restore$;
revoke all on function public.apply_sale_staff_effects(uuid) from public, anon, service_role;
grant execute on function public.apply_sale_staff_effects(uuid) to authenticated;

drop trigger if exists q01_staff_effects on public.sales;
drop function if exists public.apply_sale_staff_effects_on_finalize();
drop function if exists public.sale_staff_effects_apply(uuid);

commit;
