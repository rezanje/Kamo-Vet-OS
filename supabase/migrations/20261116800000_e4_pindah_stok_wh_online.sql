-- E4 bagian 2 (meeting 12 Nov 2026), keputusan owner "2A":
-- sisa stok di dua gudang ONLINE terpisah milik cabang petshop dipindah ke gudang toko (RETAIL)
-- cabang yang sama lewat dokumen Pemindahan Barang resmi, lalu kedua gudang online dinonaktifkan.
--
--   WH ONLINE PDRY (ONLINE, Kamo Petshop Panduraya) -> WH PDRY (RETAIL)  -- 31 barang, 230 unit (cek 13 Nov)
--   WH ONLINE TKI  (ONLINE, Kamo Petshop TKI/Kopo)  -> WH TKI  (RETAIL)  --  3 barang,  16 unit (cek 13 Nov)
--   WH B2C (ONLINE, cabang B2C) TIDAK disentuh.
--
-- Cara posting: PERSIS jalur aplikasi "Pemindahan Barang" (post_stock_transfer_atomic): satu dokumen
-- "Kirim Barang" (gudang online -> Transit) lalu satu dokumen "Terima Barang" (Transit -> gudang toko)
-- yang merujuk dokumen kirim, sehingga dokumen kirim berstatus "Diterima Seluruhnya". Nomor IT.YYYY.MM.NNNNN
-- dari stock_document_number, mutasi lewat stock_transfer_fifo_exact (lapisan FIFO + kedaluwarsa ikut,
-- harga pokok/average ikut), kartu stok bersumber 'transfer', log aktivitas lewat pemicu biasa.
-- Fungsi resmi itu mewajibkan pengguna login (stock_document_access). Migrasi tidak punya pengguna dan
-- repo ini sengaja tidak memalsukan aktor lewat GUC JWT (capture_activity_log: "JWT subject ... never by
-- business payload/GUC"). Karena itu definisi yang SEDANG BERJALAN di database disalin ke fungsi
-- sementara pg_temp (hilang di akhir transaksi) dengan tepat SATU baris diganti: pemeriksaan akses
-- pengguna. Semua logika lain identik byte-per-byte dengan aplikasi; jangkar yang tidak ditemukan tepat
-- satu kali menggagalkan migrasi. Dokumen tercatat dibuat oleh "Sistem / database" (created_by kosong),
-- seperti tindakan sistem lain (pola set_config klaim kosong: 20261104050000_promo_kadaluarsa_otomatis).
--
-- Dampak:
--   * Stok per barang pindah dari gudang online ke gudang toko cabang yang sama pada harga pokok yang sama
--     (FIFO: lapisan pindah apa adanya; average: dibawa pada average gudang asal).
--   * Total nilai persediaan tidak berubah dan TIDAK ada jurnal: pemindahan antar gudang di KAMO tidak
--     pernah menulis jurnal. Satu-satunya pengecualian adalah perilaku normal setiap penerimaan: bila gudang
--     toko sedang MINUS untuk barang itu dan metode average aktif, sistem menulis jurnal
--     'inventory-variance' (Penyesuaian HPP stok minus) seperti pada pemindahan/pembelian biasa.
--   * Kedua gudang online hilang dari semua pilihan gudang (is_active=false). Riwayat TIDAK ditulis ulang:
--     transaksi lama tetap tercatat di gudang online, laporan historis tetap sama.
--
-- Pagar (gagal tertutup; satu blok DO = satu transaksi, tidak ada yang berubah bila satu pagar gagal):
--   gudang online & gudang toko ditemukan tepat satu per nama+jenis+cabang dan masih aktif; saldo tidak ada
--   yang minus; jumlah barang & total unit sama dengan hasil cek 13 Nov; tidak ada mutasi gudang online
--   bertanggal sesudah 4 Nov 2026; tidak ada dokumen terbuka (pemindahan dalam perjalanan, permintaan
--   barang, opname terbuka, PO, pesanan penjualan, produksi) yang memakai gudang online; barangnya aktif,
--   bertipe Persediaan, tidak di tempat sampah; harga pokok lengkap (FIFO: lapisan = saldo; average:
--   average > 0); gudang Transit tidak sedang memegang barang yang sama; periode hari ini tidak dikunci.
--   Sesudah posting diperiksa ulang: saldo online 0, saldo toko naik tepat sebesar yang dipindah, nilai per
--   barang tetap (kecuali barang yang gudang tokonya minus), tidak ada jurnal lain.
--
-- Rollback (bila owner berubah pikiran): aktifkan lagi gudangnya
--   update public.warehouses set is_active=true where name in ('WH ONLINE PDRY','WH ONLINE TKI') and type='ONLINE';
-- lalu buat Pemindahan Barang biasa di aplikasi dari gudang toko kembali ke gudang online. Dokumen E4 tidak
-- dihapus dan tidak bisa "dibatalkan pengiriman" (sudah diterima) -- persis aturan dokumen pemindahan biasa.
do $e4$
declare
 c_note constant text := 'E4 meeting 12 Nov 2026: pemindahan sisa stok WH Online ke gudang toko (keputusan owner 2A); gudang online dinonaktifkan sesudahnya.';
 c_last_move constant date := date '2026-11-04';
 c_head constant text := 'CREATE OR REPLACE FUNCTION public.post_stock_transfer_atomic(';
 c_access constant text := $x$ perform stock_document_access(case when p_source is null then v_from.branch_id else v_to.branch_id end,'pos');$x$;
 c_core constant text[] := array[
  $x$ select * into v_from from warehouses where id=p_from and is_active and type<>'TRANSIT';$x$,
  $x$ select * into v_to from warehouses where id=p_to and is_active and type<>'TRANSIT';$x$,
  $x$ select id into v_transit from warehouses where type='TRANSIT' and is_active order by id limit 1;$x$,
  $x$ v_number:=stock_document_number('IT',p_date);$x$,
  $x$  perform stock_transfer_fifo_exact(case when p_source is null then p_from else v_transit end,case when p_source is null then v_transit else p_to end,v_row.item_id,v_row.qty*v_factor,'transfer',v_number,p_date);$x$,
  $x$  update stock_transfers set status=case when v_received>=v_total then 'Diterima Seluruhnya'::transfer_status else 'Diterima Sebagian'::transfer_status end where id=p_source;$x$];
 v_today date := (now() at time zone 'Asia/Jakarta')::date;
 v_def text; v_part text; v_avg boolean; v_transit uuid; v_msg text; v_n integer; v_journals bigint;
 v_items jsonb; v_kirim uuid; v_terima uuid; t record;
 old_claims text := current_setting('request.jwt.claims', true);
 old_sub text := current_setting('request.jwt.claim.sub', true);
 old_role text := current_setting('request.jwt.claim.role', true);
begin
 -- Aktor sistem, bukan pengguna mana pun (pola 20261104050000).
 perform set_config('request.jwt.claims', '', true);
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claim.role', '', true);

 create temp table e4_target(urut int primary key, online_name text, branch_name text, store_name text,
  exp_items int, exp_qty numeric, online_id uuid, store_id uuid, branch_id uuid, kirim_no text, terima_no text) on commit drop;
 insert into e4_target(urut, online_name, branch_name, store_name, exp_items, exp_qty) values
  (1, 'WH ONLINE PDRY', 'Kamo Petshop Panduraya', 'WH PDRY', 31, 230),
  (2, 'WH ONLINE TKI', 'Kamo Petshop TKI/Kopo', 'WH TKI', 3, 16);

 -- 1. Gudang asal & tujuan: tepat satu, aktif, cabang sama. Baris gudang dikunci sampai selesai.
 for t in select * from e4_target order by urut loop
  select count(*) into v_n from public.warehouses w join public.branches b on b.id = w.branch_id
   where w.name = t.online_name and w.type = 'ONLINE' and b.name = t.branch_name;
  if v_n <> 1 then raise exception 'E4_PRASYARAT: gudang % (ONLINE, cabang %) harus tepat satu, ditemukan %. Tidak ada yang diubah.', t.online_name, t.branch_name, v_n; end if;
  update e4_target e set online_id = w.id, branch_id = w.branch_id
   from public.warehouses w join public.branches b on b.id = w.branch_id
   where e.urut = t.urut and w.name = t.online_name and w.type = 'ONLINE' and b.name = t.branch_name;
  perform 1 from public.warehouses w join e4_target e on e.online_id = w.id where e.urut = t.urut and w.is_active for update of w;
  if not found then raise exception 'E4_PRASYARAT: gudang % sudah tidak aktif (migrasi ini sudah pernah jalan?). Tidak ada yang diubah.', t.online_name; end if;
  select count(*) into v_n from public.warehouses w join e4_target e on e.urut = t.urut
   where w.name = t.store_name and w.type = 'RETAIL' and w.branch_id = e.branch_id and w.is_active;
  if v_n <> 1 then raise exception 'E4_PRASYARAT: gudang toko % (RETAIL aktif, cabang %) harus tepat satu, ditemukan %. Tidak ada yang diubah.', t.store_name, t.branch_name, v_n; end if;
  update e4_target e set store_id = w.id from public.warehouses w
   where e.urut = t.urut and w.name = t.store_name and w.type = 'RETAIL' and w.branch_id = e.branch_id and w.is_active;
  perform 1 from public.warehouses w join e4_target e on e.store_id = w.id where e.urut = t.urut for update of w;
 end loop;
 if exists (select 1 from e4_target e join public.warehouses w on w.id = e.online_id where w.name = 'WH B2C') then
  raise exception 'E4_PRASYARAT: WH B2C tidak boleh ikut dipindah'; end if;

 -- 2. Periode hari ini harus terbuka (akuntansi & HPP).
 begin
  perform public.inventory_assert_open_date(v_today);
 exception when others then
  raise exception 'E4_PRASYARAT: %. Tidak ada yang diubah.', rtrim(sqlerrm, '.');
 end;

 -- 3. Saldo gudang online (dikunci): tidak minus, cocok dengan cek 13 Nov.
 create temp table e4_line(urut int, item_id uuid, qty numeric, primary key (urut, item_id)) on commit drop;
 perform 1 from public.stock s join e4_target e on e.online_id = s.warehouse_id order by s.warehouse_id, s.item_id for update of s;
 insert into e4_line select e.urut, s.item_id, s.qty from public.stock s join e4_target e on e.online_id = s.warehouse_id where s.qty <> 0;
 select string_agg(format('%s di %s = %s', i.name, e.online_name, l.qty), '; ' order by e.urut, i.name) into v_msg
  from e4_line l join e4_target e using (urut) join public.items i on i.id = l.item_id where l.qty < 0;
 if v_msg is not null then raise exception 'E4_PRASYARAT: ada saldo minus, rekonsiliasi dulu: %. Tidak ada yang diubah.', v_msg; end if;
 select string_agg(format('%s: %s barang / %s unit (cek 13 Nov: %s / %s)', e.online_name, coalesce(x.n, 0), coalesce(x.q, 0), e.exp_items, e.exp_qty), '; ' order by e.urut) into v_msg
  from e4_target e left join (select urut, count(*) n, sum(qty) q from e4_line group by urut) x using (urut)
  where coalesce(x.n, 0) <> e.exp_items or coalesce(x.q, 0) <> e.exp_qty;
 if v_msg is not null then raise exception 'E4_PRASYARAT: saldo gudang online berubah sejak dicek: %. Cek ulang sebelum memindah. Tidak ada yang diubah.', v_msg; end if;

 -- 4. Tidak ada mutasi baru sesudah 4 Nov 2026.
 select string_agg(format('%s (terakhir %s)', e.online_name, m.last), '; ') into v_msg
  from e4_target e join (select warehouse_id, max(tanggal) last from public.stock_moves group by warehouse_id) m on m.warehouse_id = e.online_id
  where m.last > c_last_move;
 if v_msg is not null then raise exception 'E4_PRASYARAT: ada mutasi gudang online sesudah %: %. Tidak ada yang diubah.', c_last_move, v_msg; end if;

 -- 5. Tidak ada dokumen terbuka yang masih memakai gudang online.
 select string_agg(d, '; ') into v_msg from (
  select format('pemindahan %s (%s)', st.no_pemindahan, st.status) d from public.stock_transfers st
   where (st.from_warehouse_id in (select online_id from e4_target) or st.to_warehouse_id in (select online_id from e4_target))
     and st.status in ('Sedang dikirim', 'Diterima Sebagian')
  union all select format('permintaan barang %s (%s)', r.id, r.status) from public.stock_requests r
   where r.to_warehouse_id in (select online_id from e4_target) and r.status in ('Menunggu Persetujuan', 'Disetujui', 'Dikirim')
  union all select format('opname %s (Terbuka)', o.id) from public.opname_orders o
   where o.warehouse_id in (select online_id from e4_target) and o.status = 'Terbuka'
  union all select format('PO %s (%s)', p.id, p.status) from public.purchase_orders p
   where p.to_warehouse_id in (select online_id from e4_target) and p.status in ('Draft', 'Dipesan')
  union all select format('pesanan penjualan %s (%s)', so.id, so.status) from public.sales_orders so
   where so.warehouse_id in (select online_id from e4_target) and so.status in ('draft', 'diproses')
  union all select format('produksi %s (berjalan)', po.id) from public.production_orders po
   where po.status = 'berjalan' and (po.warehouse_id in (select online_id from e4_target)
     or exists (select 1 from public.production_order_items pi where pi.order_id = po.id and pi.warehouse_id in (select online_id from e4_target)))
 ) x;
 if v_msg is not null then raise exception 'E4_PRASYARAT: masih ada dokumen terbuka di gudang online: %. Selesaikan/batalkan dulu. Tidak ada yang diubah.', v_msg; end if;

 -- 6. Barang yang dipindah harus persediaan aktif (syarat fungsi pemindahan resmi).
 select string_agg(format('%s (%s)', i.name, i.code), '; ' order by i.name) into v_msg
  from e4_line l join public.items i on i.id = l.item_id
  where not coalesce(i.is_active, false) or i.trashed_at is not null or coalesce(i.item_type, 'Persediaan') <> 'Persediaan';
 if v_msg is not null then raise exception 'E4_PRASYARAT: barang tidak aktif / di tempat sampah / bukan persediaan masih bersaldo di gudang online: %. Tidak ada yang diubah.', v_msg; end if;

 -- 7. Harga pokok lengkap supaya nilai pindah utuh.
 v_avg := public.inventory_is_average();
 if v_avg then
  select string_agg(format('%s (%s)', i.name, e.online_name), '; ' order by i.name) into v_msg
   from e4_line l join e4_target e using (urut) join public.items i on i.id = l.item_id
   join public.stock s on s.warehouse_id = e.online_id and s.item_id = l.item_id
   where s.average_cost is null or s.average_cost <= 0;
  if v_msg is not null then raise exception 'E4_PRASYARAT: harga pokok average belum ada: %. Tidak ada yang diubah.', v_msg; end if;
 else
  select string_agg(format('%s (%s: saldo %s, lapisan %s)', i.name, e.online_name, l.qty, coalesce(y.q, 0)), '; ' order by i.name) into v_msg
   from e4_line l join e4_target e using (urut) join public.items i on i.id = l.item_id
   left join (select warehouse_id, item_id, sum(qty_left) q from public.stock_layers group by 1, 2) y on y.warehouse_id = e.online_id and y.item_id = l.item_id
   where coalesce(y.q, 0) <> l.qty;
  if v_msg is not null then raise exception 'E4_PRASYARAT: lapisan FIFO tidak sama dengan saldo: %. Tidak ada yang diubah.', v_msg; end if;
 end if;

 -- 8. Gudang Transit (yang dipakai fungsi resmi) tidak sedang memegang barang yang sama, supaya harga
 --    pokok tidak tercampur kiriman lain.
 select id into v_transit from public.warehouses where type = 'TRANSIT' and is_active order by id limit 1;
 if v_transit is not null then
  select string_agg(distinct i.name, '; ') into v_msg from e4_line l join public.items i on i.id = l.item_id
   where exists (select 1 from public.stock s where s.warehouse_id = v_transit and s.item_id = l.item_id and s.qty <> 0)
      or exists (select 1 from public.stock_layers y where y.warehouse_id = v_transit and y.item_id = l.item_id and y.qty_left <> 0);
  if v_msg is not null then raise exception 'E4_PRASYARAT: gudang Transit masih memegang barang yang sama (kiriman lain belum diterima): %. Tidak ada yang diubah.', v_msg; end if;
 end if;

 -- 9. Potret sebelum (nilai menurut metode yang aktif).
 create temp table e4_before(urut int, item_id uuid, online_qty numeric, online_value numeric, store_qty numeric, store_value numeric, primary key (urut, item_id)) on commit drop;
 insert into e4_before
 select l.urut, l.item_id, l.qty,
  case when v_avg then l.qty * so.average_cost else (select coalesce(sum(qty_left * unit_cost), 0) from public.stock_layers where warehouse_id = e.online_id and item_id = l.item_id) end,
  coalesce(ss.qty, 0),
  case when v_avg then case when coalesce(ss.qty, 0) = 0 then 0 else ss.qty * ss.average_cost end
   else (select coalesce(sum(qty_left * unit_cost), 0) from public.stock_layers where warehouse_id = e.store_id and item_id = l.item_id) end
 from e4_line l join e4_target e using (urut)
 join public.stock so on so.warehouse_id = e.online_id and so.item_id = l.item_id
 left join public.stock ss on ss.warehouse_id = e.store_id and ss.item_id = l.item_id;
 select count(*) into v_journals from public.journal_entries where source is distinct from 'inventory-variance';

 -- 10. Salin fungsi posting resmi yang sedang berjalan; hanya pemeriksaan akses pengguna yang dilepas.
 v_def := pg_get_functiondef('public.post_stock_transfer_atomic(uuid,uuid,uuid,uuid,date,text,jsonb)'::regprocedure);
 foreach v_part in array array[c_head, c_access] || c_core loop
  if (length(v_def) - length(replace(v_def, v_part, ''))) / length(v_part) <> 1 then
   raise exception 'E4_DRIFT: definisi post_stock_transfer_atomic berbeda dari yang ditinjau (jangkar: %). Tidak ada yang diubah.', left(v_part, 90);
  end if;
 end loop;
 v_def := replace(v_def, c_head, 'CREATE FUNCTION pg_temp.e4_post_stock_transfer(');
 v_def := replace(v_def, c_access, ' null; -- E4: aktor migrasi = sistem; pemeriksaan akses pengguna tidak berlaku.');
 execute v_def;

 -- 11. Posting: Kirim Barang lalu Terima Barang penuh, per gudang online.
 for t in select * from e4_target order by urut loop
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', qty) order by item_id) into v_items from e4_line where urut = t.urut;
  if v_items is null then continue; end if;
  v_kirim := pg_temp.e4_post_stock_transfer(gen_random_uuid(), null, t.online_id, t.store_id, v_today, c_note, v_items);
  v_terima := pg_temp.e4_post_stock_transfer(gen_random_uuid(), v_kirim, null, null, v_today, c_note, v_items);
  update e4_target set kirim_no = (select no_pemindahan from public.stock_transfers where id = v_kirim),
   terima_no = (select no_pemindahan from public.stock_transfers where id = v_terima) where urut = t.urut;
  if (select status from public.stock_transfers where id = v_kirim) is distinct from 'Diterima Seluruhnya' then
   raise exception 'E4_PASCA: dokumen kirim % belum diterima seluruhnya', v_kirim; end if;
 end loop;
 drop function pg_temp.e4_post_stock_transfer(uuid, uuid, uuid, uuid, date, text, jsonb);

 -- 12. Pemeriksaan sesudah posting.
 if exists (select 1 from public.stock s join e4_target e on e.online_id = s.warehouse_id where s.qty <> 0)
  or exists (select 1 from public.stock_layers y join e4_target e on e.online_id = y.warehouse_id where y.qty_left <> 0) then
  raise exception 'E4_PASCA: saldo gudang online belum nol'; end if;
 select string_agg(i.name, '; ') into v_msg from e4_before b join e4_target e using (urut) join public.items i on i.id = b.item_id
  left join public.stock s on s.warehouse_id = e.store_id and s.item_id = b.item_id
  where coalesce(s.qty, 0) <> b.store_qty + b.online_qty;
 if v_msg is not null then raise exception 'E4_PASCA: saldo gudang toko tidak bertambah tepat: %', v_msg; end if;
 if v_transit is not null and exists (select 1 from public.stock s join e4_line l on l.item_id = s.item_id where s.warehouse_id = v_transit and s.qty <> 0) then
  raise exception 'E4_PASCA: barang tertinggal di gudang Transit'; end if;
 -- Nilai per barang tetap; barang yang gudang tokonya minus sebelum pindah mengikuti aturan normal
 -- penerimaan ke stok minus (dikecualikan dari pemeriksaan ini).
 select string_agg(format('%s (sebelum %s, sesudah %s)', i.name, round(b.online_value + b.store_value, 2), round(v.after_value, 2)), '; ') into v_msg
  from e4_before b join e4_target e using (urut) join public.items i on i.id = b.item_id
  cross join lateral (select case when v_avg then coalesce((select case when s.qty = 0 then 0 else s.qty * s.average_cost end from public.stock s where s.warehouse_id = e.store_id and s.item_id = b.item_id), 0)
     else (select coalesce(sum(qty_left * unit_cost), 0) from public.stock_layers where warehouse_id = e.store_id and item_id = b.item_id) end as after_value) v
  where b.store_qty >= 0 and abs(v.after_value - (b.online_value + b.store_value)) > 0.01;
 if v_msg is not null then raise exception 'E4_PASCA: nilai persediaan berubah: %', v_msg; end if;
 if (select count(*) from public.journal_entries where source is distinct from 'inventory-variance') <> v_journals then
  raise exception 'E4_PASCA: pemindahan menulis jurnal yang tidak diharapkan'; end if;

 -- 13. Nonaktifkan kedua gudang online (riwayat tetap utuh).
 update public.warehouses set is_active = false where id in (select online_id from e4_target) and is_active;
 get diagnostics v_n = row_count;
 if v_n <> 2 then raise exception 'E4_PASCA: gudang online yang dinonaktifkan % (harus 2)', v_n; end if;

 for t in select * from e4_target order by urut loop
  raise notice 'E4: % -> % : % barang, % unit, kirim %, terima %', t.online_name, t.store_name,
   (select count(*) from e4_line where urut = t.urut), (select sum(qty) from e4_line where urut = t.urut), t.kirim_no, t.terima_no;
 end loop;

 perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
 perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
 perform set_config('request.jwt.claim.role', coalesce(old_role, ''), true);
end $e4$;
