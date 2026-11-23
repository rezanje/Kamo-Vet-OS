-- FB.2026.11.00057: Kalung Yabeibi Lonceng Besar 30 @ 13.334 -> 60 @ 6.666; Pembulatan Invoice 10 -> 70.
-- Total faktur & hutang tetap 11.520.000. Nilai persediaan: -60 (kalung) +60 (pembulatan) = 0, jadi tanpa jurnal.
-- Satu blok DO: setiap langkah dicek jumlah barisnya; gagal = semua batal.
do $$
declare n int; inv constant uuid:='9542d12f-361d-4e86-b7dc-ac18787f0713';
 kal constant uuid:='02fe7c16-1a79-4294-9906-9e08f507c5bf'; pb constant uuid:='f126e0b1-bc6b-484d-bd5c-2f6c7a2777e8';
 dc constant uuid:='80377b05-74a0-4890-8b61-9b4328eb1902';
begin
 -- prasyarat: belum dibayar, belum ada koreksi, belum ada yang terjual dari rantai 13.334
 if exists(select 1 from purchase_invoice_payments where invoice_id=inv) then raise exception 'sudah ada pembayaran';end if;
 if exists(select 1 from purchase_invoice_corrections where invoice_id=inv) then raise exception 'sudah ada koreksi';end if;
 if (select coalesce(sum(qty_left),0) from stock_layers where item_id=kal and unit_cost=13334)<>30 then raise exception 'sisa layer 13.334 bukan 30';end if;
 if exists(select 1 from stock_moves where item_id=kal and unit_cost=13334 and source not in ('faktur-langsung','kirim-permintaan','terima-permintaan')) then raise exception 'ada mutasi lain';end if;

 -- 1) baris faktur
 update purchase_invoice_items set qty=60,harga=6666 where id='74d0aaf0-9fa8-44aa-a8fa-7d70232d74aa' and invoice_id=inv and item_id=kal and qty=30 and harga=13334;
 get diagnostics n=row_count; if n<>1 then raise exception 'baris kalung %',n;end if;
 update purchase_invoice_items set harga=70 where id='51482871-198b-4310-95a6-f1009af1e45b' and invoice_id=inv and item_id=pb and qty=1 and harga=10;
 get diagnostics n=row_count; if n<>1 then raise exception 'baris pembulatan %',n;end if;
 if (select sum(qty*harga) from purchase_invoice_items where invoice_id=inv)<>11520000 then raise exception 'total baris bukan 11.520.000';end if;
 update purchase_invoices set revision=revision+1 where id=inv and total=11520000 and revision=0 and voided_at is null;
 get diagnostics n=row_count; if n<>1 then raise exception 'header %',n;end if;

 -- 2) layer asal faktur di DC: 60 masuk, 30 masih di DC
 update stock_layers set qty_in=60,qty_left=30,unit_cost=6666 where id='f805f7df-d73e-4ae6-8b8b-64543f0f614f' and qty_in=30 and qty_left=0 and unit_cost=13334;
 get diagnostics n=row_count; if n<>1 then raise exception 'layer DC %',n;end if;
 -- 3) layer turunan (transit & cabang) ikut modal baru
 update stock_layers set unit_cost=6666 where item_id=kal and unit_cost=13334 and source in ('kirim-permintaan','terima-permintaan');
 get diagnostics n=row_count; if n<>10 then raise exception 'layer turunan %',n;end if;
 -- 4) kartu stok
 update stock_moves set qty=60,unit_cost=6666 where id='aff8a6dc-06a3-4c6d-8131-d1a7dce57ec3' and qty=30 and unit_cost=13334 and source='faktur-langsung';
 get diagnostics n=row_count; if n<>1 then raise exception 'mutasi faktur %',n;end if;
 update stock_moves set unit_cost=6666 where item_id=kal and unit_cost=13334 and source in ('kirim-permintaan','terima-permintaan');
 get diagnostics n=row_count; if n<>19 then raise exception 'mutasi pindah %',n;end if;
 update stock set qty=qty+30,updated_at=now() where warehouse_id=dc and item_id=kal and qty=0;
 get diagnostics n=row_count; if n<>1 then raise exception 'stok DC %',n;end if;
 -- 5) pembulatan
 update stock_layers set unit_cost=70 where id='450faa8d-dddd-4465-b870-9e560aa13163' and unit_cost=10 and qty_left=1;
 get diagnostics n=row_count; if n<>1 then raise exception 'layer pembulatan %',n;end if;
 update stock_moves set unit_cost=70 where id='802cd0a9-9a2d-4434-8782-9c33fa6c4221' and unit_cost=10;
 get diagnostics n=row_count; if n<>1 then raise exception 'mutasi pembulatan %',n;end if;
 -- 6) bukti posting ikut keadaan baru
 update purchase_invoice_postings set stock_moves=(
   select jsonb_agg(case e->>'id'
     when 'aff8a6dc-06a3-4c6d-8131-d1a7dce57ec3' then e||'{"qty":60,"unit_cost":6666}'::jsonb
     when '802cd0a9-9a2d-4434-8782-9c33fa6c4221' then e||'{"unit_cost":70}'::jsonb else e end order by o)
   from jsonb_array_elements(stock_moves) with ordinality x(e,o)) where invoice_id=inv;
 get diagnostics n=row_count; if n<>1 then raise exception 'posting %',n;end if;
 update purchase_invoice_layer_proofs set after_state=after_state||'{"qty_in":60,"qty_left":60,"unit_cost":6666}'::jsonb where invoice_id=inv and layer_id='f805f7df-d73e-4ae6-8b8b-64543f0f614f';
 get diagnostics n=row_count; if n<>1 then raise exception 'proof kalung %',n;end if;
 update purchase_invoice_layer_proofs set after_state=after_state||'{"unit_cost":70}'::jsonb where invoice_id=inv and layer_id='450faa8d-dddd-4465-b870-9e560aa13163';
 get diagnostics n=row_count; if n<>1 then raise exception 'proof pembulatan %',n;end if;

 -- pemeriksaan akhir
 if (select sum(qty) from stock where item_id=kal)<>70 then raise exception 'total stok kalung bukan 70';end if;
 if (select sum(qty_left) from stock_layers where item_id=kal)<>70 then raise exception 'total layer kalung bukan 70';end if;
 if exists(select 1 from stock s where s.item_id=kal and s.qty<>(select coalesce(sum(qty_left),0) from stock_layers l where l.item_id=kal and l.warehouse_id=s.warehouse_id)) then raise exception 'stok vs layer tidak cocok';end if;
end $$;
