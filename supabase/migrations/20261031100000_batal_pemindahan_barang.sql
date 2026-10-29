-- Pemindahan Barang & Permintaan Barang: "Batalkan pengiriman".
--
-- Temuan audit stok (bagian "Pemindahan Barang"): status 'Dibatalkan' sudah ada di skema
-- sejak migrasi 0052, tetapi tidak satu pun layar yang bisa mengisinya. Kalau gudang salah
-- barang atau salah jumlah, dokumen Kirim Barang mengambang selamanya dan stoknya nyangkut
-- di gudang Transit: tidak ada jalan koreksi sama sekali.
--
-- Sesudah tambalan ini:
--   1. Dokumen Kirim Barang yang BELUM diterima sama sekali bisa dibatalkan lewat
--      cancel_stock_transfer. Begitu ada satu dokumen Terima Barang, pembatalan ditolak
--      dengan pesan yang mengarahkan ke penerimaan / pemindahan balik.
--   2. Pembalikan stok, bukan penghapusan: barang yang ada di gudang Transit dikembalikan ke
--      gudang asal memakai primitif yang sama dengan pemindahan biasa
--      (stock_transfer_fifo_exact), jadi lapisan FIFO, harga pokok dan tanggal kedaluwarsa
--      ikut utuh. Dokumen aslinya tetap tersimpan, distempel 'Dibatalkan' + alasan/pelaku/waktu.
--      Kartu stok menamai mutasinya "Pembatalan Pemindahan Barang" (sumber 'transfer-batal').
--   3. Permintaan Barang berstatus Dikirim yang belum punya dokumen penerimaan juga bisa
--      dibatalkan pengirimannya: stok Transit kembali ke gudang pengirim dan permintaannya
--      kembali ke 'Disetujui' supaya bisa dikirim ulang (sumber 'batal-kirim-permintaan').
--   4. Izin: sama dengan yang berhak mengirim dari gudang asal itu (stock_document_access
--      modul 'pos' atas cabang gudang asal; untuk permintaan ditambah peran OWNER/ADMIN,
--      persis syarat ship_stock_request_atomic). Dipaksakan di RPC, bukan cuma di layar.
--   5. Atomik: satu RPC SECURITY DEFINER, satu transaksi, dokumennya dikunci (for update)
--      sehingga tidak bisa dibatalkan dua kali atau dibatalkan saat penerimaan sedang jalan.
--      Panggilan ulang dengan kunci yang sama mengembalikan hasil yang sama tanpa efek kedua.
--
-- Tidak ada jurnal: pemindahan antar gudang di KAMO tidak pernah menulis jurnal (tidak ada
-- entri journal_entries bersumber 'transfer'), jadi pembatalannya juga tidak menulis jurnal.
-- Nilai persediaan tidak berubah -- barang hanya kembali ke gudang asalnya pada harga asal.
--
-- Semua perubahan pada fungsi yang sudah berjalan memakai jangkar eksak di atas definisi
-- berjalan (pg_get_functiondef + replace) dan gagal tertutup bila definisinya sudah berubah.
-- Migrasi lama tidak diubah. Tidak ada data yang diubah saat migrasi (pra-pemeriksaan
-- 29 Okt di Production: 5 dokumen Kirim -- semuanya 'Diterima Seluruhnya', 0 'Sedang dikirim',
-- 0 dokumen berstatus 'Dibatalkan').

-- ---------------------------------------------------------------------------
-- 1. Jejak pembatalan pada dokumen Kirim Barang
-- ---------------------------------------------------------------------------
alter table public.stock_transfers
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column cancel_reason text,
  add column cancel_request_key uuid unique;
comment on column public.stock_transfers.cancel_reason is
  'Alasan pembatalan pengiriman; wajib diisi, hanya ditulis oleh cancel_stock_transfer.';
comment on column public.stock_transfers.cancel_request_key is
  'Kunci kiriman layar pembatalan; menjaga klik ganda tidak membalik stok dua kali.';
-- stock_transfers tidak punya policy tulis sama sekali (hanya stock_transfer_read, SELECT),
-- jadi kolom jejak ini pun tidak dapat ditulis dari browser; satu-satunya penulis adalah RPC.

