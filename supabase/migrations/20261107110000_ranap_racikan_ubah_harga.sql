-- Rawat inap: OWNER boleh mengubah HANYA HARGA racikan tersimpan yang masih pending di keranjang kasir (F7).
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Masalah (kasus ranap VET_CMS, 5 Nov 2026): harga racikan tersimpan dikunci (COMPOUND_LOCKED), diskon tahap ranap
-- dikunci 0, komposisi racikan resmi tidak bisa diubah, sehingga ketika biaya FIFO racikan naik di atas harga
-- tersimpan (Rp50.151 vs Rp50.000) aturan P03 "jual di bawah HPP" menolak penjualan dan TIDAK ADA jalan keluar.
--
-- Perubahan (semua ditegakkan di database, bukan hanya di layar):
--  * hanya lewat clinic_save_inpatient_cashier, hanya untuk baris racikan keranjang pending yang belum pernah masuk
--    invoice, hanya kolom harga; peran WAJIB OWNER aktif (ADMIN/FINANCE/STAFF ditolak: ACCESS_DENIED);
--  * alasan wajib (minimal 5 karakter bukan-spasi, maksimal 500) per baris (field harga_reason pada baris);
--  * jumlah, barang, tautan racikan, komposisi, pelaksana tetap terkunci (COMPOUND_LOCKED seperti sebelumnya);
--  * harga >= 0 dan <= 1e12 (batas keranjang yang ada) dan paling banyak 10x harga tersimpan (bila harga tersimpan Rp0:
--    10x HPP racikan) agar salah ketik angka ditolak dengan pesan CART_INVALID; aturan P03 tetap berlaku setelahnya: harga yang masih di
--    bawah HPP tetap ditolak dan seluruh simpan dibatalkan (tidak ada harga, jejak, atau izin yang tersisa);
--  * racikan master (SKU): harga penjualan tersimpan clinic_compound_sales.sale_price ikut disamakan, karena
--    protect_master_compound_invoice menolak baris invoice yang harganya beda dari snapshot itu;
--  * trigger official_prescription_snapshot (racikan resmi) memberi pengecualian SEMPIT: hanya UPDATE kolom harga
--    pada baris pending, hanya bila RPC di atas menanam izin per-transaksi untuk baris itu (tabel privat);
--  * jejak: clinic_private.racikan_price_changes (tambah-saja: siapa/kapan/harga lama-baru/alasan) dan
--    clinic_pending_cart_edits (sebelum/sesudah keranjang, seperti perubahan keranjang lain).
--
-- MEMBACA JEJAK (belum ada layar untuk Owner; semua hak aplikasi atas tabel privat dicabut, jadi bacalah lewat SQL editor
-- sebagai role postgres). Siapa/kapan/harga lama-baru/alasan perubahan harga racikan:
-- BACA_JEJAK_MULAI
--   select c.changed_at, p.full_name as diubah_oleh, c.visit_id, c.prescription_item_id, c.old_price, c.new_price, c.reason, c.request_key
--   from clinic_private.racikan_price_changes c join public.profiles p on p.id = c.changed_by
--   order by c.changed_at desc limit 100;
-- BACA_JEJAK_SELESAI
-- Sebelum/sesudah baris keranjang kunjungan itu: select * from public.clinic_pending_cart_edits where visit_id = '<id kunjungan>' order by created_at;
-- Catatan: tabel jejak bersifat tambah-saja dan memakai kunci asing ke visits/prescription_items/compounding_recipes/profiles:
-- menghapus permanen baris-baris itu kelak akan ditolak (gagal tertutup); periksa alat purge/arsip sebelum menghapus.
--
-- Tidak ada backfill. Signature, SECURITY DEFINER, search_path, lock_timeout, pemilik dan ACL tetap. Definisi berjalan
-- ditambal dengan jangkar eksak dan gagal tertutup bila definisinya tidak seperti yang diharapkan.

set local lock_timeout = '5s';

do $guard$
begin
  if to_regclass('clinic_private.racikan_price_permits') is not null or to_regclass('clinic_private.racikan_price_changes') is not null then
    raise exception 'F7 racikan harga: objek sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)') is null
    or to_regprocedure('public.protect_official_compound_snapshot()') is null
    or to_regprocedure('public.clinic_record_correction_immutable()') is null
    or to_regclass('public.clinic_compound_sales') is null then
    raise exception 'F7 racikan harga: prasyarat tidak ditemukan';
  end if;
