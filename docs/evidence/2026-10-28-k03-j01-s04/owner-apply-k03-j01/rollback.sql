-- K03 + J01 ROLLBACK — WRITES. Hanya bila diputuskan mundur; revert commit aplikasi sesudahnya.
-- K03: lepas kedua trigger dan fungsinya (data tidak diubah). J01: kembalikan wholesale_access ke versi
-- 20261021073000 apa adanya (koreksi grosir kembali OWNER saja). Koreksi yang sudah dibuat FINANCE tetap tercatat.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
drop trigger if exists zz_racikan_recipe_required on public.prescription_items;
drop trigger if exists zz_racikan_recipe_required on public.invoice_items;
drop function if exists clinic_private.k03_prescription_recipe_required();
drop function if exists clinic_private.k03_invoice_recipe_required();
drop function if exists clinic_private.is_racikan_sku(uuid);
create or replace function public.wholesale_access(p_branch uuid,p_owner boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=auth.uid() and is_active
  and (role='OWNER' or (not p_owner and role in ('ADMIN','FINANCE'))) for share;
 if not found then raise exception 'Koreksi grosir hanya oleh OWNER; penerimaan oleh OWNER/ADMIN/FINANCE aktif' using errcode='42501';end if;
 perform public.sales_assert_access(p_branch);
 if p_branch is not null then
  perform 1 from public.branches where id=p_branch and is_active for share;
  if not found then raise exception 'Cabang grosir tidak aktif' using errcode='42501';end if;
 end if;
end$$;
revoke all on function public.wholesale_access(uuid,boolean) from public,anon,authenticated,service_role;
delete from supabase_migrations.schema_migrations where version in ('20261029120000','20261029121000');
commit;
