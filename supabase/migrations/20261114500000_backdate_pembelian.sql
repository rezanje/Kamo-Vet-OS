-- Tanggal efektif (mundur) untuk pembatalan pembelian ala Accurate: penerimaan, faktur, pembayaran, uang muka, serta
-- penerimaan / faktur / pembayaran PENGGANTI. Owner bisa membukukan pembatalan pada tanggal dokumen ASLI supaya
-- jurnal, kartu stok, hutang pemasok dan laporan pembelian terbaca di tanggal aslinya.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Tidak ada fungsi yang ditulis ulang: setiap perubahan adalah tambalan berjangkar (patch_once: tepat satu kecocokan atau
-- migrasi berhenti) pada definisi yang berjalan. Fungsi lama dengan tanda tangan lama tetap ada sebagai pembungkus
-- (cancel_purchase_payment/4 arg, cancel_purchase_advance_atomic/1 arg, cancel_purchase_advance_cascade/4 arg) sehingga aplikasi
-- lama tetap bekerja persis seperti dulu (tanggal = hari ini).
--
-- Keputusan rancangan (lihat laporan ship-backdate-pembelian):
--  1. Aturan tanggal (satu pintu: purchase_effective_date_check): wajib tanggal sah, tidak di masa depan, tidak sebelum
--     tanggal dokumen asal, tanggal SEBELUM hari ini hanya untuk Owner atau peran yang diberi izin baru
--     'pembelian.tanggal_mundur' (bawaan MATI, Akses Grup) dan wajib beralasan; periode akuntansi yang dikunci menolak
--     dengan penjelasan; pada aksi yang menyentuh stok juga periode Closing HPP. Owner aktif tidak pernah terkunci oleh izin.
--  2. Jurnal pembalik, baris pembayaran pembalik, mutasi stok pembalik bertanggal = tanggal efektif; waktu sebenarnya tetap
--     tersimpan (created_at) dan dicatat di purchase_backdate_audit (tanggal dipilih vs waktu nyata, pelaku, alasan).
--  3. Lapisan FIFO TIDAK pernah diberi tanggal baru dan tidak diurutkan ulang. Pembatalan hanya bila lapisan utuh (aturan lama),
--     kini dengan penjelasan transaksi pemakainya. Penerimaan/faktur langsung PENGGANTI bertanggal mundur ditolak bila ada
--     lapisan yang lebih baru (menurut urutan FIFO/FEFO) yang sudah terpakai: menyisipkan lapisan lebih tua mengubah lapisan
--     yang seharusnya dipakai penjualan dan HPP yang sudah tercatat. Rata-rata bergerak: ditolak bila ada barang keluar sesudah tanggal itu.
--  4. Pembayaran/uang muka: jurnal bertanggal efektif; uang fisik yang kembali tercatat sebagai kejadian NYATA (tanggal nyata di
--     bukti audit), dan list_purchase_backdate_audit menampilkan kedua tanggal untuk rekonsiliasi.
-- Tidak ada baris data yang diubah. Satu tabel bukti baru (kosong), satu izin katalog baru, fungsi baru dan tambalan.
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('vetos:backdate-pembelian',0));

create function pg_temp.patch_once(p_def text, p_old text, p_new text, p_label text, p_times integer default 1) returns text
language plpgsql as $$
declare n integer;
begin
 if p_old is null or length(p_old)=0 then raise exception 'BACKDATE_PEMBELIAN_ANCHOR_EMPTY %',p_label; end if;
 n:=(length(p_def)-length(replace(p_def,p_old,'')))/length(p_old);
 if n<>p_times then raise exception 'BACKDATE_PEMBELIAN_ANCHOR % ditemukan % kali (seharusnya %); migrasi dihentikan',p_label,n,p_times; end if;
 return replace(p_def,p_old,p_new);
end $$;

-- 1. Izin baru (default MATI untuk selain Owner; tindakan "hanya-izin").
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
('pembelian.tanggal_mundur','Pilih tanggal mundur untuk pembatalan dan penerimaan/faktur/pembayaran pengganti — Pembelian','Pembelian',true);
insert into role_settings_private.action_modules(id,module_id) values ('pembelian.tanggal_mundur','pembelian');

do $patch$
declare v text;
begin
 v:=pg_get_functiondef('public.purchase_cancel_allowed(text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$'pembelian.batalkan_uang_muka') then return false; end if;$a$,
  $b$'pembelian.batalkan_uang_muka','pembelian.tanggal_mundur') then return false; end if;$b$,'allowed list');
 execute v;
end $patch$;

-- Pembaca izin untuk layar (terpisah dari get_my_purchase_cancel_access supaya bentuk JSON lama tidak berubah).
create function public.get_my_purchase_backdate_access() returns boolean
language sql stable security definer set search_path='' as $$ select public.purchase_cancel_allowed('pembelian.tanggal_mundur') $$;
revoke all on function public.get_my_purchase_backdate_access() from public,anon,service_role;
grant execute on function public.get_my_purchase_backdate_access() to authenticated;