-- ---------------------------------------------------------------------------
-- 2. Bukti pembatalan pengiriman Permintaan Barang
-- ---------------------------------------------------------------------------
-- Dicatat di tabel terpisah, bukan kolom pada permintaan: satu permintaan boleh dikirim,
-- dibatalkan, lalu dikirim lagi -- riwayatnya harus menumpuk, bukan saling menimpa.
create table public.stock_request_shipment_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.stock_requests(id),
  warehouse_id uuid references public.warehouses(id),
  transit_warehouse_id uuid references public.warehouses(id),
  actor_id uuid not null references public.profiles(id),
  request_key uuid not null,
  payload jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  tanggal date not null,
  lines jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (actor_id, request_key)
);
create index on public.stock_request_shipment_cancellations(request_id);
alter table public.stock_request_shipment_cancellations enable row level security;
revoke all on public.stock_request_shipment_cancellations from public, anon, authenticated, service_role;
-- Bukti bisnisnya terbaca lewat visibilitas permintaan yang sama; kunci kiriman tidak dibuka.
grant select (id, request_id, warehouse_id, transit_warehouse_id, actor_id, reason, tanggal, lines, created_at)
  on public.stock_request_shipment_cancellations to authenticated;
create policy stock_request_shipment_cancellation_read on public.stock_request_shipment_cancellations
  for select to authenticated using (exists (
    select 1 from public.stock_requests r where r.id = request_id and (
      public.user_can_access_branch(r.from_branch_id)
      or exists (select 1 from public.warehouses w where w.id = r.to_warehouse_id and public.user_can_access_branch(w.branch_id)))));

create function public.guard_stock_request_shipment_cancellation_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Bukti pembatalan pengiriman tidak dapat diubah atau dihapus' using errcode = '42501'; end $$;
revoke all on function public.guard_stock_request_shipment_cancellation_immutable() from public, anon, authenticated, service_role;
create trigger stock_request_shipment_cancellation_immutable
  before update or delete on public.stock_request_shipment_cancellations
  for each row execute function public.guard_stock_request_shipment_cancellation_immutable();
create trigger stock_request_shipment_cancellation_no_truncate
  before truncate on public.stock_request_shipment_cancellations
  for each statement execute function public.guard_stock_request_shipment_cancellation_immutable();

