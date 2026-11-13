-- UBAH TRANSAKSI struk kasir petshop tanpa "void lalu buat ulang" manual (permintaan tim 12 Nov 2026):
-- "kalo bisa akses ubah nya gak usah ada void void, langsung aja arahkan ke input terus simpan lagi. paling nanti ke
--  record di history aja ... misal, saya ubah tgl 2 november ditgl 6. harusnya kan transaksinya ttp ditgl 2".
-- Keputusan Reza: semua isi boleh diubah; Owner + Finance; 2A = omzet & kas/bank di tanggal struk, stok & HPP di hari
-- diubah; 3A = promo/voucher lama terbawa apa adanya (tanpa hitung ulang kuota/aturan promo).
--
-- RANCANGAN — satu RPC atomik edit_posted_pos_sale(sale, revisi, kunci, alasan, isi_baru):
--  1. Struk lama dibatalkan lewat varian internal pembatalan resmi (pos_sale_edit_void, turunan cancel_posted_sale):
--     * jurnal pendapatan/kas (termasuk pasangan koreksi metode bayar) dibalik di TANGGALNYA MASING-MASING, jadi
--       seluruh rantai lama hilang dari tanggal asalnya; jurnal HPP dibalik dan stok dikembalikan HARI INI (2A);
--     * boleh Owner/Finance, boleh shift sudah ditutup, boleh promo/voucher; efek quest staf TIDAK dibalik melainkan
--       dipindah ke struk baru (isi berubah, aktivitas staf tetap sama).
--  2. Struk baru dibuat di dalam transaksi yang sama: created_at = struk lama + 1 milidetik (tetap di tanggal & urutan
--     asli), kasir/shift/sales/pelanggan sama, nomor = nomor asli + "-U<n>". Diposting oleh jalur resmi yang sama
--     (trigger pembayaran, cashier_post_stock_atomic / finalize_pos_sale): jurnal pendapatan di tanggal struk, stok &
--     HPP hari ini. Metode bayar yang sudah ada tetap di rekening tercatatnya; metode baru memakai peta sekarang.
--  3. Jejak: sale_edits (sebelum/sesudah, alasan, pelaku, waktu nyata) + sale_cancellations struk lama.
-- Jalur khusus dibuka hanya lewat gerbang privat per-transaksi (pos_sale_edit_gate) yang tidak bisa ditulis klien.
-- Ditolak bila: periode tanggal struk/hari ini ditutup, rekonsiliasi bank menutupi rekening terkait, ada retur/refund,
-- pernah "batalkan penerimaan", bulan sudah digaji, poin pelanggan sudah terpakai, atau struk tanpa shift kasir.
set local lock_timeout = '5s';

-- ───────────── 1. Gerbang privat + jejak ─────────────
create table public.pos_sale_edit_gate(
 transaction_id bigint not null,
 backend_pid integer not null,
 sale_id uuid not null,
 accounts jsonb not null default '{}'::jsonb,
 primary key(transaction_id,backend_pid,sale_id)
);
alter table public.pos_sale_edit_gate enable row level security;
revoke all on public.pos_sale_edit_gate from public,anon,authenticated,service_role;

create function public.pos_sale_edit_allowed(p_sale_id uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_edit_gate g
  where g.transaction_id=txid_current() and g.backend_pid=pg_backend_pid() and g.sale_id=p_sale_id)
$$;
revoke all on function public.pos_sale_edit_allowed(uuid) from public,anon,authenticated,service_role;
grant execute on function public.pos_sale_edit_allowed(uuid) to authenticated,service_role;