-- 2. Bukti tanggal efektif vs waktu nyata (tidak bisa diubah/dihapus).
create table public.purchase_backdate_audit(
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('receipt-cancel','invoice-cancel','payment-cancel','advance-cancel','receipt-replace','invoice-replace','payment-replace')),
 doc_id uuid not null,
 doc_ref text,
 branch_id uuid,
 actor_id uuid not null,
 effective_date date not null,
 doc_date date,
 actual_date date not null,
 actual_at timestamptz not null default now(),
 days_back integer not null check (days_back >= 0),
 reason text,
 journal_id uuid,
 cash_amount numeric,
 cash_account_code text,
 request_key text
);
create unique index purchase_backdate_audit_cancel_once on public.purchase_backdate_audit(kind,doc_id) where kind like '%-cancel';
create index purchase_backdate_audit_effective on public.purchase_backdate_audit(effective_date desc,actual_at desc);
alter table public.purchase_backdate_audit enable row level security;
revoke all on public.purchase_backdate_audit from public,anon,authenticated,service_role;
create function public.guard_purchase_backdate_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Bukti tanggal mundur pembelian tidak bisa diubah atau dihapus' using errcode='42501'; end $$;
create trigger purchase_backdate_audit_immutable before update or delete on public.purchase_backdate_audit
 for each row execute function public.guard_purchase_backdate_audit_immutable();
create trigger purchase_backdate_audit_no_truncate before truncate on public.purchase_backdate_audit
 for each statement execute function public.guard_purchase_backdate_audit_immutable();

-- 3. Pintu tunggal aturan tanggal.
create function public.purchase_effective_date_check(p_kind text, p_date date, p_doc_date date, p_reason text, p_label text, p_stock boolean)
returns void language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date; v_acc date; v_hpp date;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'Tanggal wajib diisi dengan tanggal yang sah' using errcode='22023'; end if;
 if p_date > today then raise exception 'Tanggal tidak boleh di masa depan (hari ini %). Pilih hari ini atau sebelumnya.',today using errcode='22023'; end if;
 if p_doc_date is not null and p_date < p_doc_date then
  raise exception 'Tanggal tidak boleh sebelum tanggal % asal (%). Pilih tanggal itu atau sesudahnya.',p_label,p_doc_date using errcode='22023';
 end if;
 if p_date < today then
  -- Owner aktif dijawab true lebih dulu oleh purchase_cancel_allowed, tanpa membaca kebijakan apa pun.
  if not public.purchase_cancel_allowed('pembelian.tanggal_mundur') then
   raise exception 'Tanggal mundur (sebelum hari ini) hanya untuk Owner atau peran yang diberi izin Tanggal mundur di Akses Grup. Gunakan tanggal hari ini (%).',today using errcode='42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Alasan wajib diisi (minimal 3 karakter) bila memakai tanggal mundur' using errcode='22023'; end if;
 end if;
 select closed_until into v_acc from public.accounting_locks where id for share;
 if v_acc is not null and (p_date <= v_acc or (p_doc_date is not null and p_doc_date <= v_acc)) then
  raise exception 'Periode akuntansi sampai % sudah ditutup, jadi % tidak bisa dibukukan. Minta Owner membuka tutup buku (Keuangan > Tutup Buku)%.',
   v_acc,case when p_date <= v_acc then 'tanggal '||p_date else 'pembatalan dokumen bertanggal '||p_doc_date end,
   case when p_date <= v_acc then ' atau pilih tanggal sesudah '||v_acc else '' end using errcode='55000';
 end if;
 if p_stock then
  select closed_through into v_hpp from public.inventory_costing_settings where id;
  if v_hpp is not null and (p_date <= v_hpp or (p_doc_date is not null and p_doc_date <= v_hpp)) then
   raise exception 'Periode HPP (Closing HPP) sampai % sudah ditutup, jadi stok dan nilai persediaan tidak bisa diubah untuk %. Minta Finance membuka Closing HPP (Keuangan > Closing HPP)%.',
    v_hpp,case when p_date <= v_hpp then 'tanggal '||p_date else 'dokumen bertanggal '||p_doc_date end,
    case when p_date <= v_hpp then ' atau pilih tanggal sesudah '||v_hpp else '' end using errcode='55000';
  end if;
 end if;
end $$;
revoke all on function public.purchase_effective_date_check(text,date,date,text,text,boolean) from public,anon,authenticated,service_role;

