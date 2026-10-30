-- I02 Penyesuaian persediaan: dokumen, stok, dan jurnal dalam SATU transaksi database.
--
-- Sebelumnya layar Penyesuaian menulis dari aplikasi langkah demi langkah:
-- header -> rincian -> mutasi stok -> jurnal (postJournal, best-effort). Bila jurnal
-- gagal (akun 1301/5902 nonaktif, putus koneksi, dsb.) stok SUDAH bergeser tetapi
-- jurnalnya tidak pernah ada, sehingga nilai persediaan di kartu stok dan di neraca
-- (akun 1301) berbeda tanpa jejak. Jalur ini menyamakannya dengan posting opname
-- atomik (20261023134000): semua tertulis bersama atau tidak sama sekali, percobaan
-- ulang dengan kunci permintaan yang sama tidak menggandakan posting, dan akun
-- diambil dari pemetaan tunggal public.stock_opname_account() (1301 / 5902), yang
-- sama dengan akun yang sudah dipakai layar ini sejak 12 Agustus.
--
-- Tidak mengubah dokumen, stok, atau jurnal lama. Tidak ada backfill.
do $$ begin
 if to_regclass('public.inventory_adjustments') is null
  or to_regclass('public.inventory_adjustment_items') is null
  or to_regprocedure('public.stock_opname_account(text)') is null
  or to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is null
  or to_regprocedure('public.issue_stock_document_recorded(text,uuid,uuid)') is null
  or to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is null
  or to_regprocedure('public.stock_document_access(uuid,text)') is null
  or to_regprocedure('public.purchase_payment_period(date,date)') is null
  or to_regprocedure('public.inventory_is_average()') is null
 then raise exception 'I02_ADJ_SOURCE_CHANGED: review inventory adjustment posting contract';end if;
end $$;

