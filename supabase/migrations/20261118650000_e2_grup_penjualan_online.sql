-- E2 (meeting 12 Nov 2026, keputusan owner "A" 14 Nov 2026): BARANG GRUP (PAKET/BUNDLING) DI PENJUALAN ONLINE.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
-- Bundling Shopee dipetakan ke barang Grup yang sudah ada (SKU Shopee = kode Grup); stok & HPP dari isi paketnya.
--
-- RANCANGAN (mengikuti cara kasir petshop memposting baris Grup)
--  * post_online_order (definisi live, ditambal lewat jangkar teks persis):
--    1. Baris Grup tidak lagi ditolak. Syarat: satuan DASAR paket saja (faktor 1; satuan lain ditolak E2_GRUP_SATUAN),
--       paket punya isi (E2_GRUP_KOSONG), dan isinya masih sah: barang aktif, bukan Grup, faktor satuan isi sama dengan
--       master (E2_GRUP_RUSAK). Resep dibaca dari item_group_components (resep "terbuka" yang dipakai kasir; Grup
--       bertingkat sudah dibuka di sana) dan dikunci FOR SHARE supaya tidak berubah di tengah posting.
--    2. Cek stok dihitung per barang fisik: barang biasa (qty x faktor) + isi paket (qty paket x qty isi x faktor isi),
--       digabung bila barang yang sama muncul di baris biasa dan di paket. Urutan kunci stok tetap per item_id.
--       Kekurangan isi paket menyebut nama barang, kebutuhan, dan stok tersedia; pesan barang biasa tetap "Stok tidak cukup".
--    3. Baris Grup diposting oleh fungsi internal baru public.online_post_group_line: satu sale_items (harga Shopee,
--       omzet di baris paket), snapshot sale_item_group_components per isi, stok keluar per isi Persediaan dari gudang
--       order (stock_out_fifo, sumber 'sale-online' sama dengan barang online biasa; FIFO atau moving average mengikuti
--       pengaturan), stock_moves.sale_line_id = baris paket, HPP isi (dibulatkan 2 desimal per isi, sama dengan kasir) dan
--       HPP baris paket = jumlah HPP isi. Jurnal HPP online memakai jumlah HPP mentah (sama dengan barang online biasa).
--       Isi Jasa/Non-Persediaan ikut di snapshot tanpa stok dan HPP 0.
--  * assert_sale_group_cost_links (dipakai cancel_posted_sale): selain sumber 'sale-group' (kasir), juga membaca mutasi
--    'sale-online' yang terhubung ke baris paket, sehingga pembatalan order online berisi paket memeriksa lalu
--    mengembalikan stok tiap isi ke lapisan FIFO asalnya. Mutasi 'sale-online' tanpa sale_line_id (barang biasa) tidak
--    disentuh; penjualan kasir tidak punya mutasi 'sale-online' sehingga perilakunya sama persis.
--  * Retur: penjualan online memang TIDAK bisa diretur (return_record_post_base menolak "Struk tidak ditemukan atau online";
--    halaman retur hanya mencari struk kasir). Tidak diubah. Koreksi order online = Batalkan (Owner), yang kini
--    mengembalikan stok isi paket. Jalur retur kasir untuk Grup (per isi dari snapshot) tidak berubah.
--  * Tanpa pagar harga minimum (jual di bawah HPP) untuk paket online — sama dengan barang online biasa (tidak ada pagar).
--
-- DAMPAK: order online lama tidak berubah. Order baru yang memuat barang Grup kini tersimpan (sebelumnya ditolak
-- "Grup tidak didukung pada online"). Barang biasa: jalur, pesan, stok, HPP, dan jurnal sama persis.
-- Semua tambalan memeriksa jangkar persis (jumlah kemunculan tepat); bila definisi database berbeda, transaksi gagal
-- tanpa perubahan. Dipasang ulang = tidak berubah (penanda E2_GRUP_ONLINE sudah ada).
--
-- ROLLBACK (satu transaksi): docs/runbooks/e2-grup-online/rollback.sql — penggantian kebalikan yang mengembalikan teks asli
-- kedua fungsi (diuji: md5 definisi sama dengan sebelum migrasi) lalu drop public.online_post_group_line. Ditolak bila sudah
-- ada order online berisi paket yang belum dibatalkan (order itu tidak akan bisa dibatalkan sesudah rollback).
set local lock_timeout='5s';

