-- F1 (meeting 12 Nov 2026, keputusan Reza: A) — akun selisih stok opname & laporan hasil opname.
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
-- Hanya posting BARU yang berubah. Jurnal, stok, lapisan, dan snapshot lama TIDAK disentuh.
--
-- RANCANGAN
--  1. Pemetaan akun tunggal public.stock_opname_account() mendapat peran baru 'gain' = 810004
--     Pendapatan Diluar Operasional Lain (Pendapatan Lain-lain). 'variance' tetap 720010 Beban
--     Selisih Stok (dipakai sisi kurang), 'inventory' tetap 170001 Persediaan.
--  2. Posting opname (post_opname_atomic) dan penyesuaian persediaan (post_inventory_adjustment_atomic)
--     — keduanya memakai pasangan akun yang sama — sekarang:
--       selisih LEBIH : Dr 170001 / Cr 810004   (dulu Cr 720010)
--       selisih KURANG: Dr 720010 / Cr 170001   (tetap)
--     Selisih lebih tetap dinilai harga beli master barang (perilaku lama; nilai stok masuk = nilai jurnal).
--  3. Selisih kurang yang memakai lapisan stok tanpa harga (unit_cost 0) tidak lagi lolos tanpa jurnal:
--     stock_out_fifo menilai kuantitas tanpa harga itu dengan harga taksiran yang SAMA dengan penjualan
--     (harga lapisan terakhir yang terpakai > riwayat masuk terakhir > harga beli master). Nilai itu
--     ikut tercatat di mutasi stok dan bukti pengeluaran, jadi jurnal = mutasi = snapshot laporan.
--     Bila tidak ada harga sama sekali (semua 0), posting DITOLAK dengan pesan agar harga beli diisi.
--     Mode average sudah memakai harga pokok efektif yang sama; nol berarti tidak ada harga → ditolak.
--  4. Koreksi stok resmi (stock_correction_plan / correct_stock_document) dibuat konsisten:
--     jurnal sumber boleh memakai 810004 (posting baru) maupun 720010 (posting lama); pengganti
--     menulis lebih → Cr 810004, kurang → Dr 720010. Koreksi yang selisih kurangnya memakai lapisan
--     tanpa harga DITOLAK dengan pesan (tidak menilai 0 diam-diam). Pembalikan jurnal asal tetap persis.
--  5. Snapshot laporan (capture_opname_price_report) mengikuti metode: bila average aktif, HPP selisih
--     diambil dari nilai yang benar-benar dijurnal (bukti pengeluaran / harga beli masuk), bukan kosong.
--  6. RPC baca baru public.read_opname_price_recap(uuid[]) untuk rekap periode di Laporan › Hasil Opname
--     (hak akses sama dengan read_opname_price_report: OWNER/FINANCE aktif + izin cabang).
--
-- DAMPAK
--  - Laba Rugi: selisih lebih opname/penyesuaian baru masuk Pendapatan Lain-lain (810004), tidak lagi
--    mengurangi Beban Selisih Stok. Dua opname November (keduanya minus) tidak berubah.
--  - Opname/penyesuaian yang barangnya tidak punya harga sama sekali akan ditolak sampai harga beli diisi.
--  - Koreksi atas dokumen lama yang selisih lebihnya di 720010: jurnal asal dibalik apa adanya,
--    jurnal pengganti (tanggal koreksi) memakai kebijakan baru.
--
-- ROLLBACK (bila perlu; tidak ada data yang harus dipulihkan)
--  - Terapkan migrasi baru yang membalik tambalan di bagian 3 (tukar old_text/new_text) pada
--    post_opname_atomic, post_inventory_adjustment_atomic, stock_out_fifo, stock_correction_plan,
--    correct_stock_document; pasang ulang capture_opname_price_report dari
--    20261025110500_opname_price_snapshot_report.sql; drop function public.read_opname_price_recap(uuid[]).
--  - stock_opname_account('gain') boleh dibiarkan (tidak dipakai bila fungsi di atas dibalik).
--  - Jurnal yang sudah terposting ke 810004 setelah migrasi ini tetap ada; reklas manual oleh Finance.