-- Bukti posting per (pelaku, kunci permintaan). Ulangan dengan isi yang sama
-- mengembalikan bukti lama; isi berbeda ditolak.
create table if not exists public.inventory_adjustment_requests (
 actor_id uuid not null references public.profiles(id),
 request_key text not null check(length(request_key) between 1 and 120),
 payload jsonb not null,
 adjustment_id uuid not null unique references public.inventory_adjustments(id) on delete restrict,
 journal_id uuid unique references public.journal_entries(id) on delete restrict,
 receipt jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table public.inventory_adjustment_requests enable row level security;
revoke all on public.inventory_adjustment_requests from public,anon,authenticated,service_role;

-- Nomor PS dibuat di dalam transaksi posting, memakai format master yang sama
-- dengan aplikasi (document_numbering jenis 'PS', bawaan PS.{YYYY}.{MM}. 5 digit).
create or replace function public.inventory_adjustment_number(p_date date) returns text
language plpgsql security definer set search_path='' as $$
declare pola text;digits integer;prefix text;seq bigint;
begin
 select n.pola,n.digit into pola,digits from public.document_numbering n where n.jenis='PS';
 -- Pola tidak valid jatuh ke bawaan, sama seperti lib/no-dokumen formatDokumen().
 if pola is null or btrim(pola)='' or length(pola)>30 or pola ~ '[[:space:]%_]'
  or regexp_replace(pola,'\{(YYYY|YY|MM|DD)\}','','g') ~ '\{[^}]*\}' then
  pola:='PS.{YYYY}.{MM}.';digits:=5;
 end if;
 digits:=greatest(1,least(8,coalesce(digits,5)));
 prefix:=replace(replace(replace(replace(pola,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 if length(prefix)+digits>30 then raise exception 'Format nomor penyesuaian terlalu panjang';end if;
 perform pg_advisory_xact_lock(hashtext('vetos:inventory-adjustment-number:'||prefix)::bigint);
 select coalesce(max(substring(a.no_adj from length(prefix)+1 for digits)::bigint),0)+1 into seq
  from public.inventory_adjustments a
  where left(a.no_adj,length(prefix))=prefix and substring(a.no_adj from length(prefix)+1 for digits) ~ '^[0-9]+$';
 if length(seq::text)>digits then raise exception 'Urutan nomor penyesuaian penuh';end if;
 return prefix||lpad(seq::text,digits,'0');
end$$;
revoke all on function public.inventory_adjustment_number(date) from public,anon,authenticated,service_role;

create or replace function public.post_inventory_adjustment_atomic(
 p_request_key text,p_warehouse_id uuid,p_tanggal date,p_alasan text,p_keterangan text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare actor public.profiles%rowtype;wh public.warehouses%rowtype;prior public.inventory_adjustment_requests%rowtype;
 payload jsonb;rows jsonb;ids uuid[];r record;doc_id uuid:=gen_random_uuid();v_no text;v_keterangan text;
 issued jsonb;cost numeric;v_nilai numeric;before_qty numeric;after_qty numeric;
 masuk numeric:=0;keluar numeric:=0;lines jsonb:='[]';journal uuid;deskripsi text;receipt jsonb;
 acc_inventory text:=public.stock_opname_account('inventory');acc_variance text:=public.stock_opname_account('variance');
begin
 v_keterangan:=nullif(btrim(coalesce(p_keterangan,'')),'');
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_warehouse_id is null
  or p_tanggal is null or not isfinite(p_tanggal)
  or p_alasan is null or p_alasan not in('rusak','hilang','kadaluarsa','temuan','lainnya')
  or length(coalesce(v_keterangan,''))>200 or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 5000 then
  raise exception 'Data penyesuaian tidak valid' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) is distinct from 'object'
   or coalesce(e->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(e->'qty_baru') is distinct from 'number') then
  raise exception 'Identitas barang atau jumlah baru tidak valid' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) e where (e->>'qty_baru')::numeric<0 or (e->>'qty_baru')::numeric>1e9)
  or (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct (e->>'item_id')::uuid) from jsonb_array_elements(p_rows) e) then
  raise exception 'Jumlah baru tidak valid atau barang ganda' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('item_id',(e->>'item_id')::uuid,'qty_baru',(e->>'qty_baru')::numeric) order by (e->>'item_id')::uuid)
  into rows from jsonb_array_elements(p_rows) e;
 payload:=jsonb_build_object('warehouse_id',p_warehouse_id,'tanggal',p_tanggal,'alasan',p_alasan,'keterangan',v_keterangan,'rows',rows);

 -- Kunci mode HPP lebih dulu, mengikuti urutan kunci posting opname/koreksi stok.
 perform public.inventory_is_average();
 perform pg_advisory_xact_lock(hashtext('vetos:inventory-adjustment-request:'||coalesce(auth.uid()::text,'')||':'||p_request_key)::bigint);
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role not in('OWNER','ADMIN') then
  raise exception 'Hanya owner/admin aktif yang bisa membuat penyesuaian persediaan' using errcode='42501';end if;
 select * into prior from public.inventory_adjustment_requests where actor_id=actor.id and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then
   raise exception 'Permintaan sudah dipakai dengan rincian berbeda. Muat ulang formulir; tidak ada posting ulang.' using errcode='22023';end if;
  return prior.receipt||jsonb_build_object('already_posted',true);
 end if;

 select * into wh from public.warehouses where id=p_warehouse_id and is_active for share;
 if not found or not public.user_can_access_branch(wh.branch_id) then
  raise exception 'Gudang penyesuaian tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=wh.branch_id and is_active for share;
 if not found then raise exception 'Cabang penyesuaian tidak aktif' using errcode='42501';end if;
 perform public.stock_document_access(wh.branch_id,'pos');
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia';end if;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 -- Akun dari pemetaan tunggal harus akun rincian aktif SEBELUM ada tulisan apa pun.
 if (select count(*) from public.coa_accounts where code in(acc_inventory,acc_variance) and is_active and not is_header)<>2 then
  raise exception 'Akun persediaan % / selisih % belum tersedia atau tidak aktif. Penyesuaian tidak diposting.',acc_inventory,acc_variance;end if;

 select array_agg(x.item_id order by x.item_id) into ids from jsonb_to_recordset(rows) as x(item_id uuid);
 perform 1 from public.items where id=any(ids) order by id for share;
 if exists(select 1 from unnest(ids) as s(item_id) left join public.items i on i.id=s.item_id
   where i.id is null or not i.is_active or coalesce(i.item_type,'Persediaan')<>'Persediaan'
    or i.buy_price is null or i.buy_price<0 or i.buy_price::text in('NaN','Infinity','-Infinity')) then
  raise exception 'Barang bukan persediaan aktif atau harga belinya tidak valid';end if;
 perform 1 from public.stock where warehouse_id=wh.id and item_id=any(ids) order by item_id for update;
 if (select count(*) from public.stock where warehouse_id=wh.id and item_id=any(ids))<>cardinality(ids) then
  raise exception 'Ada barang yang belum punya saldo di gudang ini. Muat ulang formulir.';end if;
 if exists(select 1 from public.stock s where s.warehouse_id=wh.id and s.item_id=any(ids) and
   (s.qty::text in('NaN','Infinity','-Infinity') or greatest(s.qty,0) is distinct from
    (select coalesce(sum(l.qty_left),0) from public.stock_layers l where l.warehouse_id=wh.id and l.item_id=s.item_id)))
  or exists(select 1 from public.stock_layers l where l.warehouse_id=wh.id and l.item_id=any(ids) and (l.unit_cost<0 or l.unit_cost::text in('NaN','Infinity','-Infinity'))) then
  raise exception 'Saldo/lapisan stok tidak konsisten. Rekonsiliasi sumber diperlukan.';end if;

 -- Qty sistem dibaca di bawah kunci baris stok, bukan dari layar.
 select jsonb_agg(jsonb_build_object('item_id',i.id,'nama',left(i.name,160),'qty_sistem',s.qty,'qty_baru',x.qty_baru,'selisih',x.qty_baru-s.qty,'buy_price',i.buy_price) order by i.id)
  into rows from jsonb_to_recordset(rows) as x(item_id uuid,qty_baru numeric)
  join public.items i on i.id=x.item_id join public.stock s on s.item_id=x.item_id and s.warehouse_id=wh.id
  where x.qty_baru<>s.qty;
 if rows is null then raise exception 'Tidak ada selisih untuk disimpan — jumlah barunya sama dengan stok sistem';end if;

 v_no:=public.inventory_adjustment_number(p_tanggal);
 insert into public.inventory_adjustments(id,no_adj,warehouse_id,tanggal,alasan,keterangan,created_by)
  values(doc_id,v_no,wh.id,p_tanggal,p_alasan,v_keterangan,actor.id);
 insert into public.inventory_adjustment_items(adjustment_id,item_id,nama,qty_sistem,qty_baru,selisih,nilai)
  select doc_id,item_id,nama,qty_sistem,qty_baru,selisih,0 from jsonb_to_recordset(rows) as x(item_id uuid,nama text,qty_sistem numeric,qty_baru numeric,selisih numeric);

 for r in select * from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,selisih numeric,buy_price numeric) order by item_id loop
  select qty into before_qty from public.stock where warehouse_id=wh.id and item_id=r.item_id;
  if r.selisih>0 then
   -- Barang lebih masuk sebesar harga beli master (perilaku layar sejak awal).
   perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,r.buy_price,'penyesuaian',v_no,p_tanggal,null);
   v_nilai:=round(r.selisih*r.buy_price,2);
   update public.inventory_adjustment_items set nilai=v_nilai where adjustment_id=doc_id and item_id=r.item_id;
   masuk:=masuk+v_nilai;
  else
   -- Barang kurang keluar sebesar modal lapisan yang benar-benar terpakai, dengan bukti FIFO.
   issued:=public.issue_stock_document_recorded('adjustment',doc_id,r.item_id);
   cost:=(issued->>'cost')::numeric;
   if cost is null or cost<0 or cost::text in('NaN','Infinity','-Infinity') then raise exception 'Biaya pengeluaran penyesuaian tidak valid';end if;
   select i.nilai into v_nilai from public.inventory_adjustment_items i where adjustment_id=doc_id and item_id=r.item_id;
   keluar:=keluar+v_nilai;
  end if;
  select qty into after_qty from public.stock where warehouse_id=wh.id and item_id=r.item_id;
  if after_qty is distinct from before_qty+r.selisih then raise exception 'Rekonsiliasi kuantitas penyesuaian gagal';end if;
 end loop;
 update public.inventory_adjustments set nilai_masuk=masuk,nilai_keluar=keluar where id=doc_id;

 if masuk>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code',acc_inventory,'debit',masuk,'credit',0),jsonb_build_object('code',acc_variance,'debit',0,'credit',masuk));end if;
 if keluar>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code',acc_variance,'debit',keluar,'credit',0),jsonb_build_object('code',acc_inventory,'debit',0,'credit',keluar));end if;
 if jsonb_array_length(lines)>0 then
  deskripsi:=btrim('Penyesuaian persediaan '||v_no||' — '||p_alasan||coalesce(' ('||v_keterangan||')','')||' · '||coalesce(wh.name,''));
  journal:=public.opname_posting_journal(p_tanggal,wh.branch_id,'penyesuaian',v_no,deskripsi,lines);
 end if;
 if (select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
     join public.journal_entries e on e.id=l.entry_id where e.source='penyesuaian' and e.source_ref=v_no and a.code=acc_inventory) is distinct from masuk-keluar then
  raise exception 'Rekonsiliasi nilai jurnal persediaan gagal';end if;

 receipt:=jsonb_build_object('adjustment_id',doc_id,'no_adj',v_no,'tanggal',p_tanggal,'journal_id',journal,
  'nilai_masuk',masuk,'nilai_keluar',keluar,'item_count',jsonb_array_length(rows),
  'inventory_account',acc_inventory,'variance_account',acc_variance,'already_posted',false);
 insert into public.inventory_adjustment_requests(actor_id,request_key,payload,adjustment_id,journal_id,receipt)
  values(actor.id,p_request_key,payload,doc_id,journal,receipt);
 return receipt;
