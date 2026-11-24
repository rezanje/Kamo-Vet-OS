-- SO-SURPLUS-HPP (Andri 24 Nov 2026: "perbaiki ya, jadi pakai hpp rata2, mengurangi stok minus, di kartu stok juga harus tercantum barang +nya").
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
-- Hanya posting BARU (dan koreksi opname baru) yang berubah. Jurnal, lapisan, mutasi, snapshot, dan stok lama TIDAK disentuh.
--
-- AKAR MASALAH (dibuktikan dari data Production 24 Nov)
--  Selisih LEBIH opname dinilai items.buy_price (harga beli master). Untuk barang yang HPP-nya hidup di lapisan stok
--  (master 0) nilainya Rp0: lapisan 'opname' unit_cost 0 (107 lapisan, ~4.968 unit), gain_cost 0 -> TIDAK ADA jurnal lebih;
--  nilai persediaan, HPP saat dijual, dan laba salah. Hanya selisih kurang yang dijurnal.
--
-- RANCANGAN
--  1. public.opname_surplus_cost(gudang, barang, harga master): satu aturan biaya untuk selisih lebih
--       (a) mode average aktif: stock.average_cost > 0;
--       (b) rata-rata tertimbang sisa lapisan berharga (qty_left * unit_cost / qty_left, unit_cost > 0) di gudang itu;
--       (c) harga lapisan/mutasi masuk berharga terakhir di gudang itu (sama dengan inventory_effective_unit_cost);
--       (d) rata-rata tertimbang sisa lapisan berharga di gudang lain untuk barang yang sama;
--       (e) harga beli master; (f) tidak ada harga sama sekali -> Rp0 DAN ditandai (surplus_unpriced), tidak diam-diam.
--     Tambah stok pada harga rata-rata tidak mengubah rata-ratanya (stock_in_fifo / trigger average yang sama dipakai).
--  2. post_opname_atomic: satu jurnal neto per dokumen. Kurang: Dr 720010 / Cr 170001 (FIFO, TIDAK berubah).
--       Lebih: Dr 170001 / Cr 720010 sebesar selisih kurang yang ada (mengurangi beban), sisanya Cr 810004.
--       Hanya-kurang dan hanya-lebih-tanpa-lapisan-berharga tetap IDENTIK dengan perilaku lama (jurnal, deskripsi, akun).
--     Kuitansi/snapshot menyimpan nilai kotor + neto; baris lebih di snapshot laporan membawa HPP yang dipakai.
--  3. Koreksi opname (stock_correction_plan/correct_stock_document): kuantitas tambahan dinilai HPP rata-rata (dulu harga master,
--     sehingga koreksi menambah lapisan Rp0 tanpa jurnal); jurnal pengganti memakai aturan neto yang sama. Tanggal jurnal koreksi
--     tetap hari ini (pembalikan jurnal asal + pengganti), seperti mekanisme koreksi yang ada.
--  4. Beban ke karyawan (kasbon) TIDAK diubah: dasar hanya selisih kurang (debit 720010 jurnal asal tetap = nilai kurang kotor).
--
-- ROLLBACK: pasang ulang definisi lama dari ROLLBACK.sql (4 fungsi) lalu drop function public.opname_surplus_cost(uuid,uuid,numeric).
--           Jurnal/lapisan yang sudah terbentuk setelah migrasi ini tetap ada (data, bukan struktur).

do $pre$ begin
 if to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or to_regprocedure('public.stock_correction_plan(text,uuid,jsonb)') is null
  or to_regprocedure('public.correct_stock_document(text,uuid,jsonb,text,text,text)') is null
  or to_regprocedure('public.capture_opname_price_report()') is null
  or to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is null
  or to_regprocedure('public.stock_layer_cost_was_reversed(uuid)') is null
  or to_regprocedure('public.stock_move_cost_was_reversed(uuid)') is null
  or public.stock_opname_account('inventory') is distinct from '170001'
  or public.stock_opname_account('variance') is distinct from '720010'
  or public.stock_opname_account('gain') is distinct from '810004'
 then raise exception 'SO_SURPLUS_HPP_SOURCE_CHANGED: tinjau ulang kontrak posting opname'; end if;
 if (select count(*) from public.coa_accounts where code in('170001','720010','810004') and is_active and not is_header)<>3 then
  raise exception 'SO_SURPLUS_HPP_AKUN: akun 170001/720010/810004 harus aktif sebagai akun rincian'; end if;