create table public.sale_edits(
 id uuid primary key,
 old_sale_id uuid not null unique references public.sales(id) on delete restrict,
 new_sale_id uuid not null unique references public.sales(id) on delete restrict,
 branch_id uuid not null references public.branches(id),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 before_value jsonb not null,
 after_value jsonb not null,
 cancellation_id uuid not null references public.sale_cancellations(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check(old_sale_id<>new_sale_id)
);
comment on table public.sale_edits is 'Ubah transaksi struk kasir: struk lama (dibatalkan) -> struk baru di tanggal asli. Waktu nyata = created_at.';
alter table public.sale_edits enable row level security;
create policy sale_edits_read on public.sale_edits for select to authenticated
 using (public.user_can_access_branch(branch_id) and public.sales_module_access());
revoke all on public.sale_edits from public,anon,authenticated,service_role;
grant select on public.sale_edits to authenticated;
create function public.guard_sale_edits_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Riwayat ubah transaksi tidak dapat diubah atau dihapus';end $$;
create trigger sale_edits_immutable before update or delete on public.sale_edits
 for each row execute function public.guard_sale_edits_immutable();

create table public.sale_edit_requests(
 actor_id uuid not null references public.profiles(id),
 request_key text not null check(length(request_key) between 1 and 120),
 sale_id uuid not null references public.sales(id),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table public.sale_edit_requests enable row level security;
revoke all on public.sale_edit_requests from public,anon,authenticated,service_role;

-- ───────────── 2. Patch berjangkar pada jalur resmi ─────────────
create function pg_temp.patch(fn text, pairs text[], marker text) returns void language plpgsql as $f$
declare body text;i integer;n integer;
begin
 body:=pg_get_functiondef(fn::regprocedure);
 if position(marker in body)>0 then raise exception '% already present in %',marker,fn;end if;
 for i in 1..array_length(pairs,1)/2 loop
  n:=(length(body)-length(replace(body,pairs[2*i-1],'')))/length(pairs[2*i-1]);
  if n<>1 then raise exception '% anchor % found % time(s) in %, expected 1',marker,i,n,fn;end if;
  body:=replace(body,pairs[2*i-1],pairs[2*i]);
 end loop;
 if position(marker in body)=0 then raise exception '% marker missing after patch of %',marker,fn;end if;
 execute body;
end $f$;
-- Sisipkan satu baris pengecualian tepat sesudah "begin" pertama badan fungsi trigger.
create function pg_temp.bypass(fn text, line text, marker text) returns void language plpgsql as $f$
declare body text;p integer;
begin
 body:=pg_get_functiondef(fn::regprocedure);
 if position(marker in body)>0 then raise exception '% already present in %',marker,fn;end if;
 p:=position(E'\nbegin\n' in body);
 if p=0 then raise exception '% begin anchor missing in %',marker,fn;end if;
 body:=left(body,p+6)||' -- '||marker||': ubah transaksi resmi (gerbang privat) membawa isi asli apa adanya.'||E'\n '||line||E'\n'||substr(body,p+7);
 execute body;
end $f$;

-- 2a. Pelaku: struk baru milik kasir asal & shift asal (mungkin sudah ditutup); hanya periode yang tetap diperiksa.
select pg_temp.patch('public.pos_sale_assert_actor(sales)', array[
 $a$begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or p_sale.cashier_id is distinct from auth.uid()$a$,
 $r$begin
 -- UBAH_STRUK: struk pengganti hasil ubah transaksi resmi tetap milik kasir & shift asal.
 if public.pos_sale_edit_allowed(p_sale.id) then
  if exists(select 1 from public.accounting_locks where id and (p_sale.created_at at time zone 'Asia/Jakarta')::date<=closed_until) then
   raise exception 'Periode akuntansi sudah ditutup';end if;
  return;
 end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or p_sale.cashier_id is distinct from auth.uid()$r$], 'UBAH_STRUK');

-- 2b. Snapshot kasir/karyawan: struk pengganti membawa snapshot asli.
select pg_temp.bypass('public.snapshot_operational_employee()',
 $l$if tg_op='INSERT' and tg_table_name='sales' and public.pos_sale_edit_allowed((to_jsonb(new)->>'id')::uuid) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.snapshot_service_cashier()',
 $l$if tg_op='INSERT' and tg_table_name='sales' and public.pos_sale_edit_allowed((to_jsonb(new)->>'id')::uuid) then return new;end if;$l$, 'UBAH_STRUK');

-- 2c. Promo/voucher/kampanye lama terbawa apa adanya (3A): pemeriksaan ulang aturan & kuota dilewati hanya di gerbang.
select pg_temp.bypass('public.promo_sh_claim_guard()',
 $l$if tg_op='INSERT' and public.pos_sale_edit_allowed(new.sale_id) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.quantity_pool_claim_guard()',
 $l$if tg_op='INSERT' and public.pos_sale_edit_allowed(new.sale_id) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.promo_sh_sale_guard()',
 $l$if public.pos_sale_edit_allowed(new.id) and (tg_op='INSERT' or old.payments_finalized_at is null) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.quantity_pool_finalize_guard()',
 $l$if public.pos_sale_edit_allowed(new.id) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.promo_sh_finalize_guard()',
 $l$if public.pos_sale_edit_allowed(new.id) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.guard_campaign_code_use()',
 $l$if tg_table_name='sales' and tg_op='INSERT' and public.pos_sale_edit_allowed((to_jsonb(new)->>'id')::uuid) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.guard_campaign_code_finalize()',
 $l$if public.pos_sale_edit_allowed(new.id) then return new;end if;$l$, 'UBAH_STRUK');
-- Diskon manual (20261116100000): struk pengganti membawa diskon lama apa adanya. Peran tanpa izin diskon manual tetap tidak boleh
-- MENAIKKAN total diskon lewat ubah transaksi (dibandingkan dengan struk yang diganti); peran berizin / Owner bebas seperti di kasir.
select pg_temp.bypass('public.guard_sale_item_manual_discount()',
 $l$if public.pos_sale_edit_allowed(new.sale_id) then return new;end if;$l$, 'UBAH_STRUK');
select pg_temp.bypass('public.guard_sale_manual_discount()',
 $l$if public.pos_sale_edit_allowed(new.id) then
  if auth.uid() is not null and not public.manual_discount_allowed()
   and coalesce(new.discount,0)+coalesce(new.diskon_kategori,0)>coalesce((select max(coalesce(o.discount,0)+coalesce(o.diskon_kategori,0)) from public.pos_sale_edit_gate g
    join public.sales o on o.id=g.sale_id where g.transaction_id=txid_current() and g.backend_pid=pg_backend_pid() and g.sale_id<>new.id),0)+0.005 then
   raise exception 'Anda tidak punya izin menambah diskon manual. Diskon struk hasil ubah tidak boleh lebih besar dari struk asal; minta Owner mengubahnya.' using errcode='42501';
  end if;
  return new;
 end if;$l$, 'UBAH_STRUK');
-- Pembatalan struk yang pernah dikoreksi metode bayarnya: varian ubah membalik seluruh rantai jurnal koreksinya.
select pg_temp.bypass('public.guard_corrected_sale_cancellation()',
 $l$if public.pos_sale_edit_allowed(old.id) then return new;end if;$l$, 'UBAH_STRUK');

-- 2d. Stok struk pengganti keluar HARI INI (2A) walau tanggal struk lebih awal.
select pg_temp.patch('public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)', array[
 $a$ if p_tanggal is distinct from (s.created_at at time zone 'Asia/Jakarta')::date
  or p_tanggal$a$,
 $r$ -- UBAH_STRUK: struk pengganti mengeluarkan stok di hari ubah (tanggal struk tetap tanggal asli).
 if (p_tanggal is distinct from (s.created_at at time zone 'Asia/Jakarta')::date and not public.pos_sale_edit_allowed(s.id))
  or p_tanggal$r$], 'UBAH_STRUK');

-- 2e. Jurnal HPP struk pengganti di hari ubah; jurnal pendapatan tetap di tanggal struk.
select pg_temp.patch('public.finalize_pos_sale(uuid)', array[
 $a$perform public.sales_write_journal(d,sale.branch_id,'sale-hpp'$a$,
 $r$perform public.sales_write_journal(case when public.pos_sale_edit_allowed(sale.id) then (now() at time zone 'Asia/Jakarta')::date else d end /* UBAH_STRUK */,sale.branch_id,'sale-hpp'$r$], 'UBAH_STRUK');

-- 2f. Rekening pembayaran: metode yang sudah ada di struk asal tetap di rekening tercatatnya.
select pg_temp.patch('public.pos_sale_record_payments()', array[
 $a$  account_code:=public.unit_posting_cash(r.method,new.branch_id);$a$,
 $r$  -- UBAH_STRUK: metode yang sudah ada di struk asal tetap di rekening tercatatnya; metode baru memakai peta sekarang.
  account_code:=coalesce((select g.accounts->r.method->>'code' from public.pos_sale_edit_gate g
   where g.transaction_id=txid_current() and g.backend_pid=pg_backend_pid() and g.sale_id=new.id),
   public.unit_posting_cash(r.method,new.branch_id));$r$,
 $a$  select * into cash_account from public.cash_accounts where coa_code=account_code and is_active and (branch_id is null or branch_id=new.branch_id) for share;$a$,
 $r$  select * into cash_account from public.cash_accounts where coa_code=account_code and is_active and (branch_id is null or branch_id=new.branch_id)
   and id=coalesce((select (g.accounts->r.method->>'cash_account_id')::uuid from public.pos_sale_edit_gate g
    where g.transaction_id=txid_current() and g.backend_pid=pg_backend_pid() and g.sale_id=new.id),id) for share;$r$], 'UBAH_STRUK');

-- 2g. Pembatalan resmi: struk hasil ubah punya jurnal HPP bertanggal hari ubah (>= tanggal struk).
select pg_temp.patch('public.cancel_posted_sale(uuid,integer,text,text)', array[
 $a$if j.branch_id is distinct from s.branch_id or j.tanggal<>original_date or j.voided_at is not null$a$,
 $r$if j.branch_id is distinct from s.branch_id or j.voided_at is not null
   -- UBAH_STRUK: jurnal pendapatan di tanggal struk; jurnal HPP struk hasil ubah di hari ubah (tidak sebelum tanggal struk).
   or (j.source=v_source and j.tanggal<>original_date) or (j.source<>v_source and j.tanggal not between original_date and d)$r$], 'UBAH_STRUK');

-- ───────────── 3. Varian internal pembatalan untuk ubah transaksi ─────────────
do $variant$
declare body text;pairs text[];i integer;n integer;
begin
 body:=pg_get_functiondef('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure);
 pairs:=array[
  -- nama
  $a$CREATE OR REPLACE FUNCTION public.cancel_posted_sale($a$, $r$CREATE FUNCTION public.pos_sale_edit_void($r$,
  -- hanya lewat gerbang ubah transaksi
  $a$ if not found then raise exception 'Penjualan tidak ditemukan';end if;$a$,
  $r$ if not found then raise exception 'Penjualan tidak ditemukan';end if;
 -- UBAH_STRUK_VOID: hanya dipanggil edit_posted_pos_sale di dalam gerbang privat.
 if not public.pos_sale_edit_allowed(s.id) then raise exception 'Ubah transaksi hanya melalui tindakan resmi' using errcode='42501';end if;$r$,
  -- Owner + Finance
  $a$ perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER';
 if not found then raise exception 'Hanya Super Admin aktif yang dapat membatalkan penjualan' using errcode='42501';end if;$a$,
  $r$ perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','FINANCE');
 if not found then raise exception 'Hanya Owner atau Finance aktif yang dapat mengubah transaksi' using errcode='42501';end if;$r$,
  $a$ if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then raise exception 'Hanya Super Admin aktif yang dapat membatalkan penjualan' using errcode='42501';end if;$a$,
  $r$ if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','FINANCE')) then raise exception 'Hanya Owner atau Finance aktif yang dapat mengubah transaksi' using errcode='42501';end if;$r$,
  -- shift sudah ditutup boleh (angka tutup shift tidak disentuh)
  $a$ if s.shift_id is not null and not unpaid then
  perform 1 from public.cashier_shifts where id=s.shift_id and status='open' for update;
  if not found then raise exception 'Shift penjualan sudah ditutup. Rekonsiliasi kas shift diperlukan sebelum koreksi';end if;
 end if;$a$,
  $r$ -- UBAH_STRUK_VOID: shift asal boleh sudah ditutup; angka tutup shift tidak disentuh.$r$,
  -- promo/voucher terbawa ke struk pengganti (3A)
  $a$ if s.voucher_code is not null or exists(select 1 from public.sale_items where sale_id=s.id and promo_id is not null) then raise exception 'Penjualan memakai voucher atau promo. Rekonsiliasi kuota promo diperlukan sebelum pembatalan';end if;$a$,
  $r$ -- UBAH_STRUK_VOID: promo/voucher terbawa apa adanya ke struk pengganti (kuota tidak berubah).$r$,
  -- efek quest staf dipindah ke struk pengganti oleh pemanggil
  $a$ perform public.reverse_sale_staff_effects(s,audit);$a$,
  $r$ -- UBAH_STRUK_VOID: efek quest staf tidak dibalik; edit_posted_pos_sale memindahkannya ke struk pengganti.$r$,
  -- rantai jurnal koreksi metode bayar ikut dibalik
  $a$ for j in select e.* from public.journal_entries e where (e.source in(v_source,v_source||'-hpp') and e.source_ref=s.no_struk)
   or (e.source in('sale-receipt-cancel','sale-receipt-repost')$a$,
  $r$ for j in select e.* from public.journal_entries e where (e.source in(v_source,v_source||'-hpp') and e.source_ref=s.no_struk)
   or (e.source in('sale-payment-reversal','sale-payment-repost') and e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=s.id))
   or (e.source in('sale-receipt-cancel','sale-receipt-repost')$r$,
  -- tanggal pembalik: pendapatan/kas di tanggal jurnalnya sendiri, HPP hari ini (2A)
  $a$values(reversal,public.sales_next_number('JRN',d),d,'Pembatalan '||s.no_struk,$a$,
  $r$values(reversal,public.sales_next_number('JRN',case when j.source=v_source||'-hpp' then d else j.tanggal end),
    case when j.source=v_source||'-hpp' then d else j.tanggal end,'Ubah transaksi '||s.no_struk,$r$
 ];
 for i in 1..array_length(pairs,1)/2 loop
  n:=(length(body)-length(replace(body,pairs[2*i-1],'')))/length(pairs[2*i-1]);
  if n<>1 then raise exception 'UBAH_STRUK_VOID anchor % found % time(s), expected 1',i,n;end if;
  body:=replace(body,pairs[2*i-1],pairs[2*i]);
 end loop;
 execute body;
end $variant$;
revoke all on function public.pos_sale_edit_void(uuid,integer,text,text) from public,anon,authenticated,service_role;

-- ───────────── 4. RPC ubah transaksi ─────────────
create function public.edit_posted_pos_sale(p_sale_id uuid, p_expected_revision integer, p_request_key text, p_reason text, p_edit jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid();s public.sales%rowtype;prior public.sale_edit_requests%rowtype;payload jsonb;result jsonb;
 h jsonb;new_id uuid:=gen_random_uuid();audit uuid:=gen_random_uuid();voided jsonb;base text;new_no text;n integer;
 accounts jsonb;line jsonb;comp jsonb;line_id uuid;pos integer:=0;wh uuid;posted jsonb;needs_stock boolean;
 closed date;today date:=(now() at time zone 'Asia/Jakarta')::date;original_date date;
 gross numeric;manual numeric;item_discount numeric;after_items numeric:=0;before_v jsonb;after_v jsonb;
 codes text[];
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 114
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
  or jsonb_typeof(p_edit) is distinct from 'object' or jsonb_typeof(p_edit->'header') is distinct from 'object'
  or jsonb_typeof(p_edit->'lines') is distinct from 'array' or jsonb_array_length(p_edit->'lines') not between 1 and 300 then
  raise exception 'Isi ubah transaksi tidak valid' using errcode='22023';end if;
 perform 1 from public.profiles where id=actor and is_active and role in('OWNER','FINANCE');
 if not found then raise exception 'Hanya Owner atau Finance aktif yang dapat mengubah transaksi' using errcode='42501';end if;
 payload:=jsonb_build_object('sale_id',p_sale_id,'revision',p_expected_revision,'reason',btrim(p_reason),'edit',p_edit);
 perform pg_advisory_xact_lock(hashtextextended('vetos:pos-sale-edit:'||actor::text||':'||p_request_key,0));
 select * into prior from public.sale_edit_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas simpan sudah dipakai untuk isi berbeda';end if;
  return prior.result;
 end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan';end if;
 perform public.sales_assert_access(s.branch_id);
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang sebelum mengubah';end if;
 if s.channel is not null then raise exception 'Ubah transaksi hanya untuk struk kasir petshop';end if;
 if s.voided_at is not null then raise exception 'Penjualan sudah dibatalkan atau sudah diubah';end if;
 if s.payment_plan is null or s.payments_finalized_at is null then raise exception 'Pembayaran struk belum selesai';end if;
 if s.shift_id is null then raise exception 'Struk tanpa shift kasir belum bisa diubah dari sini';end if;
 if exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id) then
  raise exception 'Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini';end if;
 original_date:=(s.created_at at time zone 'Asia/Jakarta')::date;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and (original_date<=closed or today<=closed) then
  raise exception 'Periode tanggal struk atau hari ini sudah ditutup buku';end if;
 if exists(select 1 from public.journal_entries e where e.source in('sale-payment-reversal','sale-payment-repost')
  and e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=s.id) and closed is not null and e.tanggal<=closed) then
  raise exception 'Jurnal koreksi struk ini ada di periode yang sudah ditutup buku';end if;

 h:=p_edit->'header';
 -- Rekening yang dipakai: tercatat untuk metode yang sudah ada, peta sekarang untuk metode baru.
 select coalesce(jsonb_object_agg(method,jsonb_build_object('code',coa_code,'cash_account_id',account_snapshot->>'cash_account_id')),'{}'::jsonb)
  into accounts from public.sale_payments where sale_id=s.id;
 select array_agg(distinct c) into codes from (
  select coa_code c from public.sale_payments where sale_id=s.id
  union select public.unit_posting_cash(x.method,s.branch_id) from jsonb_to_recordset(coalesce(h->'payment_plan','[]'::jsonb)) x(method text)
 ) z where c is not null;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=original_date and (c.id is null or c.code=any(codes))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening struk ini; koreksi rekonsiliasi dahulu';end if;

 before_v:=jsonb_build_object('sale',to_jsonb(s),
  'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.source_position nulls last,i.id),'[]') from public.sale_items i where i.sale_id=s.id),
  'components',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sale_item_id,c.sort_order,c.id),'[]') from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id),
  'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]') from public.sale_payments p where p.sale_id=s.id));

 insert into public.pos_sale_edit_gate(transaction_id,backend_pid,sale_id,accounts)
  values(txid_current(),pg_backend_pid(),s.id,'{}'::jsonb),(txid_current(),pg_backend_pid(),new_id,accounts);
 voided:=public.pos_sale_edit_void(s.id,s.revision,'ubah:'||p_request_key,'Diubah: '||btrim(p_reason));
 if voided->>'voided' is distinct from 'true' then raise exception 'Struk lama belum berhasil ditutup';end if;

 base:=regexp_replace(s.no_struk,'-U[0-9]+$','');
 select coalesce(max(substring(no_struk from '-U([0-9]+)$')::integer),0)+1 into n
  from public.sales where left(no_struk,length(base)+2)=base||'-U' and substring(no_struk from length(base)+3) ~ '^[0-9]+$';
 new_no:=base||'-U'||n;
 if length(new_no)>64 then raise exception 'Nomor struk terlalu panjang untuk diubah lagi';end if;

 insert into public.sales(id,branch_id,customer_id,pet_id,no_struk,subtotal,discount,diskon_kategori,total,merchant_fee_total,
  metode_bayar,bayar,kembali,payment_plan,checkout_key,checkout_fingerprint,poin_earned,poin_digunakan,voucher_code,campaign_code,
  cashier_id,shift_id,salesperson_id,cashier_name,cashier_employee_id,created_at,quest_effects_tracked,
  promo_pick_id,promo_pick_mode,promo_pick_exclusive,promo_selection,manual_discount)
 values(new_id,s.branch_id,s.customer_id,s.pet_id,new_no,(h->>'subtotal')::numeric,(h->>'discount')::numeric,
  coalesce((h->>'diskon_kategori')::numeric,s.diskon_kategori),(h->>'total')::numeric,coalesce((h->>'merchant_fee_total')::numeric,0),
  h->>'metode_bayar',(h->>'bayar')::numeric,coalesce((h->>'kembali')::numeric,0),h->'payment_plan',
  'ubah:'||audit::text,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
  coalesce((h->>'poin_earned')::integer,s.poin_earned),coalesce((h->>'poin_digunakan')::integer,s.poin_digunakan),
  s.voucher_code,s.campaign_code,s.cashier_id,s.shift_id,s.salesperson_id,s.cashier_name,s.cashier_employee_id,
  s.created_at+interval '1 millisecond',s.quest_effects_tracked,s.promo_pick_id,s.promo_pick_mode,s.promo_pick_exclusive,s.promo_selection,
  least(coalesce(s.manual_discount,0),greatest(coalesce((h->>'discount')::numeric,0),0)));

 for line in select value from jsonb_array_elements(p_edit->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or (line->>'qty')::numeric is null or (line->>'harga')::numeric is null then
   raise exception 'Rincian barang tidak valid' using errcode='22023';end if;
  line_id:=gen_random_uuid();
  insert into public.sale_items(id,sale_id,item_id,nama,qty,harga,source_position,quantity_pool_claim,satuan,faktor,target_species,
   service_performers,item_discount_type,item_discount_value,promo_id,promo_discount,promo_claim_id,promo_sets,promo_syarat_units,
   promo_hasil_units,promo_floor_waiver,hpp)
  values(line_id,new_id,nullif(line->>'item_id','')::uuid,line->>'nama',(line->>'qty')::numeric,(line->>'harga')::numeric,pos,
   coalesce((line->>'quantity_pool_claim')::boolean,false),nullif(line->>'satuan',''),coalesce((line->>'faktor')::numeric,1),
   coalesce(nullif(line->>'target_species',''),'Universal'),case when jsonb_typeof(line->'service_performers')='object' then line->'service_performers' end,
   nullif(line->>'item_discount_type',''),coalesce((line->>'item_discount_value')::numeric,0),nullif(line->>'promo_id','')::uuid,
   coalesce((line->>'promo_discount')::numeric,0),nullif(line->>'promo_claim_id','')::uuid,coalesce((line->>'promo_sets')::integer,0),
   coalesce((line->>'promo_syarat_units')::numeric,0),coalesce((line->>'promo_hasil_units')::numeric,0),
   coalesce((line->>'promo_floor_waiver')::boolean,false),case when nullif(line->>'item_id','') is null then null else 0 end);
  for comp in select value from jsonb_array_elements(coalesce(line->'components','[]'::jsonb)) loop
   insert into public.sale_item_group_components(sale_item_id,component_item_id,component_code,component_name,item_type,
    qty_per_group,unit,factor,total_base_qty,sort_order)
   values(line_id,(comp->>'component_item_id')::uuid,comp->>'component_code',comp->>'component_name',comp->>'item_type',
    (comp->>'qty_per_group')::numeric,comp->>'unit',(comp->>'factor')::numeric,(comp->>'total_base_qty')::numeric,
    coalesce((comp->>'sort_order')::integer,0));
  end loop;
  pos:=pos+1;
 end loop;

 -- Harga neto header tidak boleh melebihi total rincian sesudah diskon baris (aturan kasir yang sama).
 for line in select to_jsonb(i) from public.sale_items i where i.sale_id=new_id loop
  gross:=(line->>'qty')::numeric*(line->>'harga')::numeric;
  manual:=case when line->>'item_discount_type'='percent' then round(gross*coalesce((line->>'item_discount_value')::numeric,0)/100,0)
   else coalesce((line->>'item_discount_value')::numeric,0) end;
  item_discount:=least(greatest(case when manual>0 then manual else coalesce((line->>'promo_discount')::numeric,0) end,0),gross);
  after_items:=after_items+gross-item_discount;
 end loop;
 if (h->>'total')::numeric-coalesce((h->>'merchant_fee_total')::numeric,0)>after_items then
  raise exception 'Total struk melebihi total rincian sesudah diskon baris' using errcode='22023';end if;

 needs_stock:=exists(select 1 from public.sale_items i join public.items m on m.id=i.item_id where i.sale_id=new_id
   and (m.item_type='Persediaan' or (m.item_type='Grup' and exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id and c.item_type='Persediaan'))));
 if needs_stock then
  select warehouse_id into wh from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group') order by id limit 1;
  if wh is null then
   select id into wh from public.warehouses where branch_id=s.branch_id and is_active order by type limit 1;end if;
  if wh is null then raise exception 'Cabang belum punya gudang aktif untuk memotong stok';end if;
  posted:=public.cashier_post_stock_atomic(new_id,wh);
 else
  posted:=public.finalize_pos_sale(new_id);
 end if;
 if posted->>'finalized' is distinct from 'true' then raise exception 'Struk pengganti belum berhasil dibukukan';end if;

 -- Efek quest staf (aktivitas kasir yang sama) pindah ke struk pengganti.
 update public.sale_staff_effects set sale_id=new_id where sale_id=s.id and reversed_at is null;
 if s.customer_id is not null then perform public.refresh_customer_spending(s.customer_id);end if;

 select to_jsonb(x) into after_v from public.sales x where id=new_id;
 after_v:=jsonb_build_object('sale',after_v,
  'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.source_position,i.id),'[]') from public.sale_items i where i.sale_id=new_id),
  'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]') from public.sale_payments p where p.sale_id=new_id));
 insert into public.sale_edits(id,old_sale_id,new_sale_id,branch_id,reason,before_value,after_value,cancellation_id,created_by)
  values(audit,s.id,new_id,s.branch_id,btrim(p_reason),before_v,after_v,(voided->>'audit_id')::uuid,actor);
 delete from public.pos_sale_edit_gate where transaction_id=txid_current() and backend_pid=pg_backend_pid() and sale_id in(s.id,new_id);
 result:=jsonb_build_object('old_sale_id',s.id,'sale_id',new_id,'no_struk',new_no,'edit_id',audit,'revision',s.revision+1);
 insert into public.sale_edit_requests(actor_id,request_key,sale_id,payload,result) values(actor,p_request_key,s.id,payload,result);
 return result;
end $$;
revoke all on function public.edit_posted_pos_sale(uuid,integer,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_posted_pos_sale(uuid,integer,text,text,jsonb) to authenticated;