end$$;
revoke all on function public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb) from public,anon,service_role;
grant execute on function public.post_inventory_adjustment_atomic(text,uuid,date,text,text,jsonb) to authenticated;

-- Tulis langsung lewat API ditutup: dokumen penyesuaian hanya lahir dari RPC di
-- atas (atau koreksi resmi stock_document_corrections). Baca tetap seperti semula.
drop policy if exists invadj_all on public.inventory_adjustments;
drop policy if exists invadji_all on public.inventory_adjustment_items;
drop policy if exists invadj_read on public.inventory_adjustments;
drop policy if exists invadji_read on public.inventory_adjustment_items;
create policy invadj_read on public.inventory_adjustments for select to authenticated using (true);
create policy invadji_read on public.inventory_adjustment_items for select to authenticated using (true);
revoke insert,update,delete on public.inventory_adjustments,public.inventory_adjustment_items from anon,authenticated;

-- Jurnal yang lahir dari posting stok atomik (opname & penyesuaian) tetap seperti
-- diposting: tidak bisa diubah, dihapus, atau ditambah baris lewat API biasa.
-- Pembetulan memakai koreksi resmi (stock_document_corrections), yang berjalan
-- sebagai pemilik fungsi dan menulis jurnal balik, bukan mengubah jurnal asal.
-- Trigger ini berjalan pada setiap baris jurnal; pencarian memakai indeks.
create index if not exists opname_posting_receipts_journal_ids_idx on public.opname_posting_receipts using gin(journal_ids);
create or replace function public.stock_posting_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_entry is not null and (
  exists(select 1 from public.inventory_adjustment_requests r where r.journal_id=p_entry)
  or exists(select 1 from public.opname_posting_receipts r where r.journal_ids @> array[p_entry]))