end $pre$;

-- 1. Aturan biaya selisih lebih (internal; hanya dipanggil fungsi DEFINER lain).
create or replace function public.opname_surplus_cost(p_warehouse uuid,p_item uuid,p_master numeric)
returns table(unit_cost numeric,source text)
language plpgsql security definer set search_path=''
as $fn$
declare v_method text;v_cost numeric;v_today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 perform admin_online_private.deny_admin_online();
 select method into v_method from public.inventory_costing_settings where id;
 if v_method='moving_average' then
  select s.average_cost into v_cost from public.stock s where s.warehouse_id=p_warehouse and s.item_id=p_item;
  if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata bergerak gudang'::text; return;end if;
 end if;
 select sum(l.qty_left*l.unit_cost)/sum(l.qty_left) into v_cost from public.stock_layers l
  where l.warehouse_id=p_warehouse and l.item_id=p_item and l.qty_left>0 and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);
 if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'::text; return;end if;
 select known.unit_cost into v_cost from (
   select l.unit_cost,l.tanggal,l.created_at,0 priority,l.id,l.source,l.source_ref from public.stock_layers l
    where l.warehouse_id=p_warehouse and l.item_id=p_item and l.unit_cost>0 and l.tanggal<=v_today and not public.stock_layer_cost_was_reversed(l.id)
   union all
   select m.unit_cost,m.tanggal,m.created_at,1 priority,m.id,m.source,m.source_ref from public.stock_moves m
    where m.warehouse_id=p_warehouse and m.item_id=p_item and m.qty>0 and m.unit_cost>0 and m.tanggal<=v_today and m.source not in('sale-void','purchase-invoice-void') and not public.stock_move_cost_was_reversed(m.id)
  ) known where not exists(select 1 from public.purchase_invoices i where known.source='faktur-langsung' and i.no_faktur=known.source_ref and i.voided_at is not null)
  order by known.tanggal desc,known.created_at desc,known.priority,known.id desc limit 1;
 if v_cost>0 then return query select round(v_cost,6),'harga masuk terakhir gudang'::text; return;end if;
 select sum(l.qty_left*l.unit_cost)/sum(l.qty_left) into v_cost from public.stock_layers l
  where l.item_id=p_item and l.warehouse_id<>p_warehouse and l.qty_left>0 and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);
 if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata gudang lain'::text; return;end if;
 if p_master>0 then return query select p_master,'harga beli master'::text; return;end if;
 return query select 0::numeric,'tanpa harga'::text;
end $fn$;
revoke all on function public.opname_surplus_cost(uuid,uuid,numeric) from public,anon,authenticated,service_role;