-- ---------------------------------------------------------------------------
-- 3. RPC: batalkan pengiriman Pemindahan Barang
-- ---------------------------------------------------------------------------
create function public.cancel_stock_transfer(p_transfer_id uuid, p_request_key uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc stock_transfers%rowtype; v_prior stock_transfers%rowtype; v_from warehouses%rowtype;
  v_transit uuid; v_whs uuid[]; v_row record; v_reason text := btrim(coalesce(p_reason, ''));
  v_date date := (now() at time zone 'Asia/Jakarta')::date; v_items integer := 0; v_qty numeric := 0;
  terima constant text := 'Sebagian barang kiriman ini sudah diterima gudang tujuan, jadi pengirimannya tidak bisa dibatalkan. Selesaikan lewat Terima Barang, lalu buat pemindahan balik dari gudang tujuan bila barangnya memang harus kembali.';
  rancu constant text := 'Jejak stok kiriman ini tidak cocok dengan dokumennya, jadi tidak bisa dibatalkan otomatis. Minta rekonsiliasi stok, atau buat pemindahan balik dari gudang tujuan.';
begin
  if p_request_key is null then raise exception 'Identitas pembatalan tidak valid. Muat ulang halaman' using errcode = '22023'; end if;
  if length(v_reason) not between 3 and 1000 then
    raise exception 'Alasan pembatalan wajib diisi (3 sampai 1.000 karakter)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('vetos:stock-transfer-cancel:' || p_request_key::text)::bigint);
  -- Kunci dokumennya lebih dulu: RPC penerimaan (post_stock_transfer_atomic) mengunci baris
  -- yang sama, jadi pembatalan dan penerimaan tidak pernah berjalan bersamaan.
  select * into v_doc from stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Dokumen pemindahan tidak ditemukan'; end if;
  select * into v_prior from stock_transfers where cancel_request_key = p_request_key;
  if found and v_prior.id <> v_doc.id then
    raise exception 'Kunci pembatalan sudah dipakai untuk dokumen lain. Muat ulang halaman' using errcode = '22023'; end if;
  select * into v_from from warehouses where id = v_doc.from_warehouse_id;
  if not found then raise exception '%', rancu; end if;
  -- Izin sama persis dengan yang berhak mengirim dari gudang asal dokumen ini.
  perform stock_document_access(v_from.branch_id, 'pos');

  if v_doc.cancelled_at is not null then
    -- Klik ganda / tab lain: tidak ada efek kedua.
    return jsonb_build_object('transfer_id', v_doc.id, 'no_pemindahan', v_doc.no_pemindahan,
      'reason', v_doc.cancel_reason, 'already_cancelled', true);
  end if;
  if v_doc.proses <> 'Kirim Barang' then
    raise exception 'Hanya dokumen Kirim Barang yang bisa dibatalkan. Dokumen Terima Barang dikoreksi dengan pemindahan balik dari gudang tujuan.'; end if;
  -- Dua pagar untuk syarat "belum ada yang diterima": dokumen turunannya dan statusnya.
  if exists (select 1 from stock_transfers d where d.source_transfer_id = v_doc.id) then raise exception '%', terima using errcode = '55000'; end if;
  if v_doc.status is distinct from 'Sedang dikirim'::transfer_status then raise exception '%', terima using errcode = '55000'; end if;
  if not v_from.is_active or v_from.type = 'TRANSIT' then
    raise exception 'Gudang asal pemindahan ini tidak aktif, barangnya tidak bisa dikembalikan ke sana. Aktifkan kembali gudangnya lebih dulu.'; end if;

  -- Gudang transit dibaca dari jejak mutasinya sendiri, bukan ditebak: nomor dokumen unik,
  -- dan seluruh barang kiriman masuk ke satu gudang transit yang sama.
  select array_agg(distinct warehouse_id) into v_whs from stock_moves
    where source = 'transfer' and source_ref = v_doc.no_pemindahan and qty > 0;
  if v_whs is null or array_length(v_whs, 1) <> 1 then raise exception '%', rancu; end if;
  v_transit := v_whs[1];
  if not exists (select 1 from warehouses where id = v_transit and type = 'TRANSIT') then raise exception '%', rancu; end if;
  if v_transit = v_doc.from_warehouse_id then raise exception '%', rancu; end if;

  -- Pembalikan stok, bukan penghapusan dokumen. stock_transfer_fifo_exact memindahkan lapisan
  -- apa adanya (harga pokok + kedaluwarsa ikut), dan menolak bila stok transitnya sudah tidak ada.
  for v_row in select item_id, sum(qty) qty from stock_transfer_items
    where transfer_id = v_doc.id group by item_id order by item_id
  loop
    if v_row.qty > 0 then
      perform stock_transfer_fifo_exact(v_transit, v_doc.from_warehouse_id, v_row.item_id, v_row.qty,
        'transfer-batal', v_doc.no_pemindahan, v_date);
      v_items := v_items + 1; v_qty := v_qty + v_row.qty;
    end if;
  end loop;

  update stock_transfers set status = 'Dibatalkan', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = v_reason, cancel_request_key = p_request_key where id = v_doc.id;
  return jsonb_build_object('transfer_id', v_doc.id, 'no_pemindahan', v_doc.no_pemindahan,
    'from_warehouse_id', v_doc.from_warehouse_id, 'to_warehouse_id', v_doc.to_warehouse_id,
    'transit_warehouse_id', v_transit, 'tanggal', v_date, 'items', v_items, 'qty', v_qty,
    'reason', v_reason, 'already_cancelled', false);
end $$;
revoke all on function public.cancel_stock_transfer(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.cancel_stock_transfer(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: batalkan pengiriman Permintaan Barang (Dikirim -> Disetujui)
-- ---------------------------------------------------------------------------
create function public.cancel_stock_request_shipment(p_id uuid, p_request_key uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req stock_requests%rowtype; v_prior stock_request_shipment_cancellations%rowtype;
  v_branch uuid; v_row record; v_reason text := btrim(coalesce(p_reason, ''));
  v_date date := (now() at time zone 'Asia/Jakarta')::date; v_payload jsonb; v_lines jsonb;
  v_result jsonb; v_items integer := 0; v_qty numeric := 0; v_transit uuid;
begin
  if p_request_key is null then raise exception 'Identitas pembatalan tidak valid. Muat ulang halaman' using errcode = '22023'; end if;
  if length(v_reason) not between 3 and 1000 then
    raise exception 'Alasan pembatalan wajib diisi (3 sampai 1.000 karakter)' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('request_id', p_id, 'reason', v_reason);
  perform pg_advisory_xact_lock(hashtextextended('vetos:stock-request-ship-cancel:' || coalesce(auth.uid()::text, '') || ':' || p_request_key::text, 0));
  select * into v_req from stock_requests where id = p_id for update;
  if not found then raise exception 'Permintaan tidak ditemukan'; end if;
  select * into v_prior from stock_request_shipment_cancellations where actor_id = auth.uid() and request_key = p_request_key;
  if found then
    if v_prior.payload is distinct from v_payload then
      raise exception 'Kunci pembatalan sudah dipakai dengan rincian berbeda. Muat ulang halaman' using errcode = '22023'; end if;
    return v_prior.result || jsonb_build_object('already_cancelled', true);
  end if;
  -- Izin sama persis dengan ship_stock_request_atomic: akses modul pos atas cabang gudang
  -- pengirim, ditambah peran Kepala Gudang / Manajer.
  select branch_id into v_branch from warehouses where id = v_req.to_warehouse_id and is_active and type <> 'TRANSIT';
  if v_branch is null then raise exception 'Gudang pengirim tidak aktif'; end if;
  perform stock_document_access(v_branch, 'pos');
  if not exists (select 1 from profiles where id = auth.uid() and is_active and role in ('OWNER', 'ADMIN')) then
    raise exception 'Hanya Kepala Gudang / Manajer yang bisa membatalkan pengiriman'; end if;
  if v_req.status <> 'Dikirim' then
    raise exception 'Hanya permintaan berstatus Dikirim yang pengirimannya bisa dibatalkan (sekarang %)', v_req.status; end if;
  if exists (select 1 from stock_receipts where stock_request_id = p_id) then
    raise exception 'Cabang sudah mencatat penerimaan atas permintaan ini, jadi pengirimannya tidak bisa dibatalkan. Selesaikan lewat penerimaan barang.' using errcode = '55000'; end if;

  select jsonb_agg(jsonb_build_object('id', i.id, 'item_id', i.item_id, 'nama', i.nama,
    'qty_dikirim', i.qty_dikirim, 'satuan', i.satuan, 'faktor', i.faktor) order by i.id)
    into v_lines from stock_request_items i where i.request_id = p_id;
  -- Permintaan yang dikirim sebelum 30 Okt 2026 tidak punya gudang transit: statusnya "Dikirim"
  -- waktu itu hanya label dan stok gudang tidak pernah keluar, jadi tidak ada yang dibalik.
  v_transit := v_req.transit_warehouse_id;
  if v_transit is not null then
    for v_row in select i.item_id, sum(coalesce(i.qty_dikirim, 0) * coalesce(nullif(i.faktor, 0), 1)) qty
      from stock_request_items i where i.request_id = p_id and i.item_id is not null
      group by i.item_id order by i.item_id
    loop
      if v_row.qty > 0 then
        perform stock_transfer_fifo_exact(v_transit, v_req.to_warehouse_id, v_row.item_id, v_row.qty,
          'batal-kirim-permintaan', left(coalesce(v_req.no_request, p_id::text), 40), v_date);
        v_items := v_items + 1; v_qty := v_qty + v_row.qty;
      end if;
    end loop;
  end if;
  update stock_request_items set qty_dikirim = null where request_id = p_id;
  update stock_requests set status = 'Disetujui', shipped_at = null, shipped_by = null, transit_warehouse_id = null where id = p_id;
  v_result := jsonb_build_object('request_id', p_id, 'no_request', v_req.no_request, 'status', 'Disetujui',
    'warehouse_id', v_req.to_warehouse_id, 'transit_warehouse_id', v_transit, 'tanggal', v_date,
    'items', v_items, 'qty', v_qty, 'reason', v_reason, 'already_cancelled', false);
  insert into stock_request_shipment_cancellations (request_id, warehouse_id, transit_warehouse_id, actor_id,
    request_key, payload, reason, tanggal, lines, result)
  values (p_id, v_req.to_warehouse_id, v_transit, auth.uid(), p_request_key, v_payload, v_reason, v_date,
    coalesce(v_lines, '[]'::jsonb), v_result);
  return v_result;
end $$;
revoke all on function public.cancel_stock_request_shipment(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.cancel_stock_request_shipment(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tambalan jangkar eksak pada fungsi yang sudah berjalan
-- ---------------------------------------------------------------------------
do $patch$
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI.
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- (a) Sumber mutasi pembatalan ikut dipagari dari pemanggilan langsung lewat browser.
  ('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)',
   E'  if current_user = ''authenticated'' and p_source in (''terima-permintaan'', ''transfer'', ''kirim-permintaan'', ''retur-permintaan'') then',
   E'  if current_user = ''authenticated'' and p_source in (''terima-permintaan'', ''transfer'', ''kirim-permintaan'', ''retur-permintaan'', ''transfer-batal'', ''batal-kirim-permintaan'') then'),
  -- (b) Transisi Dikirim -> Disetujui lewat browser ditolak dengan pesan yang mengarahkan
  --     ke tombol resmi; sebelumnya hanya kena pesan umum "Transisi permintaan tidak valid".
  ('public.guard_stock_request_write()',
   E'  if (new.shipped_at,new.shipped_by,new.transit_warehouse_id) is distinct from (old.shipped_at,old.shipped_by,old.transit_warehouse_id) then raise exception ''Jejak pengiriman hanya ditulis oleh proses kirim barang''; end if;',
   E'  if (new.shipped_at,new.shipped_by,new.transit_warehouse_id) is distinct from (old.shipped_at,old.shipped_by,old.transit_warehouse_id) then raise exception ''Jejak pengiriman hanya ditulis oleh proses kirim/batal kirim barang''; end if;\n  if old.status=''Dikirim'' and new.status=''Disetujui'' then raise exception ''Pembatalan pengiriman dicatat lewat tombol Batalkan pengiriman, supaya stok transit ikut kembali''; end if;')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Batal pengiriman: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Batal pengiriman: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
end $patch$;

-- ACL fungsi privat tidak berubah oleh create or replace, tetapi ditegaskan ulang.
revoke all on function public.guard_stock_request_write() from public, anon, authenticated;
revoke all on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) from public, anon;
grant execute on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pemeriksaan akhir -- gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
 if to_regprocedure('public.cancel_stock_transfer(uuid,uuid,text)') is null then
  raise exception 'RPC pembatalan pemindahan tidak terpasang'; end if;
 if to_regprocedure('public.cancel_stock_request_shipment(uuid,uuid,text)') is null then
  raise exception 'RPC pembatalan pengiriman permintaan tidak terpasang'; end if;
 d := pg_get_functiondef('public.cancel_stock_transfer(uuid,uuid,text)'::regprocedure);
 if position('from stock_transfers where id = p_transfer_id for update' in d) = 0
  or position('''transfer-batal''' in d) = 0
  or position('d.source_transfer_id = v_doc.id' in d) = 0
  or position('stock_document_access(v_from.branch_id, ''pos'')' in d) = 0 then
  raise exception 'Pembatalan pemindahan kehilangan kunci baris / pagar penerimaan / pagar izin'; end if;
 d := pg_get_functiondef('public.cancel_stock_request_shipment(uuid,uuid,text)'::regprocedure);
 if position('from stock_requests where id = p_id for update' in d) = 0
  or position('''batal-kirim-permintaan''' in d) = 0
  or position('from stock_receipts where stock_request_id = p_id' in d) = 0 then
  raise exception 'Pembatalan pengiriman permintaan kehilangan kunci baris / pagar penerimaan'; end if;
 d := pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure);
 if position('''transfer-batal'', ''batal-kirim-permintaan''' in d) = 0 then
  raise exception 'Sumber mutasi pembatalan belum dipagari'; end if;
 d := pg_get_functiondef('public.guard_stock_request_write()'::regprocedure);
 if position('Pembatalan pengiriman dicatat lewat tombol Batalkan pengiriman' in d) = 0 then
  raise exception 'Penjaga permintaan masih mengizinkan Dikirim -> Disetujui lewat browser'; end if;
 -- Pemindahan antar gudang tidak pernah menjurnal; pembatalannya pun tidak boleh.
 if exists (select 1 from journal_entries where source in ('transfer', 'transfer-batal', 'kirim-permintaan', 'batal-kirim-permintaan')) then
  raise exception 'Pemindahan barang tidak seharusnya punya jurnal; rekonsiliasi dulu sebelum pembatalan dipasang'; end if;
 if exists (select 1 from pg_policy where polrelid = 'public.stock_transfers'::regclass and polcmd <> 'r') then
  raise exception 'stock_transfers tidak boleh punya policy tulis; stempel pembatalan harus lewat RPC'; end if;
end $check$;