-- ───────────── 1. Fungsi internal posting baris paket online ─────────────
create or replace function public.online_post_group_line(p_sale uuid,p_ref text,p_warehouse uuid,p_date date,p_item uuid,p_nama text,p_qty numeric,p_harga numeric,p_satuan text,p_faktor numeric)
returns numeric language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;line uuid;snap uuid;c record;issued record;prior uuid[];raw numeric:=0;n integer:=0;linked integer;
begin
 -- Hanya dipanggil post_online_order sebelum jurnal penjualan online ditulis (EXECUTE dicabut dari semua peran klien).
 select * into s from public.sales where id=p_sale and no_struk=p_ref for update;
 if not found or s.channel is null or s.voided_at is not null or s.payments_finalized_at is not null
  or exists(select 1 from public.journal_entries where source in('sale-online','sale-online-hpp') and source_ref=p_ref) then
  raise exception 'E2_GRUP_SUMBER: penjualan online tidak valid untuk paket' using errcode='55000';
 end if;
 if not exists(select 1 from public.items where id=p_item and item_type='Grup') then raise exception 'E2_GRUP_SUMBER: barang bukan paket Grup' using errcode='22023';end if;
 if p_qty is null or p_qty<=0 or p_faktor is distinct from 1::numeric then
  raise exception 'E2_GRUP_SATUAN: paket "%" hanya bisa dijual dengan satuan dasarnya.',p_nama using errcode='22023';
 end if;
 insert into public.sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(p_sale,p_item,p_nama,p_qty,p_harga,p_satuan,p_faktor,0) returning id into line;
 for c in select gc.component_item_id,gc.qty,gc.unit,gc.factor,gc.sort_order,ci.code,ci.name,coalesce(ci.item_type,'Persediaan') item_type
   from public.item_group_components gc join public.items ci on ci.id=gc.component_item_id
   where gc.group_item_id=p_item order by gc.sort_order,gc.id loop
  if c.item_type not in('Persediaan','Jasa','Non-Persediaan') then raise exception 'E2_GRUP_RUSAK: isi paket "%" tidak valid. Perbaiki rincian Grup di master barang.',p_nama using errcode='22023';end if;
  insert into public.sale_item_group_components(sale_item_id,component_item_id,component_code,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp,sort_order)
   values(line,c.component_item_id,c.code,c.name,c.item_type,c.qty,c.unit,c.factor,p_qty*p_faktor*c.qty*c.factor,0,c.sort_order) returning id into snap;
  n:=n+1;
  if c.item_type='Persediaan' then
   select coalesce(array_agg(id),'{}'::uuid[]) into prior from public.stock_moves where source_ref=p_ref and source='sale-online' and item_id=c.component_item_id;
   select * into issued from public.stock_out_fifo(p_warehouse,c.component_item_id,p_qty*p_faktor*c.qty*c.factor,'sale-online',p_ref,p_date);
   if issued.shortfall>0 then raise exception 'Lapisan stok tidak cukup untuk HPP FIFO' using errcode='22003';end if;
   -- Hubungkan mutasi isi ke baris paket (sama seperti kasir 'sale-group'); dipakai pembatalan untuk mencocokkan HPP.
   update public.stock_moves set sale_line_id=line where source_ref=p_ref and source='sale-online' and item_id=c.component_item_id and id<>all(prior);
   get diagnostics linked=row_count;
   if linked<>1 then raise exception 'E2_GRUP_SUMBER: mutasi isi paket tidak terhubung' using errcode='55000';end if;
   update public.sale_item_group_components set hpp=round(coalesce(issued.cost,0),2) where id=snap;
   raw:=raw+coalesce(issued.cost,0);
  end if;
 end loop;
 if n=0 then raise exception 'E2_GRUP_KOSONG: paket "%" belum punya isi. Lengkapi rincian Grup di master barang.',p_nama using errcode='22023';end if;
 update public.sale_items set hpp=round(raw,2) where id=line;
 return raw;
end $$;
revoke all on function public.online_post_group_line(uuid,text,uuid,date,uuid,text,numeric,numeric,text,numeric) from public,anon,authenticated,service_role;

