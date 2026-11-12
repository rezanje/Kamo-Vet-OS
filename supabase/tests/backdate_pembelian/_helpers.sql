-- Pembantu bersama seluruh seksi (diawali runner; transaksi seksi di-rollback). Semua data fiktif.
create function pg_temp.expect_error(command text, fragment text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Diharapkan galat memuat "%", dapat: %',fragment,sqlerrm; end if;
  return;
 end;
 raise exception 'Diharapkan gagal memuat "%" tetapi perintah berhasil',fragment;
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Asersi gagal: %',msg; end if; end $$;
-- Peran: 1 OWNER, 2 ADMIN, 3 FINANCE, 4 STAFF
create function pg_temp.act(n int) returns void language plpgsql as $$
begin
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-00000000000'||n,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
-- Semua penerimaan satu transaksi berbagi now(): umurkan penerimaan supaya urutan FIFO / jejak lapisan jelas.
create function pg_temp.age(rid uuid, delta interval) returns void language plpgsql as $$
declare gr goods_receipts%rowtype; ref text; was text:=current_user;
begin
 execute 'reset role';
 -- Metode rata-rata melarang mengubah mutan; di sana tiap PO punya acuan sendiri sehingga jejak tidak bertabrakan.
 if (select method from inventory_costing_settings where id)='moving_average' then return; end if;
 select * into gr from goods_receipts where id=rid;
 select no_po into ref from purchase_orders where id=gr.po_id;
 update stock_moves set created_at=created_at-delta where source='purchase' and source_ref=ref and created_at=gr.created_at;
 update stock_layers set created_at=created_at-delta where source='purchase' and source_ref=ref and created_at=gr.created_at;
 update goods_receipts set created_at=created_at-delta where id=rid;
 if was<>current_user then execute format('set local role %I',was); end if;
end $$;
create function pg_temp.mkpo(n int, supplier int, lines jsonb) returns uuid language plpgsql as $$
declare pid uuid:=('bd500000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid; l jsonb; i int:=0;
begin
 execute 'reset role';
 insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status)
  values(pid,'PO.BP.'||n,('bd300000-0000-4000-8000-00000000000'||supplier)::uuid,'bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','Dipesan');
 for l in select * from jsonb_array_elements(lines) loop
  i:=i+1;
  insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)
   values(('bd600000-0000-4000-8000-'||lpad(n::text,6,'0')||lpad(i::text,6,'0'))::uuid,pid,('bd400000-0000-4000-8000-00000000000'||(l->>'item'))::uuid,'BP '||(l->>'item'),(l->>'qty')::numeric,(l->>'harga')::numeric,coalesce(l->>'satuan','pcs'),coalesce((l->>'faktor')::numeric,1));
 end loop;
 update purchase_orders set total=(select sum(qty*harga_beli) from purchase_order_items where po_id=pid) where id=pid;
 return pid;
