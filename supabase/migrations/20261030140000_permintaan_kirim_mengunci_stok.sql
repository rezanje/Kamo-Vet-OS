-- Permintaan barang: kekurangan stok dihentikan DI GUDANG PENGIRIM, bukan di cabang penerima.
--
-- Laporan Andri (28 Oktober 2026): cabang minta 500 pcs, gudang cuma punya 250 pcs, tetapi
-- tombol "Tandai Dikirim" tetap bisa ditekan. Barang baru ditolak saat cabang menekan
-- "Terima barang" -- di situ pesan "Stok gudang asal tidak cukup" muncul. Penyebabnya:
-- sebelum tambalan ini, status "Dikirim" hanya mengganti label; stok gudang pengirim tidak
-- pernah keluar, dan satu-satunya pemeriksaan stok ada di RPC penerimaan.
--
-- Sesudah tambalan ini:
--   1. PERSETUJUAN  -- qty disetujui yang melebihi stok gudang pengirim ditolak dengan pesan
--      per barang (diminta vs tersedia). Gudang harus menurunkan angkanya.
--   2. PENGIRIMAN   -- status "Dikirim" hanya lahir dari RPC ship_stock_request_atomic yang
--      MENGELUARKAN stok gudang pengirim ke gudang TRANSIT dalam transaksi yang sama,
--      memakai primitif FIFO yang sama dengan Pemindahan Barang. Dua pengiriman tidak bisa
--      memakai stok yang sama: barisnya dikunci (for update) sebelum dipindahkan.
--      Kiriman sebagian diizinkan (qty kirim <= qty disetujui dan <= stok tersedia).
--   3. PENERIMAAN   -- stok masuk cabang diambil dari TRANSIT, bukan lagi dari gudang
--      pengirim. Sisa kiriman yang tidak diterima (rusak/kurang/diterima sebagian)
--      dikembalikan dari TRANSIT ke gudang pengirim supaya tidak ada stok nyangkut.
--
-- Semua perubahan pada RPC yang sudah berjalan memakai jangkar eksak di atas definisi
-- berjalan (pg_get_functiondef + replace) dan gagal tertutup bila definisinya sudah berubah.
-- Migrasi lama tidak diubah. Tidak ada data yang diubah saat migrasi (pra-pemeriksaan
-- 28 Okt di Production: 3 permintaan -- 2 Selesai, 1 Disetujui, 0 Dikirim; 0 saldo stok negatif).

-- ---------------------------------------------------------------------------
-- 1. Kolom jejak pengiriman
-- ---------------------------------------------------------------------------
alter table public.stock_requests
  add column shipped_at timestamptz,
  add column shipped_by uuid references public.profiles(id),
  add column transit_warehouse_id uuid references public.warehouses(id);
alter table public.stock_request_items add column qty_dikirim numeric;
comment on column public.stock_request_items.qty_dikirim is
  'Jumlah yang benar-benar keluar dari gudang pengirim (satuan dokumen). Plafon penerimaan cabang.';
comment on column public.stock_requests.transit_warehouse_id is
  'Terisi sejak permintaan dikirim lewat gudang transit; permintaan lama (null) diterima langsung dari gudang pengirim.';

-- ---------------------------------------------------------------------------
-- 2. Penolong: angka ramah-manusia dan pesan kekurangan stok per barang
-- ---------------------------------------------------------------------------
create function public.stock_qty_text(p numeric) returns text
language sql immutable set search_path='' as $$
  select case
    when p is null then '0'
    when round(p,6)=trunc(round(p,6)) then trunc(round(p,6))::text
    else rtrim(to_char(round(p,6),'FM9999999999999990.999999'),'0') end
$$;
revoke all on function public.stock_qty_text(numeric) from public,anon,authenticated,service_role;