-- ---------------------------------------------------------------------------
-- 1. Pemeriksaan awal — gagal tertutup bila kontrak sumber berubah
-- ---------------------------------------------------------------------------
do $$ begin
 if to_regprocedure('public.stock_opname_account(text)') is null
  or to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or to_regprocedure('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)') is null
  or to_regprocedure('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)') is null
  or to_regprocedure('public.stock_correction_plan(text,uuid,jsonb)') is null
  or to_regprocedure('public.correct_stock_document(text,uuid,jsonb,text,text,text)') is null
  or to_regprocedure('public.capture_opname_price_report()') is null
  or to_regprocedure('public.read_opname_price_report(uuid)') is null
  or to_regclass('public.stock_document_issue_proofs') is null
  or public.stock_opname_account('inventory') is distinct from '170001'
  or public.stock_opname_account('variance') is distinct from '720010'
 then raise exception 'F1_SOURCE_CHANGED: tinjau ulang kontrak posting opname/penyesuaian';end if;
 if not exists(select 1 from public.coa_accounts where code='810004' and not is_header) then
  raise exception 'F1_AKUN_810004: akun Pendapatan Diluar Operasional Lain (810004) belum ada sebagai akun rincian';end if;
 if position('''Metode average; HPP FIFO tidak tersedia''' in pg_get_functiondef('public.capture_opname_price_report()'::regprocedure))=0 then
  raise exception 'F1_SOURCE_CHANGED: snapshot harga opname sudah berubah sejak I05';end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Pemetaan akun tunggal
-- ---------------------------------------------------------------------------
create or replace function public.stock_opname_account(p_role text) returns text
language sql immutable set search_path='' as $$
 select case p_role when 'inventory' then '170001' when 'variance' then '720010' when 'gain' then '810004' end
