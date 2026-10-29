-- Diskon manual hanya untuk akun berwenang.
--
-- Keputusan pemilik (Andri, 29 Oktober 2026): "kasir ga boleh pasang diskon manual,
-- harus yang punya akses". Menjawab temuan audit promo 28 Okt 2026: T-2 (diskon manual
-- tanpa batas dan tanpa persetujuan), S-4 (koreksi tagihan klinik bisa dipakai menaikkan
-- diskon), dan S-6 (diskon default barang tidak diverifikasi ulang di server).
--
-- Yang DIHITUNG sebagai diskon manual:
--   * potongan per baris yang diketik petugas (rupiah atau persen) di kasir petshop;
--   * diskon per baris (persen) di tagihan klinik;
--   * diskon tingkat nota/tagihan yang diketik petugas di kasir, POS, dan klinik;
--   * "diskon default barang" bila angkanya DIUBAH dari master.
-- Yang TIDAK: promo otomatis, voucher, kode kampanye, diskon golongan pelanggan, poin,
-- dan diskon default barang yang masih persis seperti di master (ditetapkan ulang server).
--
-- Hak aksesnya menumpang sistem kemampuan peran yang sudah ada (role_capabilities +
-- has_role_capability, migrasi 20261017090000), jadi pemilik bisa mengubahnya sendiri
-- lewat layar Pengaturan -> Akses Grup. Bawaan: OWNER, ADMIN, FINANCE boleh; STAFF
-- (kasir) dan DOCTOR tidak. Daftar peran yang sama ada di src/lib/akses-diskon.ts.
--
-- Semua perubahan pada RPC yang sudah berjalan memakai jangkar eksak di atas definisi
-- berjalan (pg_get_functiondef + replace), seluruh tambalan satu fungsi ditempel ke teks
-- lalu dikompilasi SATU kali, dan gagal tertutup bila definisinya sudah berubah. Migrasi
-- lama tidak diubah. Tidak ada data transaksi yang diubah saat migrasi (pra-pemeriksaan
-- 29 Okt di Production: 33 penjualan POS, 0 di antaranya berdiskon).

-- ---------------------------------------------------------------------------
-- 1. Kemampuan peran "Diskon manual"
-- ---------------------------------------------------------------------------
-- Sengaja NULL-able: null berarti "ikut bawaan peran", jadi peran yang hak cabang/
-- akunnya sudah pernah disetel sebelum kemampuan ini ada tidak diam-diam kehilangan
-- hak diskonnya saat migrasi dijalankan.
alter table public.role_capabilities add column manual_discount boolean;
comment on column public.role_capabilities.manual_discount is
  'Boleh mengetik diskon manual di kasir/POS/klinik. null = ikut bawaan peran (OWNER/ADMIN/FINANCE boleh).';

do $patch_capability$
declare d text; anchor text;
begin
 anchor := E'   when ''create_accounts'' then coalesce(c.create_accounts,p.role=''ADMIN'')\n';
 d := pg_get_functiondef('public.has_role_capability(text)'::regprocedure);
 if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
  raise exception 'Diskon manual: jangkar has_role_capability tidak ditemukan tepat sekali';
 end if;
 execute replace(d, anchor,
   anchor || E'   when ''manual_discount'' then coalesce(c.manual_discount,p.role in (''ADMIN'',''FINANCE''))\n');
end $patch_capability$;

-- Satu nama pendek supaya RPC dan pembacanya tidak mengulang string kemampuan.
create function public.can_manual_discount() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role_capability('manual_discount')
$$;
revoke all on function public.can_manual_discount() from public, anon, service_role;
grant execute on function public.can_manual_discount() to authenticated;
comment on function public.can_manual_discount() is
  'True bila pengguna yang login boleh memberi diskon manual (kemampuan peran manual_discount).';