create function public.purchase_backdate_record(p_kind text, p_doc uuid, p_ref text, p_branch uuid, p_effective date, p_doc_date date,
 p_reason text, p_journal uuid, p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date; v_cash numeric; v_code text;
begin
 if auth.uid() is null then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_journal is not null then
  select sum(l.debit-l.credit), min(a.code) into v_cash, v_code
   from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
   join public.cash_accounts ca on ca.coa_code=a.code where l.entry_id=p_journal;
 end if;
 insert into public.purchase_backdate_audit(kind,doc_id,doc_ref,branch_id,actor_id,effective_date,doc_date,actual_date,days_back,reason,journal_id,cash_amount,cash_account_code,request_key)
 values(p_kind,p_doc,p_ref,p_branch,auth.uid(),p_effective,p_doc_date,today,greatest(today-p_effective,0),nullif(btrim(p_reason),''),p_journal,v_cash,v_code,p_key);
end $$;
revoke all on function public.purchase_backdate_record(text,uuid,text,uuid,date,date,text,uuid,text) from public,anon,authenticated,service_role;

-- Rata-rata bergerak: riwayat per barang berurutan menurut tanggal. Pemasukan/pembatalan bertanggal lebih lama dari mutasi terakhir
-- barang itu ditolak dengan penjelasan (HPP rata-rata transaksi yang sudah tercatat akan berubah). Tidak berlaku pada FIFO.
create function public.purchase_assert_average_dates(p_wh uuid, p_item uuid, p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare r record; v_name text;
begin
 if not public.inventory_is_average() then return; end if;
 select m.source,m.source_ref,m.tanggal into r from public.stock_moves m
  where m.warehouse_id=p_wh and m.item_id=p_item and m.tanggal>p_date order by m.tanggal desc,m.created_at desc limit 1;
 if found then
  select name into v_name from public.items where id=p_item;
  raise exception 'Tanggal % tidak bisa dipakai untuk %: barang ini sudah bergerak sesudahnya (% % tanggal %). Pada metode rata-rata bergerak riwayat harus berurutan, jadi memasukkan atau membatalkan di tanggal lebih lama mengubah HPP transaksi yang sudah tercatat. Pakai tanggal % atau sesudahnya.',
   p_date,coalesce(v_name,'barang'),r.source,coalesce(r.source_ref,''),r.tanggal,r.tanggal using errcode='55000';
 end if;
end $$;
revoke all on function public.purchase_assert_average_dates(uuid,uuid,date) from public,anon,authenticated,service_role;

-- Urutan FIFO/FEFO: lapisan baru bertanggal mundur tidak boleh disisipkan di depan lapisan yang lebih baru yang sudah terpakai.
create function public.purchase_assert_fifo_order(p_wh uuid, p_item uuid, p_date date, p_exp date) returns void
language plpgsql security definer set search_path='' as $$
declare r record; v_name text;
begin
 -- Kunci saldo agregat lebih dulu (urutan kunci sama dengan penjualan/penerimaan), lalu baca lapisan.
 perform 1 from public.stock where warehouse_id=p_wh and item_id=p_item for update;
 if public.inventory_is_average() then
  perform public.purchase_assert_average_dates(p_wh,p_item,p_date);
  return;
 end if;
 select name into v_name from public.items where id=p_item;
 select l.tanggal,l.source,l.source_ref,l.qty_in-l.qty_left used into r from public.stock_layers l
  where l.warehouse_id=p_wh and l.item_id=p_item and l.qty_left<l.qty_in and not public.stock_layer_cost_was_reversed(l.id)
    and (coalesce(l.exp_date,'infinity'::date),l.tanggal) > (coalesce(p_exp,'infinity'::date),p_date)
  order by l.tanggal,l.created_at limit 1;
 if found then
  raise exception 'Tanggal % tidak bisa dipakai untuk %: stok yang lebih baru (lapisan % dari % %) sudah terpakai % unit oleh penjualan atau pemakaian. Menyisipkan stok di tanggal lebih lama mengubah lapisan mana yang seharusnya dipakai dan HPP yang sudah tercatat. Pakai tanggal % atau sesudahnya, atau batalkan dulu transaksi yang memakainya.',
   p_date,coalesce(v_name,'barang'),r.tanggal,r.source,coalesce(r.source_ref,''),r.used,r.tanggal using errcode='55000';
 end if;
end $$;
revoke all on function public.purchase_assert_fifo_order(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function public.purchase_layer_consumers_text(p_layers uuid[]) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(' Yang memakainya: '||string_agg(x.s,'; ' order by x.t,x.s)||'.','')
 from (
  select distinct m.tanggal t, m.source||' '||coalesce(m.source_ref,'')||' (tanggal '||m.tanggal||')' s
   from public.stock_moves m, jsonb_array_elements(coalesce(m.fifo_takes,'[]'::jsonb)) tk
   where m.fifo_takes is not null and (tk->>'id')::uuid = any(p_layers)
  union
  select distinct m.tanggal, m.source||' '||coalesce(m.source_ref,'')||' (tanggal '||m.tanggal||')'
   from public.stock_moves m join public.stock_layers l on l.id = any(p_layers) and l.warehouse_id=m.warehouse_id and l.item_id=m.item_id
   where m.qty<0 and m.created_at>=l.created_at and m.source not like '%-void' and m.fifo_takes is null
  order by 1,2 limit 5
 ) x
$$;
revoke all on function public.purchase_layer_consumers_text(uuid[]) from public,anon,authenticated,service_role;

-- Penerimaan "pengganti" = penerimaan baru pada PO yang pernah dibatalkan penerimaannya; kembalikan tanggal penerimaan batal tertua.
create function public.purchase_replacement_floor_receipt(p_po uuid) returns date
language sql stable security definer set search_path='' as $$
 select min(g.tanggal) from public.goods_receipts g where g.po_id=p_po and g.voided_at is not null
$$;
revoke all on function public.purchase_replacement_floor_receipt(uuid) from public,anon,authenticated,service_role;

-- 4. Daftar bukti untuk rekonsiliasi: tanggal pembukuan (jurnal) dan tanggal fisik/nyata berdampingan.
create function public.list_purchase_backdate_audit(p_limit integer default 100, p_cash_only boolean default false)
returns table(id uuid, kind text, doc_id uuid, doc_ref text, branch_id uuid, effective_date date, doc_date date, actual_date date,
 actual_at timestamptz, days_back integer, reason text, journal_id uuid, no_jurnal text, cash_amount numeric, cash_account_code text,
 cash_account_name text, actor_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE')) then
  raise exception 'Daftar tanggal mundur pembelian hanya untuk Owner, Admin, dan Finance aktif' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'Batas daftar tidak valid' using errcode='22023'; end if;
 return query
  select a.id,a.kind,a.doc_id,a.doc_ref,a.branch_id,a.effective_date,a.doc_date,a.actual_date,a.actual_at,a.days_back,a.reason,a.journal_id,
   (select e.no_jurnal::text from public.journal_entries e where e.id=a.journal_id),a.cash_amount,a.cash_account_code,
   (select ca.nama::text from public.cash_accounts ca where ca.coa_code=a.cash_account_code limit 1),
   (select pr.full_name::text from public.profiles pr where pr.id=a.actor_id)
  from public.purchase_backdate_audit a
  where (a.branch_id is null or public.user_can_access_branch(a.branch_id))
    and (not p_cash_only or a.cash_account_code is not null)
  order by a.actual_at desc,a.id limit p_limit;
end $$;
revoke all on function public.list_purchase_backdate_audit(integer,boolean) from public,anon,service_role;
grant execute on function public.list_purchase_backdate_audit(integer,boolean) to authenticated;

-- 5. Tambalan berjangkar.
do $patch$
declare v text;
begin
 ---------------------------------------------------------------- cancel_goods_receipt
 v:=pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$  if p_tanggal < gr.tanggal then raise exception 'Tanggal pembatalan tidak boleh sebelum tanggal penerimaan' using errcode = '22023'; end if;$a$,
  $b$  if p_tanggal < gr.tanggal then raise exception 'Tanggal pembatalan tidak boleh sebelum tanggal penerimaan' using errcode = '22023'; end if;
  -- BACKDATE_PEMBELIAN: izin tanggal mundur, alasan, periode akuntansi dan Closing HPP untuk tanggal yang dipilih.
  perform public.purchase_effective_date_check('receipt-cancel', p_tanggal, gr.tanggal, v_reason, 'penerimaan', true);$b$,'receipt date gate');
 v:=pg_temp.patch_once(v,$a$if r.moved > 0 and (r.layered <> r.moved or not r.untouched) then raise exception '%', consumed; end if;$a$,
  $b$if r.moved > 0 and (r.layered <> r.moved or not r.untouched) then
      raise exception '%', consumed || public.purchase_layer_consumers_text((select array_agg((x->>'id')::uuid) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid = r.item_id));
    end if;$b$,'receipt consumers text');
 v:=pg_temp.patch_once(v,$a$    perform 1 from public.stock where warehouse_id = v_wh and item_id = r.item_id for update;
  end loop;$a$,
  $b$    perform 1 from public.stock where warehouse_id = v_wh and item_id = r.item_id for update;
  end loop;
  -- BACKDATE_PEMBELIAN: metode rata-rata bergerak menuntut riwayat berurutan menurut tanggal.
  for r in select unnest(v_items) item_id order by 1 loop
    perform public.purchase_assert_average_dates(v_wh, r.item_id, p_tanggal);
  end loop;$b$,'receipt average dates');
 v:=pg_temp.patch_once(v,$a$moves, layers, result);$a$,
  $b$moves, layers, result);
  perform public.purchase_backdate_record('receipt-cancel', gr.id, gr.no_terima, po.branch_id, p_tanggal, gr.tanggal, v_reason, v_reversal, p_request_key);$b$,'receipt audit');
 execute v;

 ---------------------------------------------------------------- cancel_purchase_invoice
 v:=pg_get_functiondef('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$raise exception 'Tanggal pembatalan mendahului faktur atau riwayat pembayaran';end if;$a$,
  $b$raise exception 'Tanggal pembatalan mendahului faktur atau riwayat pembayaran';end if;
 perform public.purchase_effective_date_check('invoice-cancel',p_tanggal,inv.tanggal,p_reason,'faktur',true);
 perform public.purchase_assert_average_dates(proof.warehouse_id,x.item_id,p_tanggal) from (select distinct ii.item_id from public.purchase_invoice_items ii where ii.invoice_id=inv.id) x;$b$,'invoice date gate');
 v:=pg_temp.patch_once(v,$a$raise exception 'Stok atau harga sudah berubah setelah faktur. Rekonsiliasi sebelum pembatalan';end if;$a$,
  $b$raise exception '%','Stok atau harga sudah berubah setelah faktur. Rekonsiliasi sebelum pembatalan (barang dari faktur ini sudah terpakai atau dinilai ulang, jadi faktur tidak bisa dibatalkan pada tanggal itu; batalkan dulu transaksi yang memakainya).'||public.purchase_layer_consumers_text(array[r.layer_id]);end if;$b$,'invoice consumers text');
 v:=pg_temp.patch_once(v,$a$ result:=jsonb_build_object('invoice_id',inv.id,'no_faktur',inv.no_faktur,'reversal_journal_id',reversal,'po_id',inv.po_id);$a$,
  $b$ perform public.purchase_backdate_record('invoice-cancel',inv.id,inv.no_faktur,proof.branch_id,p_tanggal,inv.tanggal,btrim(p_reason),reversal,p_request_key);
 result:=jsonb_build_object('invoice_id',inv.id,'no_faktur',inv.no_faktur,'reversal_journal_id',reversal,'po_id',inv.po_id);$b$,'invoice audit');
 execute v;

 ---------------------------------------------------------------- preview_goods_receipt_cancellation
 v:=pg_get_functiondef('public.preview_goods_receipt_cancellation(uuid,date)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$ -- Bukti stok dan jurnal (sama dengan cancel_goods_receipt, tanpa kunci).$a$,
  $b$ if p_tanggal is not null and p_tanggal>(now() at time zone 'Asia/Jakarta')::date then
  b:=b||jsonb_build_array(jsonb_build_object('code','tanggal_masa_depan','message','Tanggal pembatalan tidak boleh di masa depan. Pilih hari ini atau sebelumnya.','docs','[]'::jsonb));
 end if;
 if p_tanggal is not null and p_tanggal<(now() at time zone 'Asia/Jakarta')::date and not public.purchase_cancel_allowed('pembelian.tanggal_mundur') then
  b:=b||jsonb_build_array(jsonb_build_object('code','tanggal_mundur_izin','message','Tanggal mundur (sebelum hari ini) hanya untuk Owner atau peran yang diberi izin Tanggal mundur di Akses Grup. Gunakan tanggal hari ini.','docs','[]'::jsonb));
 end if;

 -- Bukti stok dan jurnal (sama dengan cancel_goods_receipt, tanpa kunci).$b$,'preview date blockers');
 v:=pg_temp.patch_once(v,$a$'can_cancel',jsonb_array_length(b)=0,'blockers',b,'average',v_avg,$a$,
  $b$'can_cancel',jsonb_array_length(b)=0,'blockers',b,'average',v_avg,'min_tanggal',gr.tanggal,$b$,'preview min tanggal');
 execute v;

 ---------------------------------------------------------------- cancel_purchase_payment (tanda tangan baru dengan tanggal; yang lama jadi pembungkus)
 v:=pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$CREATE OR REPLACE FUNCTION public.cancel_purchase_payment(p_payment_id uuid, p_expected_revision integer, p_request_key text, p_reason text)$a$,
  $b$CREATE OR REPLACE FUNCTION public.cancel_purchase_payment(p_payment_id uuid, p_expected_revision integer, p_request_key text, p_reason text, p_tanggal date)$b$,'payment header');
 v:=pg_temp.patch_once(v,$a$or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan pembatalan tidak valid';end if;$a$,
  $b$or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 or p_tanggal is null then raise exception 'Identitas, alasan, atau tanggal pembatalan tidak valid';end if;$b$,'payment args');
 v:=pg_temp.patch_once(v,$a$payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason));$a$,
  $b$payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason),'tanggal',p_tanggal);$b$,'payment payload');
 v:=pg_temp.patch_once(v,$a$perform public.purchase_payment_period(pay.tanggal,today);$a$,$b$perform public.purchase_payment_period(pay.tanggal,p_tanggal);$b$,'payment period 1');
 v:=pg_temp.patch_once(v,$a$perform public.purchase_payment_period(original.tanggal,today);$a$,$b$perform public.purchase_payment_period(original.tanggal,p_tanggal);$b$,'payment period 2');
 v:=pg_temp.patch_once(v,$a$ if pay.reversal_of is not null or pay.voided_at is not null or pay.revision<>p_expected_revision then raise exception 'Pembayaran sudah berubah atau dibatalkan. Muat ulang';end if;$a$,
  $b$ if pay.reversal_of is not null or pay.voided_at is not null or pay.revision<>p_expected_revision then raise exception 'Pembayaran sudah berubah atau dibatalkan. Muat ulang';end if;
 perform public.purchase_effective_date_check('payment-cancel',p_tanggal,pay.tanggal,p_reason,'pembayaran',false);$b$,'payment date gate');
 v:=pg_temp.patch_once(v,$a$values(reversal,public.sales_next_number('JRN',today),today,'Pembatalan pembayaran hutang','purchase-pay-void',audit::text,branch);$a$,
  $b$values(reversal,public.sales_next_number('JRN',p_tanggal),p_tanggal,'Pembatalan pembayaran hutang'||case when p_tanggal<today then ' (dibukukan mundur ke '||p_tanggal||', dicatat '||today||')' else '' end,'purchase-pay-void',audit::text,branch);$b$,'payment journal date');
 v:=pg_temp.patch_once(v,$a$select invoice_id,today,-amount,$a$,$b$select invoice_id,p_tanggal,-amount,$b$,'payment reversal rows date');
 v:=pg_temp.patch_once(v,$a$ result:=jsonb_build_object('payment_id',pay.id,'invoice_id',pay.invoice_id,'order_id',v_order,'cancellation_id',audit,'reversal_journal_id',reversal);$a$,
  $b$ perform public.purchase_backdate_record('payment-cancel',pay.id,(select i.no_faktur from public.purchase_invoices i where i.id=pay.invoice_id),branch,p_tanggal,pay.tanggal,btrim(p_reason),reversal,p_request_key);
 result:=jsonb_build_object('payment_id',pay.id,'invoice_id',pay.invoice_id,'order_id',v_order,'cancellation_id',audit,'reversal_journal_id',reversal,'tanggal',p_tanggal);$b$,'payment audit');
 execute v;
 execute $w$create or replace function public.cancel_purchase_payment(p_payment_id uuid, p_expected_revision integer, p_request_key text, p_reason text)
 returns jsonb language plpgsql security definer set search_path='' as $f$
 begin
  if not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran' using errcode='42501';end if;
  -- MITIGASI_1111 R1 (dipertahankan di pembungkus): izin diperiksa SEBELUM kunci apa pun. Kunci advisory (pg_advisory_xact_lock) dan kunci baris (for update) diambil di fungsi bertanggal di bawah, yang mengulang pemeriksaan ini setelah kunci.
  return public.cancel_purchase_payment(p_payment_id,p_expected_revision,p_request_key,p_reason,(now() at time zone 'Asia/Jakarta')::date);
 end $f$$w$;
 revoke all on function public.cancel_purchase_payment(uuid,integer,text,text,date) from public,anon,service_role;
 grant execute on function public.cancel_purchase_payment(uuid,integer,text,text,date) to authenticated;

 -- pembaca pemulihan: ulang dengan tanggal yang tersimpan (pembayaran lama tanpa tanggal = hari ini)
 v:=pg_get_functiondef('public.get_purchase_payment_cancellation(uuid,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$return public.cancel_purchase_payment(p_payment_id,(prior.payload->>'revision')::integer,p_request_key,prior.payload->>'reason');$a$,
  $b$return public.cancel_purchase_payment(p_payment_id,(prior.payload->>'revision')::integer,p_request_key,prior.payload->>'reason',coalesce((prior.payload->>'tanggal')::date,(now() at time zone 'Asia/Jakarta')::date));$b$,'payment recovery');
 execute v;

 ---------------------------------------------------------------- cancel_purchase_advance_atomic
 v:=pg_get_functiondef('public.cancel_purchase_advance_atomic(uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$CREATE OR REPLACE FUNCTION public.cancel_purchase_advance_atomic(p_advance_id uuid)$a$,
  $b$CREATE OR REPLACE FUNCTION public.cancel_purchase_advance_atomic(p_advance_id uuid, p_tanggal date, p_reason text)$b$,'advance header');
 v:=pg_temp.patch_once(v,$a$if exists(select 1 from public.accounting_locks where id and closed_until>=today) then raise exception 'Periode pembatalan sudah ditutup' using errcode='55000';end if;$a$,
  $b$if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal) then raise exception 'Periode pembatalan sudah ditutup (tanggal % jatuh di periode akuntansi yang dikunci). Pilih tanggal sesudahnya atau minta Owner membuka tutup buku.',p_tanggal using errcode='55000';end if;
 perform public.purchase_effective_date_check('advance-cancel',p_tanggal,adv.tanggal,p_reason,'uang muka',false);$b$,'advance date gate');
 v:=pg_temp.patch_once(v,$a$reversal:=public.clinic_write_journal(today,'Pembatalan uang muka '||adv.no_um,$a$,
  $b$reversal:=public.clinic_write_journal(p_tanggal,'Pembatalan uang muka '||adv.no_um||case when p_tanggal<today then ' (dibukukan mundur ke '||p_tanggal||', dicatat '||today||')' else '' end,$b$,'advance journal date');
 v:=pg_temp.patch_once(v,$a$ result:=jsonb_build_object('advance_id',adv.id,'no_um',adv.no_um,'original_journal_id',original.id,'journal_id',reversal,'branch_id',branch);$a$,
  $b$ perform public.purchase_backdate_record('advance-cancel',adv.id,adv.no_um,branch,p_tanggal,adv.tanggal,p_reason,reversal,null);
 result:=jsonb_build_object('advance_id',adv.id,'no_um',adv.no_um,'original_journal_id',original.id,'journal_id',reversal,'branch_id',branch,'tanggal',p_tanggal);$b$,'advance audit');
 execute v;
 execute $w$create or replace function public.cancel_purchase_advance_atomic(p_advance_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $f$
 begin
  return public.cancel_purchase_advance_atomic(p_advance_id,(now() at time zone 'Asia/Jakarta')::date,null);
 end $f$$w$;
 revoke all on function public.cancel_purchase_advance_atomic(uuid,date,text) from public,anon,service_role;
 grant execute on function public.cancel_purchase_advance_atomic(uuid,date,text) to authenticated;

 ---------------------------------------------------------------- cancel_purchase_advance_cascade
 v:=pg_get_functiondef('public.cancel_purchase_advance_cascade(uuid,text,text,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$CREATE OR REPLACE FUNCTION public.cancel_purchase_advance_cascade(p_advance_id uuid, p_reason text, p_request_key text, p_expected_fingerprint text)$a$,
  $b$CREATE OR REPLACE FUNCTION public.cancel_purchase_advance_cascade(p_advance_id uuid, p_reason text, p_request_key text, p_expected_fingerprint text, p_tanggal date)$b$,'cascade header');
 v:=pg_temp.patch_once(v,$a$  payload := jsonb_build_object('advance_id', p_advance_id, 'reason', v_reason);$a$,
  $b$  if p_tanggal is null then raise exception 'Tanggal pembatalan wajib diisi' using errcode = '22023'; end if;
  payload := jsonb_build_object('advance_id', p_advance_id, 'reason', v_reason, 'tanggal', p_tanggal);$b$,'cascade payload');
 v:=pg_temp.patch_once(v,$a$'umc:' || md5(p_request_key) || ':' || pay.id::text, v_reason));$a$,
  $b$'umc:' || md5(p_request_key) || ':' || pay.id::text, v_reason, p_tanggal));$b$,'cascade inner payment date');
 v:=pg_temp.patch_once(v,$a$advance_result := public.cancel_purchase_advance_atomic(adv.id);$a$,
  $b$advance_result := public.cancel_purchase_advance_atomic(adv.id, p_tanggal, v_reason);$b$,'cascade inner advance date');
 v:=pg_temp.patch_once(v,$a$result := jsonb_build_object('advance_id', adv.id, 'no_um', adv.no_um, 'journal_id', advance_result->>'journal_id',$a$,
  $b$result := jsonb_build_object('advance_id', adv.id, 'no_um', adv.no_um, 'tanggal', p_tanggal, 'journal_id', advance_result->>'journal_id',$b$,'cascade result');
 execute v;
 execute $w$create or replace function public.cancel_purchase_advance_cascade(p_advance_id uuid, p_reason text, p_request_key text, p_expected_fingerprint text)
 returns jsonb language plpgsql security definer set search_path='' as $f$
 begin
  return public.cancel_purchase_advance_cascade(p_advance_id,p_reason,p_request_key,p_expected_fingerprint,(now() at time zone 'Asia/Jakarta')::date);
 end $f$$w$;
 revoke all on function public.cancel_purchase_advance_cascade(uuid,text,text,text,date) from public,anon,service_role;
 grant execute on function public.cancel_purchase_advance_cascade(uuid,text,text,text,date) to authenticated;

 v:=pg_get_functiondef('public.preview_purchase_advance_cascade(uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$'jumlah', adv.jumlah,
    'terpakai', adv.terpakai,$a$,
  $b$'jumlah', adv.jumlah, 'tanggal', adv.tanggal,
    'min_tanggal', greatest(adv.tanggal, coalesce((select max((x->>'tanggal')::date) from jsonb_array_elements(plan) x), adv.tanggal)),
    'terpakai', adv.terpakai,$b$,'advance preview min date');
 execute v;
end $patch$;

-- 6. Penerimaan / faktur / pembayaran PENGGANTI.
do $patch$
declare v text;
begin
 ---------------------------------------------------------------- receive_purchase_order
 v:=pg_get_functiondef('public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$ v_warehouse_branch uuid;v_count integer;v_distinct integer;v_exp date;$a$,
  $b$ v_warehouse_branch uuid;v_count integer;v_distinct integer;v_exp date;v_rr date;v_today date:=(now() at time zone 'Asia/Jakarta')::date;$b$,'receive declare');
 v:=pg_temp.patch_once(v,$a$ if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal)then raise exception 'Periode akuntansi sudah ditutup.';end if;$a$,
  $b$ if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal)then raise exception 'Periode akuntansi sudah ditutup.';end if;
 -- BACKDATE_PEMBELIAN: penerimaan pengganti (PO yang pernah dibatalkan penerimaannya) memakai aturan tanggal efektif.
 v_rr:=public.purchase_replacement_floor_receipt(v_po.id);
 if v_rr is not null then perform public.purchase_effective_date_check('receipt-replace',p_tanggal,v_rr,p_catatan,'penerimaan yang dibatalkan',true);end if;$b$,'receive date gate');
 v:=pg_temp.patch_once(v,$a$   perform public.stock_in_fifo(v_po.to_warehouse_id,v_item.item_id,$a$,
  $b$   if v_rr is not null and p_tanggal<v_today then perform public.purchase_assert_fifo_order(v_po.to_warehouse_id,v_item.item_id,p_tanggal,nullif(v_batch->>'exp_date','')::date);end if;
   perform public.stock_in_fifo(v_po.to_warehouse_id,v_item.item_id,$b$,'receive fifo order');
 v:=pg_temp.patch_once(v,$a$ v_result:=jsonb_build_object('receipt_id',v_receipt,'no_terima',v_no,'no_po',v_po.no_po,'no_jurnal',v_journal,'complete',v_complete,'total',v_total);$a$,
  $b$ if v_rr is not null then perform public.purchase_backdate_record('receipt-replace',v_receipt,v_no,v_po.branch_id,p_tanggal,v_rr,p_catatan,case when v_total>0 then v_entry end,p_request_key);end if;
 v_result:=jsonb_build_object('receipt_id',v_receipt,'no_terima',v_no,'no_po',v_po.no_po,'no_jurnal',v_journal,'complete',v_complete,'total',v_total);$b$,'receive audit');
 execute v;

 ---------------------------------------------------------------- faktur dari PO (pengganti)
 v:=pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$ perform public.purchase_invoice_replacement(p_replaces_invoice_id,p_po_id,po.supplier_id,po.branch_id,po.to_warehouse_id);$a$,
  $b$ perform public.purchase_invoice_replacement(p_replaces_invoice_id,p_po_id,po.supplier_id,po.branch_id,po.to_warehouse_id);
 if p_replaces_invoice_id is not null then perform public.purchase_effective_date_check('invoice-replace',p_tanggal,(select i.tanggal from public.purchase_invoices i where i.id=p_replaces_invoice_id),p_keterangan,'faktur yang dibatalkan',true);end if;$b$,'invoice replace gate');
 v:=pg_temp.patch_once(v,$a$ v_invoice:=(result->>'invoice_id')::uuid;$a$,
  $b$ v_invoice:=(result->>'invoice_id')::uuid;
 if p_replaces_invoice_id is not null then perform public.purchase_backdate_record('invoice-replace',v_invoice,result->>'no_faktur',po.branch_id,p_tanggal,(select i.tanggal from public.purchase_invoices i where i.id=p_replaces_invoice_id),p_keterangan,null,p_request_key);end if;$b$,'invoice replace audit');
 execute v;

 ---------------------------------------------------------------- faktur langsung (pengganti)
 v:=pg_get_functiondef('public.create_direct_purchase_invoice(text,jsonb)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$perform public.purchase_invoice_replacement(replacement,null,supplier,wh.branch_id,wh.id);$a$,
  $b$perform public.purchase_invoice_replacement(replacement,null,supplier,wh.branch_id,wh.id);
 if replacement is not null then perform public.purchase_effective_date_check('invoice-replace',d,(select i.tanggal from public.purchase_invoices i where i.id=replacement),p_payload->>'keterangan','faktur yang dibatalkan',true);end if;$b$,'direct replace gate');
 v:=pg_temp.patch_once(v,$a$perform public.stock_in_fifo(wh.id,r.item_id,r.qty*r.faktor,value/(r.qty*r.faktor),'faktur-langsung',number,d,r.exp_date);$a$,
  $b$if replacement is not null and d<(now() at time zone 'Asia/Jakarta')::date then perform public.purchase_assert_fifo_order(wh.id,r.item_id,d,r.exp_date);end if;
   perform public.stock_in_fifo(wh.id,r.item_id,r.qty*r.faktor,value/(r.qty*r.faktor),'faktur-langsung',number,d,r.exp_date);$b$,'direct fifo order');
 v:=pg_temp.patch_once(v,$a$p_payload->>'surat_jalan',auth.uid(),replacement);$a$,
  $b$p_payload->>'surat_jalan',auth.uid(),replacement);
 if replacement is not null then perform public.purchase_backdate_record('invoice-replace',invoice,number,wh.branch_id,d,(select i.tanggal from public.purchase_invoices i where i.id=replacement),p_payload->>'keterangan',null,p_request_key);end if;$b$,'direct replace audit');
 execute v;

 ---------------------------------------------------------------- bayar faktur (pengganti)
 v:=pg_get_functiondef('public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$  if exists(select 1 from public.purchase_invoice_payments where replaces_payment_id=p_replaces_payment_id) then raise exception 'Pembayaran pengganti sudah tersimpan. Buka riwayat faktur';end if;$a$,
  $b$  if exists(select 1 from public.purchase_invoice_payments where replaces_payment_id=p_replaces_payment_id) then raise exception 'Pembayaran pengganti sudah tersimpan. Buka riwayat faktur';end if;
  perform public.purchase_effective_date_check('payment-replace',p_tanggal,(select p.tanggal from public.purchase_invoice_payments p where p.id=p_replaces_payment_id),p_catatan,'pembayaran yang dibatalkan',false);$b$,'pay replace gate');
 v:=pg_temp.patch_once(v,$a$ update public.purchase_invoice_payments set journal_id=v_journal_id where id=payment_id;$a$,
  $b$ update public.purchase_invoice_payments set journal_id=v_journal_id where id=payment_id;
 if p_replaces_payment_id is not null then perform public.purchase_backdate_record('payment-replace',payment_id,inv.no_faktur,branch,p_tanggal,(select p.tanggal from public.purchase_invoice_payments p where p.id=p_replaces_payment_id),p_catatan,v_journal_id,p_request_key);end if;$b$,'pay replace audit');
 execute v;

 ---------------------------------------------------------------- bayar perintah bayar (pengganti = perintah yang pernah dibatalkan pembayarannya)
 v:=pg_get_functiondef('public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$ order_before jsonb;payment_ids jsonb;$a$,$b$ order_before jsonb;payment_ids jsonb;v_rp date;v_rp_reason text;$b$,'order declare');
 v:=pg_temp.patch_once(v,$a$ if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;$a$,
  $b$ if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 select min(p.tanggal) into v_rp from public.purchase_invoice_payments p where p.payment_order_id=ord.id and p.voided_at is not null and p.reversal_of is null;
 if v_rp is not null then
  -- Alasan = alasan pembatalan yang tercatat untuk perintah bayar ini (fungsi ini tidak punya kolom alasan sendiri).
  select c.reason into v_rp_reason from public.purchase_payment_cancellations c where c.payment_order_id=ord.id order by c.created_at desc limit 1;
  perform public.purchase_effective_date_check('payment-replace',p_tanggal,v_rp,v_rp_reason,'pembayaran yang dibatalkan',false);
 end if;$b$,'order replace gate');
 v:=pg_temp.patch_once(v,$a$ update public.payment_orders set status='dibayar',paid_at=now(),revision=revision+1 where id=ord.id;$a$,
  $b$ update public.payment_orders set status='dibayar',paid_at=now(),revision=revision+1 where id=ord.id;
 if v_rp is not null then perform public.purchase_backdate_record('payment-replace',ord.id,ord.no_pp,branch,p_tanggal,v_rp,v_rp_reason,v_journal_id,p_request_key);end if;$b$,'order replace audit');
 execute v;
end $patch$;