-- Dipakai persetujuan dan pengiriman. p_lock=true mengunci baris saldo gudang pengirim
-- dalam urutan item_id -- urutan yang sama dengan stock_transfer_fifo_exact, supaya dua
-- transaksi tidak saling mengunci terbalik. Baris dengan barang sama dijumlahkan dulu,
-- jadi dua baris @150 pcs tidak lolos berdua terhadap stok 250 pcs.
create function public.stock_request_shortage(p_request_id uuid,p_rows jsonb,p_lock boolean)
returns text language plpgsql security definer set search_path=public as $$
declare v_req stock_requests%rowtype; v_row record; v_available numeric; v_msg text:='';
begin
 select * into v_req from stock_requests where id=p_request_id;
 if not found then raise exception 'Permintaan tidak ditemukan'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rincian permintaan tidak valid'; end if;
 for v_row in
  select i.item_id,min(i.nama) nama,min(coalesce(i.satuan,'')) satuan,
   max(coalesce(nullif(i.faktor,0),1)) faktor,
   sum(x.qty*coalesce(nullif(i.faktor,0),1)) need
  from jsonb_to_recordset(p_rows) x(id uuid,qty numeric)
  join stock_request_items i on i.id=x.id and i.request_id=p_request_id
  where x.qty is not null and x.qty>0 and i.item_id is not null
  group by i.item_id order by i.item_id
 loop
  if p_lock then
   insert into stock(warehouse_id,item_id,qty) values(v_req.to_warehouse_id,v_row.item_id,0) on conflict(warehouse_id,item_id) do nothing;
   select qty into v_available from stock where warehouse_id=v_req.to_warehouse_id and item_id=v_row.item_id for update;
  else
   select qty into v_available from stock where warehouse_id=v_req.to_warehouse_id and item_id=v_row.item_id;
  end if;
  v_available:=greatest(coalesce(v_available,0),0);
  if v_row.need>v_available then
   v_msg:=v_msg||case when v_msg='' then '' else '; ' end||v_row.nama
     ||' butuh '||stock_qty_text(v_row.need/v_row.faktor)||' '||v_row.satuan
     ||', tersedia '||stock_qty_text(v_available/v_row.faktor)||' '||v_row.satuan;
  end if;
 end loop;
 return nullif(btrim(v_msg),'');