-- ---------------------------------------------------------------------------
-- 2. Rincian potongan disimpan terpisah dari kolom gelondongan
-- ---------------------------------------------------------------------------
-- `sales.discount` dan `invoices.discount` adalah SATU angka yang sudah mencampur
-- diskon baris, promo, voucher, diskon golongan, poin, dan diskon manual. Tanpa
-- rinciannya, database tidak bisa membedakan potongan yang sah dari potongan yang
-- diketik sendiri — jadi penyerang tinggal menaruh uangnya di kolom gelondongan.
alter table public.sales
  add column manual_discount numeric(15,2) not null default 0 check (manual_discount >= 0),
  add column voucher_discount numeric(15,2) not null default 0 check (voucher_discount >= 0),
  add column manual_discount_by uuid references public.profiles(id);
comment on column public.sales.manual_discount is 'Diskon nota yang DIKETIK petugas (rupiah). Promo/voucher/golongan/poin tidak termasuk.';
comment on column public.sales.voucher_discount is 'Potongan voucher yang dihitung server dari master.';
comment on column public.sales.manual_discount_by is 'Akun yang memberi diskon manual pada transaksi ini.';

alter table public.invoices
  add column manual_discount numeric(15,2) not null default 0 check (manual_discount >= 0),
  add column auto_discount numeric(15,2) not null default 0 check (auto_discount >= 0),
  add column manual_discount_by uuid references public.profiles(id);
comment on column public.invoices.manual_discount is 'Diskon tagihan yang DIKETIK petugas (rupiah).';
comment on column public.invoices.auto_discount is 'Promo + voucher + diskon golongan + poin, seluruhnya dihitung server dari master.';
comment on column public.invoices.manual_discount_by is 'Akun yang memberi diskon manual pada tagihan ini.';

