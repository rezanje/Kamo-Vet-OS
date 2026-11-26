-- Fee merchant POS -> 740018 Beban Admin EDC (permintaan Anisa, 25 Nov 2026).
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
-- Hanya posting BARU yang berubah. Jurnal lama TIDAK disentuh.
--
-- LATAR
--  Fee merchant yang dibebankan ke pelanggan (kartu debit/kredit/QRIS berbiaya) selama ini dikreditkan ke
--  810004 Pendapatan Diluar Operasional Lain. Finance ingin fee itu langsung mengurangi 740018 Beban Admin EDC,
--  tempat potongan MDR bank dicatat, supaya biaya EDC bersih terbaca di satu akun.
--
-- RANCANGAN
--  1. pos_sale_record_payments: baris fee pada jurnal penjualan = Cr 740018 (dulu Cr 810004). Pemeriksaan akun
--     di awal diganti: 740018 harus akun rincian aktif bertipe BEBAN.
--  2. pos_sale_post_refund / pos_sale_post_refund_selected: fee sumber dibaca dari 740018 ATAU 810004, dan
--     bagian fee yang direfund didebit ke akun yang SAMA dengan jurnal sumbernya (struk lama tetap 810004,
--     struk baru 740018) — refund struk lama tidak menggeser saldo ke akun lain.
--  3. 740018 masuk daftar akun sistem (coa_import_system_codes) supaya tidak dinonaktifkan/diubah lewat impor.
--     Daftar yang sama ada di src/lib/coa-sistem.ts (KODE_SISTEM), dikunci tes impor-akun.
--
-- DAMPAK
--  - Laba Rugi: fee merchant baru mengurangi Beban Admin EDC, tidak lagi menambah Pendapatan Lain-lain.
--  - 29 struk ber-fee 1–25 Nov 2026 (total Rp 43.740) tetap di 810004; reklas, bila diinginkan, lewat jurnal
--    manual Finance (Dr 810004 / Cr 740018).
--
-- ROLLBACK (tidak ada data yang harus dipulihkan)
--  - Terapkan migrasi baru yang menukar old_text/new_text bagian 2; coa_import_system_codes boleh dibiarkan.

-- ---------------------------------------------------------------------------
-- 1. Pemeriksaan awal — gagal tertutup bila kontrak sumber berubah
-- ---------------------------------------------------------------------------
do $$ begin
 if to_regprocedure('public.pos_sale_record_payments()') is null
  or to_regprocedure('public.pos_sale_post_refund(public.sales,uuid,text,date,numeric)') is null
  or to_regprocedure('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)') is null
  or to_regprocedure('public.coa_import_system_codes()') is null
 then raise exception 'FEE_EDC_SOURCE_CHANGED: tinjau ulang kontrak posting fee merchant';end if;
 if not exists(select 1 from public.coa_accounts where code='740018' and is_active and not is_header and type='BEBAN') then
  raise exception 'FEE_EDC_AKUN_740018: akun Beban Admin EDC (740018) belum ada sebagai akun rincian BEBAN aktif';end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tambalan jangkar eksak pada definisi yang sedang berjalan
--    (tiap jangkar harus muncul tepat sebanyak yang diharapkan; satu fungsi dikompilasi sekali)
-- ---------------------------------------------------------------------------
do $patch$
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text; found_count integer;
begin
 for p in select * from (values
  -- 2a. Penjualan: pemeriksaan akun fee.
  ('public.pos_sale_record_payments()', 1,
   E'perform 1 from public.coa_accounts where code=''810004'' and is_active and not is_header and type=''PENDAPATAN'' and normal_balance=''K'' for share;\n  if not found then raise exception ''Akun fee merchant 810004 tidak tersedia atau bukan pendapatan detail aktif bersaldo kredit.'';end if;',
   E'perform 1 from public.coa_accounts where code=''740018'' and is_active and not is_header and type=''BEBAN'' for share;\n  if not found then raise exception ''Akun fee merchant 740018 Beban Admin EDC tidak tersedia atau bukan akun beban detail aktif.'';end if;'),
  -- 2b. Penjualan: baris fee -> Cr 740018.
  ('public.pos_sale_record_payments()', 1,
   E'jsonb_build_object(''code'',''810004'',''debit'',0,''credit'',new.merchant_fee_total)',
   E'jsonb_build_object(''code'',''740018'',''debit'',0,''credit'',new.merchant_fee_total)'),
  -- 2c. Refund penuh: baca fee sumber dari kedua akun; balik ke akun sumbernya.
  ('public.pos_sale_post_refund(public.sales,uuid,text,date,numeric)', 1,
   E'coalesce(sum(credit-debit) filter(where code=''810004''),0)',
   E'coalesce(sum(credit-debit) filter(where code in(''810004'',''740018'')),0)'),
  ('public.pos_sale_post_refund(public.sales,uuid,text,date,numeric)', 1,
   E'jsonb_build_object(''code'',''810004'',''debit'',fee,''credit'',0)',
   E'jsonb_build_object(''code'',case when exists(select 1 from jsonb_to_recordset(source_lines) as fx(code text) where fx.code=''740018'') then ''740018'' else ''810004'' end,''debit'',fee,''credit'',0)'),
  -- 2d. Refund sebagian: sama.
  ('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)', 1,
   E'coalesce(sum(credit-debit) filter(where code=''810004''),0)',
   E'coalesce(sum(credit-debit) filter(where code in(''810004'',''740018'')),0)'),
  ('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)', 1,
   E'jsonb_build_object(''code'',''810004'',''debit'',fee,''credit'',0)',
   E'jsonb_build_object(''code'',case when exists(select 1 from jsonb_to_recordset(source_lines) as fx(code text) where fx.code=''740018'') then ''740018'' else ''810004'' end,''debit'',fee,''credit'',0)')
 ) as patches(sig, expected, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'FEE_EDC: fungsi wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  found_count := (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text);
  if found_count <> p.expected then
   raise exception 'FEE_EDC: jangkar harus muncul % kali (ditemukan %) di %: %', p.expected, found_count, p.sig, left(p.old_text, 90);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
 -- Tidak boleh ada sisa 810004 untuk fee di jurnal penjualan baru.
 if position('''810004''' in pg_get_functiondef('public.pos_sale_record_payments()'::regprocedure))>0 then
  raise exception 'FEE_EDC: pos_sale_record_payments masih memuat 810004';end if;
end $patch$;

-- ---------------------------------------------------------------------------
-- 3. Akun sistem: 740018 dipakai keras oleh posting penjualan.
--    HARUS sama dengan KODE_SISTEM di src/lib/coa-sistem.ts (dikunci tes impor-akun).
-- ---------------------------------------------------------------------------
create or replace function public.coa_import_system_codes() returns text[]
language sql immutable set search_path = '' as $$
  select array['110003','120002','182004','150001','130009','182001','170001','160001','200008','200015','311001','311003','314001','312005',
    '410001','420001','510001','520002','510002','810001','810003','810004','600001','710001','720002','740001','740003','740007','740020',
    '760003','740010','750004','820004','760002','720010','740018']::text[]
$$;
revoke all on function public.coa_import_system_codes() from public, anon, authenticated, service_role;