end $guard$;

-- Izin per-transaksi (diisi hanya oleh RPC kasir; tidak ada hak bagi peran aplikasi) dan jejak tambah-saja.
create table clinic_private.racikan_price_permits (
  transaction_id bigint not null,
  actor uuid not null,
  prescription_item_id uuid not null,
  primary key (transaction_id, prescription_item_id)
);
revoke all on clinic_private.racikan_price_permits from public, anon, authenticated, service_role;

create table clinic_private.racikan_price_changes (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id),
  prescription_item_id uuid not null references public.prescription_items(id),
  compound_recipe_id uuid not null references public.compounding_recipes(id),
  old_price numeric(15,2) not null,
  new_price numeric(15,2) not null check (new_price >= 0),
  reason text not null check (length(btrim(reason)) >= 5),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default clock_timestamp(),
  request_key text not null
);
create index racikan_price_changes_visit_idx on clinic_private.racikan_price_changes(visit_id);
revoke all on clinic_private.racikan_price_changes from public, anon, authenticated, service_role;
create trigger racikan_price_changes_immutable before update or delete on clinic_private.racikan_price_changes
  for each row execute function public.clinic_record_correction_immutable();
create trigger racikan_price_changes_no_truncate before truncate on clinic_private.racikan_price_changes
  for each statement execute function public.clinic_record_correction_immutable();

do $patch$
declare
  p record;
  d text;
  pre text;