-- ───────────── 2. Tambalan post_online_order & assert_sale_group_cost_links ─────────────
do $patch$
declare definition text; signature text; anchors text[]; replacements text[]; i integer;
begin
 signature:='public.post_online_order(text,jsonb,jsonb)';
 definition:=pg_get_functiondef(signature::regprocedure);
 if position('E2_GRUP_ONLINE' in definition)>0 then
  raise notice 'E2: post_online_order sudah mendukung Grup — dilewati.';
 else
  anchors:=array[
   -- 2a. tolakan lama -> validasi paket
   $a$  if coalesce(it.item_type,'Persediaan')='Grup' then raise exception 'Grup tidak didukung pada online';end if;$a$,
   -- 2b. cek stok -> termasuk isi paket
   $a$ for r in select x.item_id,sum(x.qty*x.faktor) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' group by x.item_id order by x.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
 end loop;$a$,
   -- 2c. posting baris -> baris paket lewat online_post_group_line
   $a$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$a$];
  replacements:=array[
   $r$  if coalesce(it.item_type,'Persediaan')='Grup' then -- E2_GRUP_ONLINE: paket dijual per satuan dasar; isi dari resep master
   if u.factor<>1 then raise exception 'E2_GRUP_SATUAN: paket "%" hanya bisa dijual per % (satuan dasar paket).',it.name,u.unit using errcode='22023';end if;
   perform 1 from public.item_group_components gc where gc.group_item_id=r.item_id order by gc.id for share;
   if not found then raise exception 'E2_GRUP_KOSONG: paket "%" belum punya isi. Lengkapi rincian Grup di master barang.',it.name using errcode='22023';end if;
   if exists(select 1 from public.item_group_components gc left join public.items ci on ci.id=gc.component_item_id where gc.group_item_id=r.item_id
     and (ci.id is null or not ci.is_active or coalesce(ci.item_type,'Persediaan')='Grup' or gc.qty is null or gc.qty<=0
      or gc.factor is distinct from (case when lower(gc.unit)=lower(coalesce(nullif(ci.unit,''),'pcs')) then 1::numeric else (select f.factor from public.item_units f where f.item_id=ci.id and lower(f.unit)=lower(gc.unit) order by f.factor limit 1) end))) then
    raise exception 'E2_GRUP_RUSAK: isi paket "%" memuat barang nonaktif atau satuan yang sudah berubah. Perbaiki rincian Grup di master barang.',it.name using errcode='22023';
   end if;
  end if;$r$,
   $r$ for r in select y.item_id,sum(y.qty) qty,bool_or(y.grup) grup,min(y.nama) nama from (
   select x.item_id,x.qty*x.faktor qty,false grup,i.name::text nama from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan'
   union all -- E2_GRUP_ONLINE: kebutuhan isi paket = qty paket x faktor x qty isi x faktor satuan isi
   select gc.component_item_id,x.qty*x.faktor*gc.qty*gc.factor,true,ci.name::text from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id and i.item_type='Grup' join public.item_group_components gc on gc.group_item_id=x.item_id join public.items ci on ci.id=gc.component_item_id where coalesce(ci.item_type,'Persediaan')='Persediaan'
  ) y group by y.item_id order by y.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then
   if r.grup then raise exception 'Stok tidak cukup untuk isi paket: % (butuh %, tersedia %)',r.nama,trim_scale(r.qty),trim_scale(coalesce(stockqty,0)) using errcode='22003';end if;
   raise exception 'Stok tidak cukup' using errcode='22003';
  end if;
 end loop;$r$,
   $r$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  if exists(select 1 from public.items where id=r.item_id and item_type='Grup') then -- E2_GRUP_ONLINE
   cost:=public.online_post_group_line(doc,no,wh.id,d,r.item_id,r.nama,r.qty,r.harga,r.satuan,r.faktor);hpp:=hpp+cost;continue;
  end if;
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$r$];
  for i in 1..array_length(anchors,1) loop
   if position(anchors[i] in definition)=0 or length(definition)-length(replace(definition,anchors[i],''))<>length(anchors[i]) then
    raise exception 'E2_MIGRATION_ANCHOR_MISMATCH: post_online_order jangkar %',i;
   end if;
   definition:=replace(definition,anchors[i],replacements[i]);
  end loop;
  execute definition;
 end if;

 signature:='public.assert_sale_group_cost_links(uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 if position('E2_GRUP_ONLINE' in definition)>0 then
  raise notice 'E2: assert_sale_group_cost_links sudah membaca mutasi online — dilewati.';
 else
  -- 2d. mutasi online yang terhubung ke baris wajib milik isi paket (pemeriksaan sama dengan 'sale-group').
  anchors:=array[$a$ m.source_ref=ref and m.source='sale-group' and not exists($a$];
  replacements:=array[$r$ m.source_ref=ref and (m.source='sale-group' or (m.source='sale-online' and m.sale_line_id is not null)) /* E2_GRUP_ONLINE */ and not exists($r$];
  if position(anchors[1] in definition)=0 or length(definition)-length(replace(definition,anchors[1],''))<>length(anchors[1]) then
   raise exception 'E2_MIGRATION_ANCHOR_MISMATCH: assert_sale_group_cost_links jangkar 1';
  end if;
  definition:=replace(definition,anchors[1],replacements[1]);
  -- 2e. jumlah & HPP isi per baris paket: sumber kasir 'sale-group' ATAU online 'sale-online' (dua kemunculan persis).
  anchors:=array[$a$m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id$a$];
  replacements:=array[$r$m.source_ref=ref and m.source in('sale-group','sale-online') and m.sale_line_id=r.id$r$];
  if length(definition)-length(replace(definition,anchors[1],''))<>2*length(anchors[1]) then
   raise exception 'E2_MIGRATION_ANCHOR_MISMATCH: assert_sale_group_cost_links jangkar 2';
  end if;
  definition:=replace(definition,anchors[1],replacements[1]);
  execute definition;
 end if;
end $patch$;