end $$;
revoke all on function public.stock_request_shortage(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC pengiriman: stok keluar gudang pengirim saat ditandai "Dikirim"
-- ---------------------------------------------------------------------------
create function public.ship_stock_request_atomic(p_id uuid,p_rows jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v_req stock_requests%rowtype; v_branch uuid; v_transit uuid; v_short text;
 v_row record; v_line stock_request_items%rowtype; v_total numeric:=0;
begin
 select * into v_req from stock_requests where id=p_id for update;
 if not found then raise exception 'Permintaan tidak ditemukan'; end if;
 if v_req.status<>'Disetujui' then raise exception 'Hanya permintaan Disetujui yang bisa dikirim (sekarang %)',v_req.status; end if;
 select branch_id into v_branch from warehouses where id=v_req.to_warehouse_id and is_active and type<>'TRANSIT';
 if v_branch is null then raise exception 'Gudang pengirim tidak aktif'; end if;
 perform stock_document_access(v_branch,'pos');
 if not exists(select 1 from profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')) then
  raise exception 'Hanya Kepala Gudang / Manajer yang bisa mengirim'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0
  or jsonb_array_length(p_rows)<>(select count(*) from stock_request_items where request_id=p_id)
  or (select count(*) from jsonb_to_recordset(p_rows) x(id uuid))<>(select count(distinct id) from jsonb_to_recordset(p_rows) x(id uuid)) then
  raise exception 'Rincian pengiriman harus lengkap dan unik'; end if;
 for v_row in select * from jsonb_to_recordset(p_rows) x(id uuid,qty numeric) order by id loop
  select * into v_line from stock_request_items where id=v_row.id and request_id=p_id for update;
  if not found or v_row.qty is null or v_row.qty::text in ('NaN','Infinity','-Infinity') or v_row.qty<0
   or v_row.qty>coalesce(v_line.qty_disetujui,v_line.qty_diminta) then
   raise exception 'Qty kirim tidak valid; maksimal sebanyak qty yang disetujui'; end if;
  v_total:=v_total+v_row.qty;
 end loop;
 if v_total<=0 then raise exception 'Tidak ada barang yang dikirim. Isi minimal satu jumlah lebih dari 0'; end if;
 -- Kekurangan dihentikan DI SINI, bukan di cabang penerima. Saldo gudang pengirim
 -- dikunci lebih dulu, jadi dua pengiriman tidak bisa menghabiskan stok yang sama.
 v_short:=stock_request_shortage(p_id,p_rows,true);
 if v_short is not null then
  raise exception 'Stok gudang pengirim tidak cukup. %. Kurangi jumlah kirim atau tunggu stok masuk',v_short
   using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtext('vetos:transit-warehouse')::bigint);
 select id into v_transit from warehouses where type='TRANSIT' and is_active order by id limit 1;
 if v_transit is null then
  insert into warehouses(branch_id,code,name,type) values(v_branch,'TRANSIT','Transit (VetOS System)','TRANSIT') returning id into v_transit; end if;
 for v_row in
  select x.id,x.qty,i.item_id,coalesce(nullif(i.faktor,0),1) faktor
  from jsonb_to_recordset(p_rows) x(id uuid,qty numeric)
  join stock_request_items i on i.id=x.id and i.request_id=p_id order by i.item_id,x.id
 loop
  update stock_request_items set qty_dikirim=v_row.qty where id=v_row.id;
  if v_row.qty>0 then
   perform stock_transfer_fifo_exact(v_req.to_warehouse_id,v_transit,v_row.item_id,v_row.qty*v_row.faktor,
    'kirim-permintaan',left(coalesce(v_req.no_request,p_id::text),40),(now() at time zone 'Asia/Jakarta')::date);
  end if;
 end loop;
 update stock_requests set status='Dikirim',shipped_at=now(),shipped_by=auth.uid(),transit_warehouse_id=v_transit where id=p_id;
end $$;
revoke all on function public.ship_stock_request_atomic(uuid,jsonb) from public,anon,service_role;
grant execute on function public.ship_stock_request_atomic(uuid,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tambalan jangkar eksak pada RPC/trigger yang sudah berjalan
-- ---------------------------------------------------------------------------
do $patch$
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI.
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- (a) Persetujuan menolak qty di atas stok gudang pengirim, dengan rincian per barang.
  ('public.approve_stock_request_atomic(uuid,jsonb)',
   E'declare v_req stock_requests%rowtype; v_branch uuid; v_row record;',
   E'declare v_req stock_requests%rowtype; v_branch uuid; v_row record; v_short text;'),
  ('public.approve_stock_request_atomic(uuid,jsonb)',
   E' update stock_requests set status=''Disetujui'',approved_by=auth.uid() where id=p_id;',
   E' v_short:=stock_request_shortage(p_id,p_rows,false);\n if v_short is not null then raise exception ''Stok gudang pengirim tidak cukup. %. Turunkan jumlah yang disetujui'',v_short using errcode=''55000''; end if;\n update stock_requests set status=''Disetujui'',approved_by=auth.uid() where id=p_id;'),
  -- (b) Penerimaan mengambil dari gudang transit dan mengembalikan sisanya ke gudang pengirim.
  ('public.receive_stock_request_atomic(uuid,uuid,jsonb)',
   E'declare v_req stock_requests%rowtype; v_receipt uuid; v_number text; v_wh uuid; v_line stock_request_items%rowtype; v_row record; v_difference numeric:=0; v_payload jsonb;',
   E'declare v_req stock_requests%rowtype; v_receipt uuid; v_number text; v_wh uuid; v_line stock_request_items%rowtype; v_row record; v_difference numeric:=0; v_payload jsonb; v_from uuid; v_retur numeric;'),
  ('public.receive_stock_request_atomic(uuid,uuid,jsonb)',
   E' if v_wh is null or not exists(select 1 from warehouses where id=v_req.to_warehouse_id and is_active) or v_wh=v_req.to_warehouse_id then raise exception ''Gudang pengiriman/penerimaan tidak valid''; end if;',
   E' if v_wh is null or not exists(select 1 from warehouses where id=v_req.to_warehouse_id and is_active) or v_wh=v_req.to_warehouse_id then raise exception ''Gudang pengiriman/penerimaan tidak valid''; end if;\n v_from:=coalesce(v_req.transit_warehouse_id,v_req.to_warehouse_id);\n if not exists(select 1 from warehouses where id=v_from and is_active) then raise exception ''Gudang asal pengiriman tidak aktif''; end if;'),
  ('public.receive_stock_request_atomic(uuid,uuid,jsonb)',
   E'v_row.qty_diterima>coalesce(v_line.qty_disetujui,v_line.qty_diminta)',
   E'v_row.qty_diterima>coalesce(v_line.qty_dikirim,v_line.qty_disetujui,v_line.qty_diminta)'),
  ('public.receive_stock_request_atomic(uuid,uuid,jsonb)',
   E'  if v_row.kondisi=''baik'' and v_row.qty_diterima>0 then perform stock_transfer_fifo_exact(v_req.to_warehouse_id,v_wh,v_line.item_id,v_row.qty_diterima*v_line.faktor,''terima-permintaan'',p_request_id::text,(now() at time zone ''Asia/Jakarta'')::date); end if;',
   E'  if v_row.kondisi=''baik'' and v_row.qty_diterima>0 then perform stock_transfer_fifo_exact(v_from,v_wh,v_line.item_id,v_row.qty_diterima*v_line.faktor,''terima-permintaan'',p_request_id::text,(now() at time zone ''Asia/Jakarta'')::date); end if;\n  if v_req.transit_warehouse_id is not null then\n   v_retur:=coalesce(v_line.qty_dikirim,0)*v_line.faktor-(case when v_row.kondisi=''baik'' then v_row.qty_diterima*v_line.faktor else 0 end);\n   if v_retur>0 then perform stock_transfer_fifo_exact(v_req.transit_warehouse_id,v_req.to_warehouse_id,v_line.item_id,v_retur,''retur-permintaan'',p_request_id::text,(now() at time zone ''Asia/Jakarta'')::date); end if;\n  end if;'),
  -- (c) Browser tidak lagi bisa menandai "Dikirim" lewat update tabel biasa.
  ('public.guard_stock_request_write()',
   E'if not ((old.status=''Menunggu Persetujuan'' and new.status in (''Disetujui'',''Ditolak'')) or (old.status=''Disetujui'' and new.status=''Dikirim'')) then raise exception ''Transisi permintaan tidak valid''; end if;',
   E'if old.status=''Disetujui'' and new.status=''Dikirim'' then raise exception ''Pengiriman dicatat lewat layar Kirim barang, supaya stok gudang pengirim ikut keluar''; end if;\n   if not (old.status=''Menunggu Persetujuan'' and new.status in (''Disetujui'',''Ditolak'')) then raise exception ''Transisi permintaan tidak valid''; end if;'),
  -- (c2) Jejak pengiriman dan qty kirim tidak dapat dikarang lewat browser.
  ('public.guard_stock_request_write()',
   E'or new.approved_by is not null or not public.user_can_access_branch(new.from_branch_id)',
   E'or new.approved_by is not null or new.shipped_at is not null or new.shipped_by is not null or new.transit_warehouse_id is not null or not public.user_can_access_branch(new.from_branch_id)'),
  ('public.guard_stock_request_write()',
   E'if new.from_branch_id is distinct from old.from_branch_id or new.to_warehouse_id is distinct from old.to_warehouse_id or new.requested_by is distinct from old.requested_by or new.no_request is distinct from old.no_request then raise exception ''Cabang/gudang sumber permintaan tidak dapat diubah''; end if;',
   E'if new.from_branch_id is distinct from old.from_branch_id or new.to_warehouse_id is distinct from old.to_warehouse_id or new.requested_by is distinct from old.requested_by or new.no_request is distinct from old.no_request then raise exception ''Cabang/gudang sumber permintaan tidak dapat diubah''; end if;\n  if (new.shipped_at,new.shipped_by,new.transit_warehouse_id) is distinct from (old.shipped_at,old.shipped_by,old.transit_warehouse_id) then raise exception ''Jejak pengiriman hanya ditulis oleh proses kirim barang''; end if;'),
  ('public.guard_stock_request_write()',
   E'new.qty_diterima is not null or new.qty_disetujui is not null',
   E'new.qty_diterima is not null or new.qty_disetujui is not null or new.qty_dikirim is not null'),
  -- (d) Pesan kekurangan stok menyebut barang, jumlah perlu, dan jumlah tersedia.
  ('public.stock_transfer_fifo_exact(uuid,uuid,uuid,numeric,text,text,date)',
   E' if v_qty<p_qty then raise exception ''Stok gudang asal tidak cukup''; end if;',
   E' if v_qty<p_qty then raise exception ''Stok gudang asal tidak cukup: % perlu %, tersedia %'',(select name from items where id=p_item),stock_qty_text(p_qty),stock_qty_text(greatest(v_qty,0)) using errcode=''55000''; end if;'),
  -- (e) Sumber mutasi baru ikut dipagari dari pemanggilan langsung lewat browser.
  ('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)',
   E'  if current_user = ''authenticated'' and p_source in (''terima-permintaan'', ''transfer'') then',
   E'  if current_user = ''authenticated'' and p_source in (''terima-permintaan'', ''transfer'', ''kirim-permintaan'', ''retur-permintaan'') then')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Kirim permintaan: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Kirim permintaan: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
end $patch$;

-- ACL fungsi privat tidak berubah oleh create or replace, tetapi ditegaskan ulang.
revoke all on function public.guard_stock_request_write() from public,anon,authenticated;
revoke all on function public.stock_transfer_fifo_exact(uuid,uuid,uuid,numeric,text,text,date) from public,anon,authenticated;
revoke all on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) from public,anon;
grant execute on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pemeriksaan akhir -- gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
 d := pg_get_functiondef('public.approve_stock_request_atomic(uuid,jsonb)'::regprocedure);
 if position('stock_request_shortage(p_id,p_rows,false)' in d)=0 then
  raise exception 'Persetujuan tidak memeriksa stok gudang pengirim'; end if;
 d := pg_get_functiondef('public.receive_stock_request_atomic(uuid,uuid,jsonb)'::regprocedure);
 if position('stock_transfer_fifo_exact(v_from,v_wh' in d)=0
  or position('''retur-permintaan''' in d)=0
  or position('coalesce(v_line.qty_dikirim,v_line.qty_disetujui,v_line.qty_diminta)' in d)=0 then
  raise exception 'Penerimaan belum memakai gudang transit'; end if;
 d := pg_get_functiondef('public.guard_stock_request_write()'::regprocedure);
 if position('Pengiriman dicatat lewat layar Kirim barang' in d)=0
  or position('Jejak pengiriman hanya ditulis oleh proses kirim barang' in d)=0
  or position('new.qty_dikirim is not null' in d)=0 then
  raise exception 'Penjaga permintaan masih mengizinkan tandai Dikirim lewat browser'; end if;
 d := pg_get_functiondef('public.stock_transfer_fifo_exact(uuid,uuid,uuid,numeric,text,text,date)'::regprocedure);
 if position('Stok gudang asal tidak cukup: % perlu %, tersedia %' in d)=0 then
  raise exception 'Pesan kekurangan stok pemindahan belum rinci'; end if;
 d := pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure);
 if position('''kirim-permintaan'', ''retur-permintaan''' in d)=0 then
  raise exception 'Sumber mutasi pengiriman permintaan belum dipagari'; end if;
 if to_regprocedure('public.ship_stock_request_atomic(uuid,jsonb)') is null then
  raise exception 'RPC pengiriman permintaan tidak terpasang'; end if;
end $check$;