begin
  for p in select * from (values
    -- 1. Racikan resmi: pengecualian sempit untuk UPDATE harga saja, hanya dengan izin per-transaksi.
    ('public.protect_official_compound_snapshot()',
     E'  elsif tg_table_name = ''prescription_items'' then\n    -- PR420 withdraws only billing eligibility after original stock return.',
     E'  elsif tg_table_name = ''prescription_items'' then\n    -- F7_RACIKAN_HARGA: Owner price change of a pending racikan row. Only the cashier RPC can plant the\n    -- per-transaction permit; every other column must stay byte-identical; never on a billed or withdrawn row.\n    if tg_op = ''UPDATE'' and new.harga is distinct from old.harga\n       and exists(select 1 from clinic_private.racikan_price_permits p where p.transaction_id = txid_current()\n         and p.actor = auth.uid() and p.prescription_item_id = old.id)\n       and (to_jsonb(new) - ''harga'') = (to_jsonb(old) - ''harga'')\n       and old.billing_withdrawn_at is null\n       and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id = old.id) then\n      return new;\n    end if;\n    -- PR420 withdraws only billing eligibility after original stock return.'),
    -- 2. Keranjang kasir: variabel kerja.
    ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
     $o$v_perf jsonb;v_perf_changed boolean;$o$,
     $n$v_perf jsonb;v_perf_changed boolean;v_racik_reason text;v_sale numeric;v_has_sale boolean;v_cap numeric;$n$),
    -- 3. Harga tidak lagi bagian dari kunci racikan; jumlah, barang, dan pelaksana tetap terkunci.
    ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
     E' or (row_value->>''harga'')::numeric is distinct from rx.harga\n    or nullif(row_value->>''item_id'','''')::uuid is distinct from rx.item_id',
     E' or nullif(row_value->>''item_id'','''')::uuid is distinct from rx.item_id'),
    -- 4. Perubahan harga racikan: Owner, alasan, belum pernah di invoice, snapshot penjualan, izin, jejak.
    ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
     $o$raise exception 'COMPOUND_LOCKED: racikan harus lewat koreksi asli';end if;$o$,
     $n$raise exception 'COMPOUND_LOCKED: racikan harus lewat koreksi asli';end if;
    -- F7_RACIKAN_HARGA: price only; Owner only; mandatory reason; P03 floor still judges the posting afterwards.
    if v_price is distinct from rx.harga then
     if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER')then
      raise exception using errcode='P0001',message='ACCESS_DENIED: hanya Owner yang boleh mengubah harga racikan';
     end if;
     v_racik_reason:=btrim(coalesce(row_value->>'harga_reason',''));
     if length(regexp_replace(v_racik_reason,'\s','','g'))<5 or length(v_racik_reason)>500 then
      raise exception using errcode='P0001',message='CART_INVALID: alasan ubah harga racikan wajib diisi (minimal 5 huruf, maksimal 500)';
     end if;
     -- typo guard: the new price is at most 10 x the stored price (stored Rp0: 10 x the racikan HPP), in addition to 0..1e12
     v_cap:=case when rx.harga>0 then rx.harga*10 else 10*coalesce((select round(sum(ci.qty*ci.unit_cost),2) from public.compound_issues ci where ci.recipe_id=rx.compound_recipe_id),0) end;
     if v_cap is not null and v_price > v_cap then
      raise exception using errcode='P0001',message=format('CART_INVALID: harga racikan baru %s melebihi batas 10x harga tersimpan %s (maksimal %s); periksa angka yang diketik',
       clinic_private.rupiah_text(v_price),clinic_private.rupiah_text(rx.harga),clinic_private.rupiah_text(v_cap));
     end if;
     if exists(select 1 from public.invoice_items l where l.prescription_item_id=v_id or l.compound_recipe_id=rx.compound_recipe_id)then
      raise exception using errcode='P0001',message='COMPOUND_LOCKED: racikan ini pernah masuk invoice; ubah harga lewat koreksi dokumen invoice';
     end if;
     select s.sale_price into v_sale from public.clinic_compound_sales s where s.recipe_id=rx.compound_recipe_id for update;
     v_has_sale:=found;
     if v_has_sale and v_sale is distinct from rx.harga then
      raise exception using errcode='P0001',message='COMPOUND_LOCKED: harga penjualan racikan tersimpan tidak sama dengan baris; hubungi tim teknis';
     end if;
     insert into clinic_private.racikan_price_permits values(txid_current(),auth.uid(),v_id);
     update public.prescription_items set harga=v_price where id=v_id;
     delete from clinic_private.racikan_price_permits where transaction_id=txid_current() and prescription_item_id=v_id;
     if v_has_sale then update public.clinic_compound_sales set sale_price=v_price where recipe_id=rx.compound_recipe_id;end if;
     insert into clinic_private.racikan_price_changes(visit_id,prescription_item_id,compound_recipe_id,old_price,new_price,reason,changed_by,request_key)
     values(p_visit_id,v_id,rx.compound_recipe_id,rx.harga,v_price,v_racik_reason,auth.uid(),p_request_key);
    end if;$n$)
  ) as patches(signature, old_text, new_text) loop
    d := pg_get_functiondef(p.signature::regprocedure);
    if (length(d) - length(replace(d, p.old_text, ''))) / length(p.old_text) <> 1 then
      raise exception 'F7 racikan harga: anchor drift: % / %', p.signature, left(p.old_text, 80);
    end if;
    pre := (select format('%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig) from pg_proc where oid = p.signature::regprocedure);
    execute replace(d, p.old_text, p.new_text);
    if pre is distinct from (select format('%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig) from pg_proc where oid = p.signature::regprocedure) then
      raise exception 'F7 racikan harga: pemilik/ACL/definer/config berubah setelah ditambal: %', p.signature;
    end if;
  end loop;
end $patch$;

do $check$
declare d text;
begin
  d := pg_get_functiondef('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)'::regprocedure);
  if position('F7_RACIKAN_HARGA' in d) = 0 or position('racikan_price_permits' in d) = 0 or position('lock_timeout' in d) = 0 or position('v_cap' in d) = 0
    or position('SECURITY DEFINER' in d) = 0 or position('(row_value->>''harga'')::numeric is distinct from rx.harga' in d) > 0 then
    raise exception 'F7 racikan harga: definisi kasir tidak sesuai setelah ditambal';
  end if;
  d := pg_get_functiondef('public.protect_official_compound_snapshot()'::regprocedure);
  if position('F7_RACIKAN_HARGA' in d) = 0 or position('PR420' in d) = 0 then
    raise exception 'F7 racikan harga: pelindung racikan resmi tidak sesuai setelah ditambal';
  end if;
end $check$;