-- ---------------------------------------------------------------------------
-- 3. Penjaga kasir petshop & POS back-office
-- ---------------------------------------------------------------------------
-- Dipanggil finalize_pos_sale, yang juga dipakai cashier_post_stock_atomic. Struk
-- yang belum difinalkan tidak punya jurnal, stok, maupun pembayaran — jadi inilah
-- gerbang uangnya, termasuk untuk pemanggilan REST langsung dari browser.
create function public.assert_manual_discount_sale(p_sale_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_sale public.sales%rowtype; v_lines numeric; v_bad text;
begin
 select * into v_sale from public.sales where id = p_sale_id;
 if not found then return; end if;
 -- Jejak pemberi diskon tidak boleh menunjuk orang lain.
 if v_sale.manual_discount_by is not null and v_sale.manual_discount_by is distinct from v_sale.cashier_id then
  raise exception 'Pemberi diskon manual harus akun kasir transaksi ini' using errcode = '42501';
 end if;
 if public.can_manual_discount() then return; end if;

 if coalesce(v_sale.manual_discount, 0) > 0 then
  raise exception 'Diskon manual hanya untuk akun berwenang' using errcode = '42501';
 end if;

 -- Diskon per baris hanya boleh persis diskon default barang di master (temuan S-6).
 -- Baris ketikan bebas (tanpa item_id) bawaannya nol.
 select string_agg(distinct si.nama, ', ') into v_bad
 from public.sale_items si left join public.items i on i.id = si.item_id
 where si.sale_id = p_sale_id
   and case when coalesce(i.default_discount, 0) = 0
     then coalesce(si.item_discount_value, 0) <> 0
     else not (si.item_discount_type = 'percent'
       and coalesce(si.item_discount_value, 0) = coalesce(i.default_discount, 0)) end;
 if v_bad is not null then
  raise exception 'Diskon manual hanya untuk akun berwenang (baris: %)', v_bad using errcode = '42501';
 end if;

 -- Kolom `discount` yang gelondongan tidak boleh melebihi yang bisa dijelaskan
 -- rinciannya. Rumusnya cermin lib/pos-calc: diskon manual baris menang atas promo,
 -- dan tiap potongan dibatasi nilai barisnya sendiri. Toleransi Rp1 untuk pembulatan.
 select coalesce(sum(least(greatest(case
     when (case when si.item_discount_type = 'percent'
       then round(si.qty * si.harga * coalesce(si.item_discount_value, 0) / 100)
       else coalesce(si.item_discount_value, 0) end) > 0
     then (case when si.item_discount_type = 'percent'
       then round(si.qty * si.harga * coalesce(si.item_discount_value, 0) / 100)
       else coalesce(si.item_discount_value, 0) end)
     else greatest(coalesce(si.promo_discount, 0), 0) end, 0), si.qty * si.harga)), 0)
  into v_lines from public.sale_items si where si.sale_id = p_sale_id;
 if round(v_sale.discount, 2) > round(v_lines + coalesce(v_sale.voucher_discount, 0)
     + coalesce(v_sale.poin_digunakan, 0), 2) + 1 then
  raise exception 'Potongan nota tidak cocok dengan rinciannya. Diskon manual hanya untuk akun berwenang'
   using errcode = '42501';
 end if;
end $$;
revoke all on function public.assert_manual_discount_sale(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Penjaga tagihan klinik (penerbitan baru dan koreksi)
-- ---------------------------------------------------------------------------
create function public.assert_manual_discount_clinic(p_invoice jsonb, p_lines jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
 if public.can_manual_discount() then return; end if;
 if coalesce((p_invoice ->> 'manual_discount')::numeric, 0) > 0 then
  raise exception 'Diskon manual hanya untuk akun berwenang' using errcode = '42501';
 end if;
 if exists (select 1 from jsonb_array_elements(p_lines) x
   where coalesce((x.value ->> 'discount_percent')::numeric, 0) > 0) then
  raise exception 'Diskon manual hanya untuk akun berwenang (diskon per baris)' using errcode = '42501';
 end if;
 -- Potongan tagihan tidak boleh melebihi promo + voucher + diskon golongan + poin
 -- yang dihitung server. Toleransi Rp1 untuk pembulatan.
 if coalesce((p_invoice ->> 'discount')::numeric, 0)
    > coalesce((p_invoice ->> 'auto_discount')::numeric, 0) + 1 then
  raise exception 'Potongan tagihan tidak cocok dengan rinciannya. Diskon manual hanya untuk akun berwenang'
   using errcode = '42501';
 end if;
end $$;
revoke all on function public.assert_manual_discount_clinic(jsonb, jsonb) from public, anon, authenticated, service_role;

-- Koreksi tagihan (temuan S-4): promo TIDAK dihitung ulang saat koreksi, jadi potongan
-- lama ikut terbawa ke kolom diskon. Memaksa nol akan menolak koreksi yang sah; yang
-- dilarang adalah MENAIKKAN potongan — baik di kepala nota maupun di baris.
create function public.assert_manual_discount_clinic_edit(p_invoice_id uuid, p_invoice jsonb, p_lines jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_old numeric;
begin
 if public.can_manual_discount() then return; end if;
 select discount into v_old from public.invoices where id = p_invoice_id;
 if coalesce((p_invoice ->> 'discount')::numeric, 0) > coalesce(v_old, 0) + 1 then
  raise exception 'Diskon manual hanya untuk akun berwenang: koreksi tidak boleh menaikkan potongan'
   using errcode = '42501';
 end if;
 if exists (
   select 1 from jsonb_array_elements(p_lines) x
   left join public.invoice_items ii
     on ii.id = nullif(x.value ->> 'source_invoice_item_id', '')::uuid and ii.invoice_id = p_invoice_id
   where coalesce((x.value ->> 'discount_percent')::numeric, 0) > coalesce(ii.diskon_persen, 0)
 ) then
  raise exception 'Diskon manual hanya untuk akun berwenang: koreksi tidak boleh menaikkan diskon baris'
   using errcode = '42501';
 end if;
end $$;
revoke all on function public.assert_manual_discount_clinic_edit(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Tambalan jangkar eksak pada RPC yang sudah berjalan
-- ---------------------------------------------------------------------------
do $patch$
declare p record; signature regprocedure; definition text; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- (a) Kasir petshop & POS back-office. cashier_post_stock_atomic memanggil RPC ini,
  --     jadi satu tambalan menutup kedua jalur sebelum jurnal dan poin tertulis.
  ('public.finalize_pos_sale(uuid)',
   E' perform public.pos_sale_assert_actor(sale);',
   E' perform public.pos_sale_assert_actor(sale);\n perform public.assert_manual_discount_sale(sale.id);'),
  -- (b) Tagihan klinik baru. clinic_post_split_invoice dan clinic_post_demo_invoice
  --     keduanya menerus ke RPC ini, jadi ikut terpagari.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  v_salesperson_id := nullif(p_invoice ->> ''salesperson_id'', '''')::uuid;',
   E'  v_salesperson_id := nullif(p_invoice ->> ''salesperson_id'', '''')::uuid;\n  perform public.assert_manual_discount_clinic(p_invoice, p_lines);'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code\n  ) values (',
   E'    paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code,\n    manual_discount, auto_discount, manual_discount_by\n  ) values ('),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint, nullif(p_invoice->>''campaign_code'','''')\n  ) returning id into v_invoice_id;',
   E'    v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint, nullif(p_invoice->>''campaign_code'',''''),\n    coalesce((p_invoice->>''manual_discount'')::numeric,0), coalesce((p_invoice->>''auto_discount'')::numeric,0),\n    case when coalesce((p_invoice->>''manual_discount'')::numeric,0) > 0 then v_user_id else null end\n  ) returning id into v_invoice_id;'),
  -- (c) Koreksi tagihan klinik (temuan S-4).
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'    raise exception using errcode=''P0001'', message=''INVOICE_INVALID: subtotal berbeda dari rincian'';\n  end if;',
   E'    raise exception using errcode=''P0001'', message=''INVOICE_INVALID: subtotal berbeda dari rincian'';\n  end if;\n  perform public.assert_manual_discount_clinic_edit(p_invoice_id,p_invoice,p_lines);')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Diskon manual: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending ->> p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Diskon manual: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending ->> k;
 end loop;
end $patch$;

-- ACL tidak berubah oleh create or replace, tetapi ditegaskan ulang.
revoke all on function public.finalize_pos_sale(uuid) from public, anon;
grant execute on function public.finalize_pos_sale(uuid) to authenticated;
revoke all on function public.clinic_post_invoice(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.clinic_post_invoice(uuid,text,jsonb,jsonb) to authenticated;
revoke all on function public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- 6. Pemeriksaan akhir — gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
 if to_regprocedure('public.can_manual_discount()') is null then
  raise exception 'Pemeriksa hak diskon manual tidak terpasang'; end if;
 d := pg_get_functiondef('public.has_role_capability(text)'::regprocedure);
 if position('when ''manual_discount'' then coalesce(c.manual_discount' in d) = 0 then
  raise exception 'Kemampuan manual_discount belum dikenali has_role_capability'; end if;
 d := pg_get_functiondef('public.finalize_pos_sale(uuid)'::regprocedure);
 if position('assert_manual_discount_sale(sale.id)' in d) = 0 then
  raise exception 'Finalisasi POS belum memeriksa diskon manual'; end if;
 d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
 if position('assert_manual_discount_clinic(p_invoice, p_lines)' in d) = 0
  or position('manual_discount, auto_discount, manual_discount_by' in d) = 0 then
  raise exception 'Penerbitan tagihan klinik belum memeriksa diskon manual'; end if;
 d := pg_get_functiondef('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure);
 if position('assert_manual_discount_clinic_edit(p_invoice_id,p_invoice,p_lines)' in d) = 0 then
  raise exception 'Koreksi tagihan klinik belum memeriksa diskon manual'; end if;
 -- Faktur penjualan grosir sudah terkunci OWNER/FINANCE lewat wholesale_access(...,true);
 -- tidak ada tambalan di sini, hanya dipastikan penjaganya masih ada.
 if position('Koreksi grosir hanya oleh OWNER/FINANCE' in
   pg_get_functiondef('public.wholesale_access(uuid,boolean)'::regprocedure)) = 0 then
  raise exception 'Penjaga koreksi faktur grosir tidak lagi membatasi OWNER/FINANCE'; end if;
end $check$;
