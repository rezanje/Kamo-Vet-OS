-- PREFLIGHT E2 (read-only): pastikan definisi live cocok dengan jangkar migrasi 20261118650000_e2_grup_penjualan_online.sql.
-- Harapan: jangkar_1..3 = 1, assert_1 = 1, assert_2 = 2, sudah_terpasang = false, fungsi_baru_ada = false.
-- Bila ada angka lain, JANGAN pasang migrasi (definisi Production berubah sejak migrasi ditulis) — migrasi akan gagal tanpa perubahan.
select (length(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure))-length(replace(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure),$q$  if coalesce(it.item_type,'Persediaan')='Grup' then raise exception 'Grup tidak didukung pada online';end if;$q$,'')))/length($q$  if coalesce(it.item_type,'Persediaan')='Grup' then raise exception 'Grup tidak didukung pada online';end if;$q$) as jangkar_1_tolak_grup,
 (length(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure))-length(replace(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure),$q$ for r in select x.item_id,sum(x.qty*x.faktor) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' group by x.item_id order by x.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
 end loop;$q$,'')))/length($q$ for r in select x.item_id,sum(x.qty*x.faktor) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' group by x.item_id order by x.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
 end loop;$q$) as jangkar_2_cek_stok,
 (length(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure))-length(replace(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure),$q$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$q$,'')))/length($q$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$q$) as jangkar_3_posting_baris,
 (length(pg_get_functiondef('public.assert_sale_group_cost_links(uuid)'::regprocedure))-length(replace(pg_get_functiondef('public.assert_sale_group_cost_links(uuid)'::regprocedure),$q$ m.source_ref=ref and m.source='sale-group' and not exists($q$,'')))/length($q$ m.source_ref=ref and m.source='sale-group' and not exists($q$) as assert_1,
 (length(pg_get_functiondef('public.assert_sale_group_cost_links(uuid)'::regprocedure))-length(replace(pg_get_functiondef('public.assert_sale_group_cost_links(uuid)'::regprocedure),$q$m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id$q$,'')))/length($q$m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id$q$) as assert_2,
 position('E2_GRUP_ONLINE' in pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure))>0 as sudah_terpasang,
 to_regprocedure('public.online_post_group_line(uuid,text,uuid,date,uuid,text,numeric,numeric,text,numeric)') is not null as fungsi_baru_ada;
-- Gambaran data (read-only): barang Grup aktif dan jumlah isinya; Grup tanpa isi akan ditolak saat dijual online.
select g.code,g.name,g.unit,count(c.id) as jumlah_isi,
 count(*) filter (where ci.is_active is not true or ci.item_type='Grup') as isi_bermasalah
from public.items g left join public.item_group_components c on c.group_item_id=g.id left join public.items ci on ci.id=c.component_item_id
where g.item_type='Grup' and g.is_active group by g.id order by g.name;