$$;
revoke all on function public.stock_opname_account(text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Tambalan jangkar eksak pada definisi yang sedang berjalan
--    (tiap jangkar harus muncul tepat sebanyak yang diharapkan; satu fungsi dikompilasi sekali)
-- ---------------------------------------------------------------------------
do $patch$
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text; found_count integer;
begin
 for p in select * from (values
  -- 3a. Posting opname: akun lebih -> 810004.
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E' acc_inventory text:=public.stock_opname_account(''inventory'');acc_variance text:=public.stock_opname_account(''variance'');\nbegin',
   E' acc_inventory text:=public.stock_opname_account(''inventory'');acc_variance text:=public.stock_opname_account(''variance'');\n acc_gain text:=public.stock_opname_account(''gain'');\nbegin'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'jsonb_build_object(''code'',acc_inventory,''debit'',gain,''credit'',0),jsonb_build_object(''code'',acc_variance,''debit'',0,''credit'',gain)',
   E'jsonb_build_object(''code'',acc_inventory,''debit'',gain,''credit'',0),jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',gain)'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E' -- Lebih = kredit beban selisih persediaan; kurang = debit akun yang sama.',
   E' -- F1 (Nov 2026): lebih = kredit Pendapatan Lain-lain (stock_opname_account(''gain''));\n -- kurang = debit Beban Selisih Stok (stock_opname_account(''variance'')).'),
  -- 3b. Posting opname: selisih kurang tanpa harga sama sekali ditolak, bukan dilewati tanpa jurnal.
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'   if cost is null or cost<0 or cost::text in(''NaN'',''Infinity'',''-Infinity'') then raise exception ''Biaya pengeluaran opname tidak valid'';end if;',
   E'   if cost is null or cost<0 or cost::text in(''NaN'',''Infinity'',''-Infinity'') then raise exception ''Biaya pengeluaran opname tidak valid'';end if;\n   if cost=0 then raise exception ''Harga modal barang % belum ada (stok, riwayat pembelian, dan harga beli master semuanya 0). Isi harga beli barang ini dulu, lalu posting ulang opname.'',r.name;end if;'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'''warehouse_policy'',''uniform-variance-expense'',''variance_account'',acc_variance,',
   E'''warehouse_policy'',''variance-loss-expense-gain-income'',''variance_account'',acc_variance,''gain_account'',acc_gain,'),

  -- 3c. Penyesuaian persediaan: pasangan akun yang sama, kebijakan yang sama.
  ('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)', 1,
   E' acc_inventory text:=public.stock_opname_account(''inventory'');acc_variance text:=public.stock_opname_account(''variance'');\nbegin',
   E' acc_inventory text:=public.stock_opname_account(''inventory'');acc_variance text:=public.stock_opname_account(''variance'');\n acc_gain text:=public.stock_opname_account(''gain'');\nbegin'),
  ('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)', 1,
   E' if (select count(*) from public.coa_accounts where code in(acc_inventory,acc_variance) and is_active and not is_header)<>2 then\n  raise exception ''Akun persediaan % / selisih % belum tersedia atau tidak aktif. Penyesuaian tidak diposting.'',acc_inventory,acc_variance;end if;',
   E' if (select count(*) from public.coa_accounts where code in(acc_inventory,acc_variance,acc_gain) and is_active and not is_header)<>3 then\n  raise exception ''Akun persediaan % / selisih % / pendapatan lain-lain % belum tersedia atau tidak aktif. Penyesuaian tidak diposting.'',acc_inventory,acc_variance,acc_gain;end if;'),
  ('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)', 1,
   E'jsonb_build_object(''code'',acc_inventory,''debit'',masuk,''credit'',0),jsonb_build_object(''code'',acc_variance,''debit'',0,''credit'',masuk)',
   E'jsonb_build_object(''code'',acc_inventory,''debit'',masuk,''credit'',0),jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',masuk)'),
  ('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)', 1,
   E'   if cost is null or cost<0 or cost::text in(''NaN'',''Infinity'',''-Infinity'') then raise exception ''Biaya pengeluaran penyesuaian tidak valid'';end if;',
   E'   if cost is null or cost<0 or cost::text in(''NaN'',''Infinity'',''-Infinity'') then raise exception ''Biaya pengeluaran penyesuaian tidak valid'';end if;\n   if cost=0 then raise exception ''Harga modal barang % belum ada (stok, riwayat pembelian, dan harga beli master semuanya 0). Isi harga beli barang ini dulu, lalu simpan ulang penyesuaian.'',(select i.name from public.items i where i.id=r.item_id);end if;'),
  ('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)', 1,
   E'''inventory_account'',acc_inventory,''variance_account'',acc_variance,''already_posted'',false',
   E'''inventory_account'',acc_inventory,''variance_account'',acc_variance,''gain_account'',acc_gain,''already_posted'',false'),

  -- 3d. Stok keluar opname/penyesuaian: kuantitas dari lapisan tanpa harga dinilai harga taksiran yang
  --     sama dengan penjualan, dan nilainya ikut di mutasi/bukti (bukan hanya di jurnal).
  ('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)', 1,
   E'    if v_layer.unit_cost = 0 and p_source in (''sale'', ''sale-group'', ''sale-online'') then',
   E'    if v_layer.unit_cost = 0 and p_source in (''sale'', ''sale-group'', ''sale-online'', ''opname'', ''penyesuaian'') then'),

  -- 3e. Perencana koreksi: terima akun lebih baru (810004) di jurnal sumber; sisi lawan dinilai gabungan.
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E'(a.code not in(''170001'',''720010'') or j.debit<0',
   E'(a.code not in(''170001'',''720010'',''810004'') or j.debit<0'),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E'coalesce(sum(j.debit-j.credit) filter(where a.code=''720010''),0) into inventory,contra',
   E'coalesce(sum(j.debit-j.credit) filter(where a.code in(''720010'',''810004'')),0) into inventory,contra'),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E' if exists(select 1 from public.coa_accounts a where a.code in(''170001'',''720010'') and (',
   E' if exists(select 1 from (values(''170001''::text,array[''170001'']),(''720010''::text,array[''720010'',''810004''])) a(code,codes) where ('),
  ('public.stock_correction_plan(text,uuid,jsonb)', 2,
   E'from public.journal_lines j where j.account_id=a.id and j.entry_id in(',
   E'from public.journal_lines j where j.account_id in(select c.id from public.coa_accounts c where c.code=any(a.codes)) and j.entry_id in('),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E' perform 1 from public.coa_accounts where code in(''170001'',''720010'') and is_active and not is_header order by code for share;',
   E' perform 1 from public.coa_accounts where code in(''170001'',''720010'',''810004'') and is_active and not is_header order by code for share;'),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E' if (select count(*) from public.coa_accounts where code in(''170001'',''720010'') and is_active and not is_header)<>2 then raise exception ''Akun persediaan/selisih tidak aktif'';end if;',
   E' if (select count(*) from public.coa_accounts where code in(''170001'',''720010'',''810004'') and is_active and not is_header)<>3 then raise exception ''Akun persediaan/selisih/pendapatan lain-lain tidak aktif'';end if;'),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E'  if needed>0 then raise exception ''Lapisan FIFO tidak cukup untuk koreksi'';end if;',
   E'  if needed>0 then raise exception ''Lapisan FIFO tidak cukup untuk koreksi'';end if;\n  if new_diff<0 and exists(select 1 from jsonb_to_recordset(takes)x(unit_cost numeric) where x.unit_cost=0) then raise exception ''Selisih kurang koreksi untuk % memakai stok tanpa harga modal. Koreksi tidak menilai 0 diam-diam; rekonsiliasi harga lewat Finance dulu.'',r.name;end if;'),

  -- 3f. Jurnal pengganti koreksi: lebih -> Cr 810004, kurang -> Dr 720010; tidak ada baris nol.
  ('public.correct_stock_document(text,uuid,jsonb,text,text,text)', 1,
   E'or (a.code=''720010'' and v.amount>0) then abs(v.amount) else 0 end',
   E'or (a.code=''810004'' and v.amount>0) then abs(v.amount) else 0 end'),
  ('public.correct_stock_document(text,uuid,jsonb,text,text,text)', 1,
   E'cross join public.coa_accounts a where a.code in(''170001'',''720010'') and v.amount<>0;',
   E'cross join public.coa_accounts a where v.amount<>0 and (a.code=''170001'' or (a.code=''720010'' and v.amount<0) or (a.code=''810004'' and v.amount>0));')
 ) as patches(sig, expected, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'F1: fungsi wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  found_count := (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text);
  if found_count <> p.expected then
   raise exception 'F1: jangkar harus muncul % kali (ditemukan %) di %: %', p.expected, found_count, p.sig, left(p.old_text, 90);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
end $patch$;

-- create or replace mempertahankan ACL, tetapi ditegaskan ulang sesuai migrasi asal.
revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;
revoke all on function public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb) from public,anon,service_role;
grant execute on function public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb) to authenticated;
revoke all on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) from public,anon;
grant execute on function public.stock_out_fifo(uuid,uuid,numeric,text,text,date) to authenticated;
revoke all on function public.stock_correction_plan(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.correct_stock_document(text,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_stock_document(text,uuid,jsonb,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Snapshot laporan harga opname mengikuti metode HPP (FIFO / average)
--    Nilai modal = nilai yang dijurnal: kurang = bukti pengeluaran (FIFO atau average, termasuk
--    taksiran untuk lapisan tanpa harga); lebih = harga beli master yang dipakai stok masuk.
-- ---------------------------------------------------------------------------
create or replace function public.capture_opname_price_report() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_wh public.warehouses%rowtype; v_order public.opname_orders%rowtype;
 v_item record; v_stock numeric; v_avg numeric; v_layer_qty numeric; v_layer_value numeric;
 v_issue_cost numeric; v_unpriced boolean; v_sale numeric; v_code text; v_rows jsonb:='[]'; v_method text;
 v_label text; v_unit numeric; v_after_value numeric;
begin
 select * into v_order from public.opname_orders where id=new.order_id;
 select * into v_wh from public.warehouses where id=v_order.warehouse_id;
 if v_order.id is null or v_wh.id is null or new.result_id is null
  or not exists(select 1 from public.opname_results r where r.id=new.result_id and r.order_id=new.order_id)
  or jsonb_typeof(new.source_snapshot->'rows') is distinct from 'array'
  or jsonb_array_length(new.source_snapshot->'rows')=0 then
  raise exception 'Snapshot sumber opname belum lengkap';end if;
 select method into v_method from public.inventory_costing_settings where id=true;
 if v_method not in ('fifo','moving_average') or v_method is null then raise exception 'Metode biaya opname tidak tersedia';end if;
 v_label:=case when v_method='fifo' then 'FIFO' else 'average' end;
 for v_item in
  select * from jsonb_to_recordset(new.source_snapshot->'rows') as x(
   item_id uuid,qty_sistem numeric,qty_fisik numeric,selisih numeric,
   buy_price numeric,sell_price numeric,name text,unit text)
 loop
  if v_item.item_id is null or v_item.qty_sistem is null or v_item.qty_fisik is null
   or v_item.selisih is null or v_item.unit is null or v_item.buy_price is null
   or v_item.sell_price is null or v_item.selisih is distinct from v_item.qty_fisik-v_item.qty_sistem
   or v_item.buy_price<0 or v_item.sell_price<0
   or v_item.qty_sistem::text in ('NaN','Infinity','-Infinity')
   or v_item.qty_fisik::text in ('NaN','Infinity','-Infinity')
   or v_item.selisih::text in ('NaN','Infinity','-Infinity')
   or v_item.buy_price::text in ('NaN','Infinity','-Infinity')
   or v_item.sell_price::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Baris harga opname tidak lengkap';end if;
  select s.qty,s.average_cost into v_stock,v_avg from public.stock s
   where s.warehouse_id=v_wh.id and s.item_id=v_item.item_id;
  select coalesce(sum(l.qty_left),0),coalesce(sum(l.qty_left*l.unit_cost),0)
   into v_layer_qty,v_layer_value from public.stock_layers l
   where l.warehouse_id=v_wh.id and l.item_id=v_item.item_id;
  if v_stock is null or greatest(v_stock,0) is distinct from v_layer_qty
   or v_layer_value<0 or v_stock::text in ('NaN','Infinity','-Infinity')
   or v_layer_qty::text in ('NaN','Infinity','-Infinity')
   or v_layer_value::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Nilai lapisan opname tidak konsisten';end if;
  v_issue_cost:=null;v_unpriced:=false;
  if v_item.selisih<0 then
   select (p.result->>'cost')::numeric,
    exists(select 1 from jsonb_array_elements(p.takes) t where (t->>'unit_cost')::numeric=0)
    into v_issue_cost,v_unpriced
    from public.stock_document_issue_proofs p
    where p.kind='opname' and p.document_id=new.result_id and p.item_id=v_item.item_id;
   if v_issue_cost is null or v_issue_cost<0
    or v_issue_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'HPP % selisih opname belum lengkap',v_label;end if;
  end if;
  select coalesce((select bp.sell_price from public.item_branch_prices bp
    where bp.item_id=v_item.item_id and bp.branch_id=v_wh.branch_id and bp.unit=v_item.unit),
   v_item.sell_price) into v_sale;
  select code into v_code from public.items where id=v_item.item_id;
  if v_sale is null or v_sale<0 or v_sale::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Harga jual cabang opname tidak valid';end if;
  if v_code is null then raise exception 'Kode barang opname tidak tersedia';end if;
  -- Nilai/modal stok setelah posting: FIFO = nilai lapisan; average = qty x harga pokok average.
  v_after_value:=case when v_stock<0 then null when v_method='fifo' then v_layer_value
   when v_stock=0 then 0 when v_avg is not null then v_stock*v_avg else null end;
  v_unit:=case when v_item.selisih<0 then v_issue_cost/(-v_item.selisih)
   when v_item.selisih>0 then v_item.buy_price
   when v_stock>0 and v_after_value is not null then v_after_value/v_stock else null end;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
   'item_id',v_item.item_id,'code',v_code,'name',v_item.name,'unit',v_item.unit,
   'qty_sistem',v_item.qty_sistem,'qty_fisik',v_item.qty_fisik,'selisih',v_item.selisih,
   'qty_stok_setelah',v_stock,'nilai_lapisan_setelah',v_after_value::text,
   'modal_satuan',v_unit::text,
   'sumber_modal',case when v_item.selisih<0 then 'HPP '||v_label||' selisih keluar per unit'
     when v_item.selisih>0 then 'Biaya masuk/acuan PO yang dijurnal per unit'
     when v_stock<0 then 'Stok negatif; modal '||case when v_method='fifo' then 'lapisan FIFO' else 'average' end||' tidak tersedia'
     when v_unit is null then 'Tidak tersedia'
     when v_method='fifo' then 'Rata-rata nilai lapisan FIFO setelah posting'
     else 'Harga pokok average setelah posting' end,
   'hpp_selisih_keluar',v_issue_cost::text,
   'nilai_selisih_modal',case when v_item.selisih<0 then (-v_issue_cost)::text
     when v_item.selisih>0 then (v_item.selisih*v_item.buy_price)::text else '0' end,
   'sumber_nilai_modal',case when v_item.selisih<0 then 'HPP '||v_label||' keluar yang dijurnal'
       ||case when v_method='fifo' and v_unpriced then ' (stok tanpa harga dinilai harga beli terakhir)' else '' end
     when v_item.selisih>0 then 'Biaya masuk dari acuan PO yang dijurnal'
     else 'Tidak ada selisih' end,
   'harga_jual_cabang',v_sale::text,'nilai_selisih_jual',(v_item.selisih*v_sale)::text));
 end loop;
 new.source_snapshot:=jsonb_set(new.source_snapshot,'{price_report}',jsonb_build_object(
  'version',1,'method',v_method,'branch_id',v_wh.branch_id,'warehouse_id',v_wh.id,
  'scope',case when exists(select 1 from public.opname_order_items where order_id=new.order_id)
   then 'Sebagian' else 'Seluruh' end,'rows',v_rows));
 return new;
end $$;
revoke all on function public.capture_opname_price_report() from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. Rekap periode lintas dokumen (hanya baca; agregat dari snapshot posting asal)
-- ---------------------------------------------------------------------------
create or replace function public.read_opname_price_recap(p_result_ids uuid[]) returns jsonb
language plpgsql security definer stable set search_path='' as $$
declare v_role text; v_out jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or p_result_ids is null then
  raise exception 'Akses laporan opname ditolak' using errcode='42501';end if;
 select role::text into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role not in ('OWNER','FINANCE') or v_role is null then
  raise exception 'Akses laporan opname ditolak' using errcode='42501';end if;
 if v_role<>'OWNER' and exists(select 1 from public.role_modules where role=v_role::public.user_role)
  and not exists(select 1 from public.role_modules where role=v_role::public.user_role and module_id='laporan') then
  raise exception 'Akses modul laporan ditolak' using errcode='42501';end if;
 if cardinality(p_result_ids)>5000 then raise exception 'Terlalu banyak hasil opname; persempit periode laporan';end if;
 if exists(select 1 from unnest(p_result_ids) x(id)
   left join public.opname_results r on r.id=x.id
   left join public.opname_orders o on o.id=r.order_id
   left join public.warehouses w on w.id=o.warehouse_id
   where x.id is null or w.branch_id is null or not public.user_can_access_branch(w.branch_id)) then
  raise exception 'Cabang laporan opname ditolak' using errcode='42501';end if;
 if exists(select 1 from public.opname_posting_receipts p
   join public.opname_results r on r.id=p.result_id and r.order_id=p.order_id
   join public.opname_orders o on o.id=r.order_id
   where p.result_id=any(p_result_ids) and p.source_snapshot ? 'price_report'
    and ((p.source_snapshot->'price_report'->>'branch_id')::uuid is distinct from (select w.branch_id from public.warehouses w where w.id=o.warehouse_id)
     or (p.source_snapshot->'price_report'->>'warehouse_id')::uuid is distinct from o.warehouse_id)) then
  raise exception 'Snapshot harga opname tidak cocok dengan cabang asal';end if;
 select coalesce(jsonb_agg(x order by x->>'result_id'),'[]') into v_out from (
  select jsonb_build_object('result_id',r.id,
   'snapshot',rep is not null,
   'method',rep->>'method',
   'revision',(select max(c.revision) from public.stock_document_corrections c where c.kind='opname' and c.document_id=r.id),
   'rows',coalesce(a.row_count,0),
   'plus_count',coalesce(a.plus_count,0),'minus_count',coalesce(a.minus_count,0),
   'plus_modal',coalesce(a.plus_modal,0)::text,'minus_modal',coalesce(a.minus_modal,0)::text,
   'plus_jual',coalesce(a.plus_jual,0)::text,'minus_jual',coalesce(a.minus_jual,0)::text,
   'modal_missing',coalesce(a.modal_missing,0)) x
  from (select distinct id from unnest(p_result_ids) u(id)) ids
  join public.opname_results r on r.id=ids.id
  left join public.opname_posting_receipts p on p.result_id=r.id and p.order_id=r.order_id
  left join lateral (select p.source_snapshot->'price_report' rep) s on true
  left join lateral (
   select count(*) row_count,
    count(*) filter(where (e->>'selisih')::numeric>0) plus_count,
    count(*) filter(where (e->>'selisih')::numeric<0) minus_count,
    sum((e->>'nilai_selisih_modal')::numeric) filter(where (e->>'selisih')::numeric>0) plus_modal,
    sum((e->>'nilai_selisih_modal')::numeric) filter(where (e->>'selisih')::numeric<0) minus_modal,
    sum((e->>'nilai_selisih_jual')::numeric) filter(where (e->>'selisih')::numeric>0) plus_jual,
    sum((e->>'nilai_selisih_jual')::numeric) filter(where (e->>'selisih')::numeric<0) minus_jual,
    count(*) filter(where (e->>'selisih')::numeric<>0 and (e->'nilai_selisih_modal' is null or jsonb_typeof(e->'nilai_selisih_modal')='null')) modal_missing
   from jsonb_array_elements(case when jsonb_typeof(rep->'rows')='array' then rep->'rows' else '[]'::jsonb end) e
  ) a on true
 ) q;
 return v_out;
end $$;
revoke all on function public.read_opname_price_recap(uuid[]) from public,anon,service_role;
grant execute on function public.read_opname_price_recap(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pemeriksaan akhir — gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
 if public.stock_opname_account('gain') is distinct from '810004' then raise exception 'F1: pemetaan akun lebih belum 810004';end if;
 d:=pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure);
 if position('jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',gain)' in d)=0
  or position('jsonb_build_object(''code'',acc_variance,''debit'',0,''credit'',gain)' in d)>0
  or position('if cost=0 then raise exception' in d)=0 then raise exception 'F1: posting opname belum memakai akun lebih/penolakan HPP 0';end if;
 d:=pg_get_functiondef('public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb)'::regprocedure);
 if position('jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',masuk)' in d)=0
  or position('if cost=0 then raise exception' in d)=0 then raise exception 'F1: penyesuaian belum memakai akun lebih/penolakan HPP 0';end if;
 d:=pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure);
 if position('''sale-online'', ''opname'', ''penyesuaian''' in d)=0 then raise exception 'F1: stok keluar opname tanpa harga belum dinilai';end if;
 d:=pg_get_functiondef('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure);
 if position('(a.code=''810004'' and v.amount>0)' in d)=0 then raise exception 'F1: jurnal pengganti koreksi belum memakai 810004';end if;
 if not has_function_privilege('authenticated','public.read_opname_price_recap(uuid[])','EXECUTE')
  or has_function_privilege('anon','public.read_opname_price_recap(uuid[])','EXECUTE') then
  raise exception 'F1: ACL rekap opname salah';end if;
end $check$;
