-- ROLLBACK E2 (20261118650000_e2_grup_penjualan_online.sql): kembalikan post_online_order dan assert_sale_group_cost_links
-- ke teks sebelum E2 (penggantian kebalikan, jumlah kemunculan diperiksa persis), lalu hapus public.online_post_group_line.
-- Jalankan sebagai SATU transaksi (begin; <isi file>; commit;). Ditolak bila sudah ada order online berisi paket yang belum
-- dibatalkan: order itu tidak akan bisa dibatalkan lagi sesudah rollback (pemeriksaan HPP isi paket hilang).
-- Diuji di scripts/test-e2-grup-online-postgres.py (md5 definisi sesudah rollback = sebelum migrasi).
do $rb$
declare definition text; news text[]; olds text[]; i integer;
begin
 if exists(select 1 from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id join public.sales s on s.id=i.sale_id
   where s.channel is not null and s.voided_at is null) then
  raise exception 'E2_ROLLBACK_DITOLAK: sudah ada order online berisi paket yang belum dibatalkan';
 end if;
 definition:=pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure);
 news:=array[$q$  if coalesce(it.item_type,'Persediaan')='Grup' then -- E2_GRUP_ONLINE: paket dijual per satuan dasar; isi dari resep master
   if u.factor<>1 then raise exception 'E2_GRUP_SATUAN: paket "%" hanya bisa dijual per % (satuan dasar paket).',it.name,u.unit using errcode='22023';end if;
   perform 1 from public.item_group_components gc where gc.group_item_id=r.item_id order by gc.id for share;
   if not found then raise exception 'E2_GRUP_KOSONG: paket "%" belum punya isi. Lengkapi rincian Grup di master barang.',it.name using errcode='22023';end if;
   if exists(select 1 from public.item_group_components gc left join public.items ci on ci.id=gc.component_item_id where gc.group_item_id=r.item_id
     and (ci.id is null or not ci.is_active or coalesce(ci.item_type,'Persediaan')='Grup' or gc.qty is null or gc.qty<=0
      or gc.factor is distinct from (case when lower(gc.unit)=lower(coalesce(nullif(ci.unit,''),'pcs')) then 1::numeric else (select f.factor from public.item_units f where f.item_id=ci.id and lower(f.unit)=lower(gc.unit) order by f.factor limit 1) end))) then
    raise exception 'E2_GRUP_RUSAK: isi paket "%" memuat barang nonaktif atau satuan yang sudah berubah. Perbaiki rincian Grup di master barang.',it.name using errcode='22023';
   end if;
  end if;$q$,
$q$ for r in select y.item_id,sum(y.qty) qty,bool_or(y.grup) grup,min(y.nama) nama from (
   select x.item_id,x.qty*x.faktor qty,false grup,i.name::text nama from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan'
   union all -- E2_GRUP_ONLINE: kebutuhan isi paket = qty paket x faktor x qty isi x faktor satuan isi
   select gc.component_item_id,x.qty*x.faktor*gc.qty*gc.factor,true,ci.name::text from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id and i.item_type='Grup' join public.item_group_components gc on gc.group_item_id=x.item_id join public.items ci on ci.id=gc.component_item_id where coalesce(ci.item_type,'Persediaan')='Persediaan'
  ) y group by y.item_id order by y.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then
   if r.grup then raise exception 'Stok tidak cukup untuk isi paket: % (butuh %, tersedia %)',r.nama,trim_scale(r.qty),trim_scale(coalesce(stockqty,0)) using errcode='22003';end if;
   raise exception 'Stok tidak cukup' using errcode='22003';
  end if;
 end loop;$q$,
$q$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  if exists(select 1 from public.items where id=r.item_id and item_type='Grup') then -- E2_GRUP_ONLINE
   cost:=public.online_post_group_line(doc,no,wh.id,d,r.item_id,r.nama,r.qty,r.harga,r.satuan,r.faktor);hpp:=hpp+cost;continue;
  end if;
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$q$];
 olds:=array[$q$  if coalesce(it.item_type,'Persediaan')='Grup' then raise exception 'Grup tidak didukung pada online';end if;$q$,
$q$ for r in select x.item_id,sum(x.qty*x.faktor) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' group by x.item_id order by x.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
 end loop;$q$,
$q$ for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);$q$];
 for i in 1..3 loop
  if length(definition)-length(replace(definition,news[i],''))<>length(news[i]) then raise exception 'E2_ROLLBACK_ANCHOR_MISMATCH: post_online_order %',i;end if;
  definition:=replace(definition,news[i],olds[i]);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('public.assert_sale_group_cost_links(uuid)'::regprocedure);
 if length(definition)-length(replace(definition,$q$ m.source_ref=ref and (m.source='sale-group' or (m.source='sale-online' and m.sale_line_id is not null)) /* E2_GRUP_ONLINE */ and not exists($q$,''))<>length($q$ m.source_ref=ref and (m.source='sale-group' or (m.source='sale-online' and m.sale_line_id is not null)) /* E2_GRUP_ONLINE */ and not exists($q$)
  or length(definition)-length(replace(definition,$q$m.source_ref=ref and m.source in('sale-group','sale-online') and m.sale_line_id=r.id$q$,''))<>2*length($q$m.source_ref=ref and m.source in('sale-group','sale-online') and m.sale_line_id=r.id$q$) then
  raise exception 'E2_ROLLBACK_ANCHOR_MISMATCH: assert_sale_group_cost_links';
 end if;
 definition:=replace(replace(definition,$q$ m.source_ref=ref and (m.source='sale-group' or (m.source='sale-online' and m.sale_line_id is not null)) /* E2_GRUP_ONLINE */ and not exists($q$,$q$ m.source_ref=ref and m.source='sale-group' and not exists($q$),$q$m.source_ref=ref and m.source in('sale-group','sale-online') and m.sale_line_id=r.id$q$,$q$m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id$q$);
 execute definition;
 drop function public.online_post_group_line(uuid,text,uuid,date,uuid,text,numeric,numeric,text,numeric);
end $rb$;