$$;
revoke all on function public.stock_posting_journal_protected(uuid) from public,anon;
grant execute on function public.stock_posting_journal_protected(uuid) to authenticated,service_role;

-- SECURITY INVOKER: current_user harus peran pemanggil API, bukan pemilik fungsi.
create or replace function public.guard_stock_posting_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   if public.stock_posting_journal_protected(old.id) then
    raise exception 'Jurnal posting stok sudah tetap. Gunakan koreksi resmi' using errcode='42501';end if;
  elsif public.stock_posting_journal_protected(case when tg_op='INSERT' then new.entry_id else old.entry_id end)
   or (tg_op='UPDATE' and public.stock_posting_journal_protected(new.entry_id)) then
   raise exception 'Jurnal posting stok sudah tetap. Gunakan koreksi resmi' using errcode='42501';
  end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_stock_posting_journal() from public,anon,authenticated,service_role;
drop trigger if exists stock_posting_journal_header_guard on public.journal_entries;
create trigger stock_posting_journal_header_guard before update or delete on public.journal_entries
 for each row execute function public.guard_stock_posting_journal();
drop trigger if exists stock_posting_journal_lines_guard on public.journal_lines;
create trigger stock_posting_journal_lines_guard before insert or update or delete on public.journal_lines
 for each row execute function public.guard_stock_posting_journal();