end $$;
create function pg_temp.line(n int, i int) returns uuid language sql as $$select ('bd600000-0000-4000-8000-'||lpad(n::text,6,'0')||lpad(i::text,6,'0'))::uuid$$;
create function pg_temp.po(n int) returns uuid language sql as $$select ('bd500000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
-- Terima barang lewat RPC produksi: rows = [{line:i, qty:q}]; kembalikan id penerimaan.
create function pg_temp.recv(n int, key text, rows jsonb) returns uuid language plpgsql as $$
declare res jsonb; payload jsonb;
begin
 select jsonb_agg(jsonb_build_object('id',pg_temp.line(n,(x->>'line')::int),'qty_terima',(x->>'qty')::numeric)) into payload from jsonb_array_elements(rows) x;
 res:=receive_purchase_order(pg_temp.po(n),key,'TB.BP.',5,current_date,null,null,payload);
 return (res->>'receipt_id')::uuid;
end $$;
-- Faktur dari penerimaan: rows = [{line, qty, harga}].
create function pg_temp.inv(n int, key text, rows jsonb, receipts uuid[]) returns uuid language plpgsql as $$
declare payload jsonb; r record;
begin
 select jsonb_agg(jsonb_build_object('po_item_id',pg_temp.line(n,(x->>'line')::int),'qty',(x->>'qty')::numeric,'harga',(x->>'harga')::numeric)) into payload from jsonb_array_elements(rows) x;
 select * into r from create_purchase_invoice_from_po_receipts(pg_temp.po(n),'FB.BP.',5,null,current_date,current_date,null,payload,'[]','[]',0,key,null,receipts);
 return r.invoice_id;
end $$;
-- Keadaan yang harus tetap sama setelah penolakan: tidak ada satu pun efek tertinggal.
create function pg_temp.digest() returns text language plpgsql as $$
declare was text:=current_user; res text;
begin
 execute 'reset role';
 res:=md5(coalesce((select string_agg(to_jsonb(x)::text,'|' order by id) from stock_layers x),'')||'#'||coalesce((select string_agg(to_jsonb(x)::text,'|' order by item_id,warehouse_id) from stock x),'')
  ||'#'||(select count(*) from stock_moves)::text||'#'||(select count(*) from journal_entries)::text||'#'||(select count(*) from journal_lines)::text
  ||'#'||coalesce((select string_agg(to_jsonb(x)::text,'|' order by id) from purchase_order_items x),'')||'#'||coalesce((select string_agg(status::text,'|' order by id) from purchase_orders),'')
  ||'#'||coalesce((select string_agg(coalesce(voided_at::text,'-'),'|' order by id) from goods_receipts),'')
  ||'#'||coalesce((select string_agg(coalesce(voided_at::text,'-'),'|' order by id) from purchase_invoices),'')
  ||'#'||coalesce((select string_agg(terpakai::text||status,'|' order by id) from purchase_advances),'')
  ||'#'||(select count(*) from purchase_invoice_payments)::text||'#'||(select count(*) from purchase_receipt_cancellations)::text);
 if was<>current_user then execute format('set local role %I',was); end if;
 return res;
end $$;
-- Invarian: buku seimbang, stok = jumlah sisa lapisan (FIFO), qty terima PO = penerimaan aktif, uang muka terpakai = alokasi,
-- tidak ada stok minus pada barang fiktur, setiap penerimaan batal punya tepat satu bukti dan satu jurnal pembalik.
create function pg_temp.invariants(label text) returns void language plpgsql as $$
declare was text:=current_user;
begin
 execute 'reset role';
 if (select coalesce(sum(debit),0)<>coalesce(sum(credit),0) from journal_lines) then raise exception 'Invarian % gagal: neraca saldo tidak nol',label; end if;
 if exists(select 1 from journal_lines group by entry_id having sum(debit)<>sum(credit)) then raise exception 'Invarian % gagal: ada jurnal tidak seimbang',label; end if;
 if (select method from inventory_costing_settings where id)<>'moving_average' and exists(
   select 1 from stock s where s.qty<>coalesce((select sum(l.qty_left) from stock_layers l where l.warehouse_id=s.warehouse_id and l.item_id=s.item_id),0)) then
  raise exception 'Invarian % gagal: stok tidak sama dengan jumlah sisa lapisan FIFO',label; end if;
 if exists(select 1 from stock where qty<0) then raise exception 'Invarian % gagal: ada stok minus',label; end if;
 if exists(select 1 from stock_layers where qty_left<0 or qty_left>qty_in) then raise exception 'Invarian % gagal: sisa lapisan di luar batas',label; end if;
 if exists(select 1 from purchase_order_items pi where coalesce(pi.qty_terima,0)<>coalesce((select sum(gi.qty_terima) from goods_receipt_items gi join goods_receipts g on g.id=gi.receipt_id where gi.po_item_id=pi.id and g.voided_at is null),0)
           and exists(select 1 from goods_receipts g where g.po_id=pi.po_id)) then
  raise exception 'Invarian % gagal: qty terima PO tidak sama dengan penerimaan aktif',label; end if;
 if exists(select 1 from purchase_advances a where a.terpakai<>coalesce((select sum(p.dari_uang_muka) from purchase_invoice_payments p where p.advance_id=a.id),0)) then
  raise exception 'Invarian % gagal: uang muka terpakai tidak sama dengan alokasi',label; end if;
 if exists(select 1 from goods_receipts g where g.voided_at is not null and ((select count(*) from purchase_receipt_cancellations c where c.receipt_id=g.id)<>1 or g.reversal_journal_id is null)) then
  raise exception 'Invarian % gagal: bukti pembatalan penerimaan tidak lengkap',label; end if;
 if exists(select 1 from purchase_invoices i where i.voided_at is not null and i.reversal_journal_id is null) then raise exception 'Invarian % gagal: faktur batal tanpa jurnal pembalik',label; end if;
 if was<>current_user then execute format('set local role %I',was); end if;
end $$;

-- Beri / cabut izin lewat API resmi Akses Grup (save_role_access_config), bukan menulis tabel langsung.
create function pg_temp.grant_role(r text, actions text[], modules text[] default array['pembelian','kas-bank'], all_branches boolean default true) returns void language plpgsql as $$
declare cfg jsonb;
begin
 perform pg_temp.act(1);
 cfg:=get_role_access_config(r);
 perform save_role_access_config(r,cfg->>'revision',gen_random_uuid(),'custom',to_jsonb(modules),jsonb_build_object('all_branches',all_branches,'create_accounts',false),'uji izin batal',to_jsonb(actions));
 execute 'reset role';
end $$;
create function pg_temp.reset_role_access(r text) returns void language plpgsql as $$
declare cfg jsonb;
begin
 perform pg_temp.act(1);
 cfg:=get_role_access_config(r);
 perform save_role_access_config(r,cfg->>'revision',gen_random_uuid(),'reset','[]',null,'uji kembali ke bawaan');
 execute 'reset role';
end $$;

-- Diferensial: pratinjau "bisa dibatalkan" <=> pembatalan sungguhan berhasil (dijalankan di subtransaksi yang digagalkan sendiri);
-- bila ditolak, alasan sungguhan harus punya penghalang yang cocok di pratinjau.
create function pg_temp.would_cancel(rid uuid) returns text language plpgsql as $$
begin
 begin
  perform cancel_goods_receipt(rid,'wc-'||gen_random_uuid()::text,'uji diferensial',current_date);
  raise exception 'WC_OK';
 exception when others then
  if sqlerrm='WC_OK' then return 'ok'; end if;
  return sqlerrm;
 end;
end $$;
create function pg_temp.diff(rid uuid, label text) returns void language plpgsql as $$
declare pv jsonb; w text; codes text[]; hit boolean;
begin
 pv:=preview_goods_receipt_cancellation(rid);
 w:=pg_temp.would_cancel(rid);
 if (pv->>'can_cancel')::boolean is distinct from (w='ok') then
  raise exception 'Diferensial % gagal: pratinjau can_cancel=% tetapi pembatalan sungguhan: %',label,pv->>'can_cancel',w; end if;
 if w<>'ok' then
  select array_agg(x->>'code') into codes from jsonb_array_elements(pv->'blockers') x;
  hit:=(w like '%faktur pembelian aktif%' and (codes && array['faktur_aktif','faktur_menagih_lebih']))
    or (w like '%sudah terpakai atau keluar%' and 'barang_terpakai'=any(codes))
    or (w like '%Sisa PO ini sudah ditutup%' and 'sisa_ditutup'=any(codes))
    or (w like '%retur pembelian%' and 'retur_aktif'=any(codes))
    or (w like '%Periode%' and (codes && array['periode_tertutup','periode_persediaan_tertutup']))
    or (w like '%PO sudah dibatalkan%' and 'po_batal'=any(codes))
    or (w like '%tidak cocok dengan dokumennya%' and 'bukti_tidak_cocok'=any(codes))
    or (w like '%Tanggal pembatalan%' and 'tanggal_tidak_valid'=any(codes));
  if not coalesce(hit,false) then raise exception 'Diferensial % gagal: penolakan sungguhan "%" tanpa penghalang cocok di pratinjau (%)',label,w,codes; end if;
 end if;
end $$;


-- ===== Tambahan suite backdate_pembelian =====
-- Terima / faktur pada tanggal tertentu (lewat RPC produksi).
create function pg_temp.recv_at(n int, key text, rows jsonb, tgl date) returns uuid language plpgsql as $$
declare res jsonb; payload jsonb;
begin
 select jsonb_agg(jsonb_build_object('id',pg_temp.line(n,(x->>'line')::int),'qty_terima',(x->>'qty')::numeric)) into payload from jsonb_array_elements(rows) x;
 res:=receive_purchase_order(pg_temp.po(n),key,'TB.BP.',5,tgl,null,null,payload);
 return (res->>'receipt_id')::uuid;
end $$;
create function pg_temp.recv_note(n int, key text, rows jsonb, tgl date, note text) returns uuid language plpgsql as $$
declare res jsonb; payload jsonb;
begin
 select jsonb_agg(jsonb_build_object('id',pg_temp.line(n,(x->>'line')::int),'qty_terima',(x->>'qty')::numeric)) into payload from jsonb_array_elements(rows) x;
 res:=receive_purchase_order(pg_temp.po(n),key,'TB.BP.',5,tgl,null,note,payload);
 return (res->>'receipt_id')::uuid;
end $$;
create function pg_temp.inv_at(n int, key text, rows jsonb, receipts uuid[], tgl date) returns uuid language plpgsql as $$
declare payload jsonb; r record;
begin
 select jsonb_agg(jsonb_build_object('po_item_id',pg_temp.line(n,(x->>'line')::int),'qty',(x->>'qty')::numeric,'harga',(x->>'harga')::numeric)) into payload from jsonb_array_elements(rows) x;
 select * into r from create_purchase_invoice_from_po_receipts(pg_temp.po(n),'FB.BP.',5,null,tgl,tgl,null,payload,'[]','[]',0,key,null,receipts);
 return r.invoice_id;
end $$;
-- Neraca saldo nol per cabang per tanggal, dan kumulatif per tanggal (as-of). Dipanggil di akhir seksi.
create function pg_temp.tb_zero(label text) returns void language plpgsql as $$
declare was text:=current_user; bad record;
begin
 execute 'reset role';
 select e.branch_id,e.tanggal,sum(l.debit)-sum(l.credit) d into bad from journal_lines l join journal_entries e on e.id=l.entry_id
  group by e.branch_id,e.tanggal having sum(l.debit)<>sum(l.credit) limit 1;
 if found then raise exception 'Neraca saldo % tidak nol: cabang % tanggal % selisih %',label,bad.branch_id,bad.tanggal,bad.d; end if;
 select e.tanggal,sum(l.debit)-sum(l.credit) d into bad from journal_lines l join journal_entries e on e.id=l.entry_id
  group by e.tanggal having sum(l.debit)<>sum(l.credit) limit 1;
 if found then raise exception 'Neraca saldo % tidak nol pada tanggal %',label,bad.tanggal; end if;
 if was<>current_user then execute format('set local role %I',was); end if;
end $$;
-- Kartu stok as-of: saldo kumulatif per barang/gudang pada setiap tanggal mutasi tidak pernah minus dan akhirnya = stok.
create function pg_temp.stock_card_ok(label text) returns void language plpgsql as $$
declare was text:=current_user; bad record;
begin
 execute 'reset role';
 select x.warehouse_id,x.item_id,x.tanggal,x.bal into bad from (
  select m.warehouse_id,m.item_id,m.tanggal,(select sum(m2.qty) from stock_moves m2 where m2.warehouse_id=m.warehouse_id and m2.item_id=m.item_id and m2.tanggal<=m.tanggal) bal
  from stock_moves m group by m.warehouse_id,m.item_id,m.tanggal) x where x.bal<0 limit 1;
 if found then raise exception 'Kartu stok % minus pada tanggal % (barang %): %',label,bad.tanggal,bad.item_id,bad.bal; end if;
 if exists(select 1 from stock s where s.qty<>coalesce((select sum(m.qty) from stock_moves m where m.warehouse_id=s.warehouse_id and m.item_id=s.item_id),0)) then
  raise exception 'Kartu stok % tidak sama dengan saldo stok',label; end if;
 if was<>current_user then execute format('set local role %I',was); end if;
end $$;
-- Saldo hutang (311001) per tanggal sampai dengan tanggal d (as-of): kredit - debit.
create function pg_temp.ap_asof(d date) returns numeric language plpgsql as $$
declare was text:=current_user; v numeric;
begin
 execute 'reset role';
 select coalesce(sum(l.credit-l.debit),0) into v from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='311001' and e.tanggal<=d;
 if was<>current_user then execute format('set local role %I',was); end if;
 return v;
end $$;
-- Saldo akun (kode) as-of d.
create function pg_temp.bal_asof(p_code text, d date) returns numeric language plpgsql as $$
declare was text:=current_user; v numeric;
begin
 execute 'reset role';
 select coalesce(sum(l.debit-l.credit),0) into v from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code=p_code and e.tanggal<=d;
 if was<>current_user then execute format('set local role %I',was); end if;
 return v;
end $$;

create function pg_temp.n_audit() returns bigint language plpgsql as $$
declare was text:=current_user; v bigint;
begin
 execute 'reset role'; select count(*) into v from purchase_backdate_audit;
 if was<>current_user then execute format('set local role %I',was); end if;
 return v;
end $$;