-- 2-3. Tambalan jangkar eksak pada definisi yang sedang berjalan (tiap jangkar harus muncul tepat 1 kali; gagal tertutup).
do $patch$
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text; found_count integer;
begin
 for p in select * from (values
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'recount text;\nbegin',
   E'recount text;\n sur_cost numeric;sur_src text;offset_amt numeric:=0;scost jsonb:=''{}'';unpriced jsonb:=''[]'';\nbegin'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'   perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,r.buy_price,''opname'',ref,p_tanggal,null);\n   gain:=gain+r.selisih*r.buy_price;\n',
   E'   -- SO-SURPLUS-HPP: selisih lebih dinilai HPP rata-rata barang di gudang ini (bukan harga beli master yang sering 0).\n   select c.unit_cost,c.source into sur_cost,sur_src from public.opname_surplus_cost(wh.id,r.item_id,r.buy_price) c;\n   perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,sur_cost,''opname'',ref,p_tanggal,null);\n   gain:=gain+round(r.selisih*sur_cost,2);\n   scost:=scost||jsonb_build_object(r.item_id::text,jsonb_build_object(''cost'',sur_cost,''source'',sur_src));\n   if sur_cost=0 then unpriced:=unpriced||jsonb_build_array(jsonb_build_object(''item_id'',r.item_id,''name'',r.name,''qty'',r.selisih));end if;\n'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E' -- I02 (28 Okt 2026): satu kebijakan untuk semua cabang (toko & klinik).\n -- F1 (Nov 2026): lebih = kredit Pendapatan Lain-lain (stock_opname_account(''gain''));\n -- kurang = debit Beban Selisih Stok (stock_opname_account(''variance'')).\n -- Tidak ada lagi faktur/piutang ke toko pusat untuk posting baru.\n if gain>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,''opname'',ref,''Selisih lebih stok opname ''||ref||'' (''||doc.no_opname||'')'',jsonb_build_array(jsonb_build_object(''code'',acc_inventory,''debit'',gain,''credit'',0),jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',gain))));end if;\n if loss>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,''opname'',ref,''Selisih kurang stok opname ''||ref||'' (''||doc.no_opname||'')'',jsonb_build_array(jsonb_build_object(''code'',acc_variance,''debit'',loss,''credit'',0),jsonb_build_object(''code'',acc_inventory,''debit'',0,''credit'',loss))));end if;\n',
   E' -- I02 (28 Okt 2026): satu kebijakan untuk semua cabang (toko & klinik).\n -- SO-SURPLUS-HPP: SATU jurnal neto per dokumen. Kurang = Dr Beban Selisih Stok (720010) / Cr Persediaan;\n -- lebih (HPP rata-rata) = Dr Persediaan / Cr 720010 sebesar selisih kurang yang ada dulu (mengurangi beban),\n -- sisanya (lebih > kurang) = Cr Pendapatan Lain-lain (810004). Nilai kotor tetap terbaca di garis jurnal.\n if gain>0 or loss>0 then\n  offset_amt:=least(gain,loss);\n  je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,''opname'',ref,\n   case when gain>0 and loss>0 then ''Selisih stok opname ''||ref||'' (''||doc.no_opname||''): kurang Rp ''||trim_scale(round(loss,2))::text||'', lebih Rp ''||trim_scale(round(gain,2))::text||'', neto ''||case when loss>=gain then ''kurang'' else ''lebih'' end||'' Rp ''||trim_scale(abs(round(loss-gain,2)))::text\n        when loss>0 then ''Selisih kurang stok opname ''||ref||'' (''||doc.no_opname||'')''\n        else ''Selisih lebih stok opname ''||ref||'' (''||doc.no_opname||'')'' end,\n   (case when loss>0 then jsonb_build_array(jsonb_build_object(''code'',acc_variance,''debit'',loss,''credit'',0),jsonb_build_object(''code'',acc_inventory,''debit'',0,''credit'',loss)) else ''[]''::jsonb end)\n   ||(case when gain>0 then jsonb_build_array(jsonb_build_object(''code'',acc_inventory,''debit'',gain,''credit'',0),jsonb_build_object(''code'',acc_variance,''debit'',0,''credit'',offset_amt),jsonb_build_object(''code'',acc_gain,''debit'',0,''credit'',gain-offset_amt)) else ''[]''::jsonb end)));\n end if;\n'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'receipt:=jsonb_build_object(''result_id'',result_id,''no_hasil'',ref,''tanggal'',p_tanggal,''no_faktur'',invoice_no,''journal_ids'',to_jsonb(je),''counted_items'',cardinality(ids),''already_posted'',false);',
   E'-- Foto baris untuk laporan harga: baris lebih membawa HPP yang benar-benar dipakai (harga master disimpan terpisah).\n select coalesce(jsonb_agg(case when (e->>''selisih'')::numeric>0 then e||jsonb_build_object(''master_buy_price'',e->''buy_price'',''buy_price'',(scost->(e->>''item_id'')->>''cost'')::numeric,''surplus_cost_source'',scost->(e->>''item_id'')->>''source'') else e end order by ord),''[]''::jsonb)\n  into rows from jsonb_array_elements(rows) with ordinality t(e,ord);\n receipt:=jsonb_build_object(''result_id'',result_id,''no_hasil'',ref,''tanggal'',p_tanggal,''no_faktur'',invoice_no,''journal_ids'',to_jsonb(je),''counted_items'',cardinality(ids),''already_posted'',false,\n  ''shortage_value'',round(loss,2),''surplus_value'',round(gain,2),''surplus_offset'',round(offset_amt,2),''net_variance'',round(loss-gain,2),''surplus_unpriced'',unpriced);'),
  ('public.post_opname_atomic(uuid,date,jsonb)', 1,
   E'''gain_cost'',gain,''loss_cost'',loss,',
   E'''gain_cost'',gain,''loss_cost'',loss,''gain_offset'',offset_amt,''net_variance'',loss-gain,''surplus_rule'',''hpp-rata-rata-v1'',''surplus_unpriced'',unpriced,'),
  ('public.stock_correction_plan(text,uuid,jsonb)', 1,
   E'  value:=case when new_diff>0 then new_diff*buy else -cost end;\n',
   E'  if new_diff>0 and p_kind=''opname'' then select c.unit_cost into buy from public.opname_surplus_cost(wh,r.item_id,buy) c;end if;\n  value:=case when new_diff>0 then new_diff*buy else -cost end;\n'),
  ('public.correct_stock_document(text,uuid,jsonb,text,text,text)', 1,
   E'  insert into public.journal_lines(entry_id,account_id,debit,credit)\n   select replacement,a.id,case when (a.code=''170001'' and v.amount>0) or (a.code=''720010'' and v.amount<0) then abs(v.amount) else 0 end,\n   case when (a.code=''170001'' and v.amount<0) or (a.code=''810004'' and v.amount>0) then abs(v.amount) else 0 end\n   from (select sum((x->>''value'')::numeric) amount from jsonb_array_elements(plan->''lines'')x group by sign((x->>''value'')::numeric))v cross join public.coa_accounts a where v.amount<>0 and (a.code=''170001'' or (a.code=''720010'' and v.amount<0) or (a.code=''810004'' and v.amount>0));\n',
   E'  declare pos numeric;neg numeric;off numeric;\n  begin\n   select coalesce(sum((x->>''value'')::numeric) filter(where (x->>''value'')::numeric>0),0),coalesce(-sum((x->>''value'')::numeric) filter(where (x->>''value'')::numeric<0),0) into pos,neg from jsonb_array_elements(plan->''lines'')x;\n   off:=least(pos,neg);\n   insert into public.journal_lines(entry_id,account_id,debit,credit)\n    select replacement,a.id,v.d,v.c from (values(''170001''::text,pos,0::numeric),(''170001'',0::numeric,neg),(''720010'',neg,0::numeric),(''720010'',0::numeric,off),(''810004'',0::numeric,pos-off)) v(code,d,c)\n    join public.coa_accounts a on a.code=v.code where v.d<>0 or v.c<>0;\n  end;\n'),
  ('public.capture_opname_price_report()', 1,
   E'''Biaya masuk/acuan PO yang dijurnal per unit''',
   E'''HPP rata-rata (selisih lebih) yang dijurnal per unit'''),
  ('public.capture_opname_price_report()', 1,
   E'''Biaya masuk dari acuan PO yang dijurnal''',
   E'''HPP rata-rata stok masuk yang dijurnal''')
 ) as patches(sig, expected, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'SO_SURPLUS_HPP: fungsi wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  found_count := (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text);
  if found_count <> p.expected then
   raise exception 'SO_SURPLUS_HPP: jangkar harus muncul % kali (ditemukan %) di %: %', p.expected, found_count, p.sig, left(p.old_text, 90);
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
revoke all on function public.stock_correction_plan(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.correct_stock_document(text,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_stock_document(text,uuid,jsonb,text,text,text) to authenticated;

do $check$
begin
 if position('opname_surplus_cost' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
  or position('hpp-rata-rata-v1' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
  or position('opname_surplus_cost' in pg_get_functiondef('public.stock_correction_plan(text,uuid,jsonb)'::regprocedure))=0
  or position('off:=least(pos,neg)' in pg_get_functiondef('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure))=0 then
  raise exception 'SO_SURPLUS_HPP marker missing after patch';end if;
 if has_function_privilege('anon','public.opname_surplus_cost(uuid,uuid,numeric)','EXECUTE')
  or has_function_privilege('authenticated','public.opname_surplus_cost(uuid,uuid,numeric)','EXECUTE') then
  raise exception 'SO_SURPLUS_HPP: opname_surplus_cost tidak boleh dipanggil klien';end if;
end $check$;

-- Pagar Admin Online (#549): idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
