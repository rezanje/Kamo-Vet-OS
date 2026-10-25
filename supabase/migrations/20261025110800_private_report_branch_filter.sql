-- R05: align private report URL validation with the existing branch filter.
-- A preset is a private URL only; it never grants access to report rows.
do $$
declare guard_oid oid := to_regprocedure('public.guard_private_report_preset()');
begin
 if guard_oid is null or not exists (
  select 1 from pg_proc p
  where p.oid=guard_oid
   and not p.prosecdef
   and p.proconfig @> array['search_path=""']::text[]
   and md5(p.prosrc)='84e128692f8cb7da9e3dc0b72396a19a'
 ) or not exists (
  select 1 from pg_trigger t
  where t.tgrelid='public.private_report_presets'::regclass
   and t.tgname='private_report_preset_guard'
   and t.tgfoid=guard_oid and not t.tgisinternal
 ) or has_function_privilege('anon',guard_oid,'EXECUTE')
   or has_function_privilege('authenticated',guard_oid,'EXECUTE')
   or has_function_privilege('service_role',guard_oid,'EXECUTE') then
  raise exception 'R05_PRIVATE_PRESET_GUARD_DRIFT';
 end if;
end $$;

create or replace function public.guard_private_report_preset() returns trigger
language plpgsql security invoker set search_path='' as $$
declare part text;
begin
 if auth.role()='authenticated' and new.user_id is distinct from auth.uid() then
  raise exception using errcode='42501',message='PRIVATE_PRESET_DENIED: konfigurasi hanya untuk akun sendiri';
 end if;
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id) then
  raise exception using errcode='42501',message='PRIVATE_PRESET_DENIED: pemilik dan identitas konfigurasi tidak dapat diganti';
 end if;
 if new.href !~ '^/laporan/(absensi|nilai-persediaan|gaji|rekap-klinik|transaksi-cabang|jadwal-anabul|margin-racikan|akuisisi|operasional-penjualan|pelanggan-harian|penjual|penjualan-barang|member|penjualan-rinci|pelanggan-teratas|retensi|penjualan-kasir|anamnesa|pembelian|kpi|promo)([?][^#[:space:]]*)?$' then
  raise exception using errcode='23514',message='PRIVATE_PRESET_INVALID: tujuan laporan tidak didukung';
 end if;
 foreach part in array string_to_array(split_part(new.href,'?',2),'&') loop
  if part<>'' and part !~ '^(dari|sampai|periode|cabang|cabang_id|gudang|dokter|q|masalah|rincian|kanal|jenis|horizon|preset|from|to|channel|branch|ambang|cari|kolom)=[^&]*$' then
   raise exception using errcode='23514',message='PRIVATE_PRESET_INVALID: parameter laporan tidak didukung';
  end if;
 end loop;
 -- Serialize only this account's preference quota; never replace a full list.
 perform pg_advisory_xact_lock(hashtextextended('private-report-presets:'||new.user_id::text,0));
 if tg_op='INSERT' and not exists(select 1 from public.private_report_presets p where p.id=new.id and p.user_id=new.user_id)
  and (select count(*) from public.private_report_presets p where p.user_id=new.user_id)>=50 then
  raise exception using errcode='23514',message='PRIVATE_PRESET_LIMIT: maksimal 50 konfigurasi per akun';
 end if;
 new.name:=btrim(new.name);new.saved_at:=now();
 return new;
end $$;
