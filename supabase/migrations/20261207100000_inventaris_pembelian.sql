-- Catat Pembelian di Inventaris Operasional (permintaan Mba Anisa via Nje, 23 Nov 2026; arahan "langsung eksekusi").
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Satu simpan = SATU transaksi database:
--   Kas Keluar biasa (public.cash_entries, nomor KK dari document_numbering) + jurnal 'kas-entry' seimbang
--   (Dr akun beban pembelian / Cr akun rekening kas) + nota (document_attachments modul 'pengeluaran')
--   + jumlah barang inventaris bertambah + riwayat 'pembelian' + baris penghubung operational_inventory_purchases.
--   Salah satu gagal = semuanya batal. Kiriman ulang (kunci sama, isi sama) mengembalikan hasil pertama.
-- Bukan barang jual: tidak menyentuh items/stock/kartu stok. Opname dan jumlah awal tetap kuantitas saja (tanpa jurnal).
--
-- Siapa: hanya FINANCE aktif (keputusan klien via Nje), yang juga lolos gerbang menu Inventaris Operasional
-- (inventaris_operasional_allowed: Akses Grup / akses khusus) dan akses cabang (user_can_access_branch). Owner, Admin,
-- staf: tidak bisa mencatat/membatalkan pembelian (tetap bisa membaca bila lolos gerbang menu + cabang).
-- Kas: rekening kas/bank aktif milik cabang itu atau rekening umum (branch_id null) — kas kecil salah satunya.
-- Aturan persetujuan "kas-keluar" tetap berlaku (pola purchase_payment_atomic): di atas batas nominal wajib pengajuan
-- berstatus 'disetujui' dengan kunci yang sama dengan Kas Keluar biasa, dipakai ('terpakai') di transaksi yang sama.
--
-- Akun beban: operational_inventory_settings.beban_code, bawaan '740001' (Beban Perlengkapan Toko) = ASUMSI UJI;
-- kode final menunggu konfirmasi klien. Mengganti akun dengan aman (hanya berlaku untuk pembelian BARU; jurnal lama
-- tetap pada akun saat dibukukan dan tercatat di operational_inventory_purchases.beban_code):
--   update public.operational_inventory_settings set beban_code='<kode akun detail BEBAN aktif>' where id;
-- (dijalankan pemilik DB dalam migrasi kecil; trigger menolak akun induk/nonaktif/bukan BEBAN/akun rekening kas).
--
-- Pembatalan/koreksi: HANYA dari menu Inventaris Operasional (inventaris_operasional_batal_pembelian) yang membatalkan
-- Kas Keluar lewat jalur resmi revise_cash_entry (jurnal pembalik) DAN mengurangi jumlah barang dalam transaksi yang sama.
-- Koreksi = batalkan lalu catat ulang. Jalur kas umum (revise_cash_entry edit/void, UPDATE/DELETE langsung cash_entries,
-- ubah/hapus lampiran notanya) ditolak untuk Kas Keluar pembelian ini (pola "refund retur hanya dikoreksi bersama
-- catatan retur"), supaya jumlah inventaris tidak tertinggal salah.
--
-- Batal (sebelum ada data nyata):
--   drop trigger invop_purchase_cash_guard on public.cash_entries; drop trigger invop_purchase_attachment_guard on public.document_attachments;
--   drop function public.inventaris_operasional_batal_pembelian(text,uuid,text); drop function public.inventaris_operasional_beli(text,uuid,jsonb,numeric,numeric,uuid,text,jsonb);
--   drop function public.inventaris_operasional_beli_allowed(); drop function invop_private.guard_purchase_cash(); drop function invop_private.guard_purchase_attachment();
--   drop table public.operational_inventory_purchases cascade; drop table public.operational_inventory_settings; drop schema invop_private cascade;
--   alter table public.operational_inventory_history drop column purchase_id; (lalu kembalikan cek jenis seperti 20261206100000).
set local lock_timeout='5s';

create schema if not exists invop_private;
revoke all on schema invop_private from public, anon, authenticated, service_role;

-- ───────────── 1. Pengaturan akun beban (satu baris) ─────────────
create table public.operational_inventory_settings(
 id boolean primary key default true check (id),
 beban_code text not null default '740001',
 updated_at timestamptz not null default now()
);
insert into public.operational_inventory_settings(id) values (true);
alter table public.operational_inventory_settings enable row level security;
revoke all on public.operational_inventory_settings from public, anon, authenticated, service_role;
grant select on public.operational_inventory_settings to authenticated;
create policy operational_inventory_settings_read on public.operational_inventory_settings for select to authenticated
 using ((select public.inventaris_operasional_allowed()));
comment on table public.operational_inventory_settings is
 'Akun beban untuk Catat Pembelian Inventaris Operasional. 740001 = asumsi uji; ganti hanya lewat migrasi (berlaku untuk pembelian baru).';

create function invop_private.check_beban_code() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if not exists(select 1 from public.coa_accounts a where a.code=new.beban_code and a.is_active and not a.is_header and a.type='BEBAN')
    or exists(select 1 from public.cash_accounts c where c.coa_code=new.beban_code) then
  raise exception 'Akun beban pembelian inventaris harus akun detail BEBAN yang aktif dan bukan rekening kas/bank (%).', new.beban_code;
 end if;
 new.updated_at := now();
 return new;
end $fn$;
revoke all on function invop_private.check_beban_code() from public, anon, authenticated, service_role;
create trigger invop_settings_check before insert or update on public.operational_inventory_settings
 for each row execute function invop_private.check_beban_code();
update public.operational_inventory_settings set beban_code=beban_code where id;  -- validasi baris bawaan sekarang (gagal tertutup)

-- ───────────── 2. Penghubung pembelian ↔ Kas Keluar ↔ barang ─────────────
create table public.operational_inventory_purchases(
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null references public.branches(id),
 item_id uuid not null references public.operational_inventory_items(id),
 cash_entry_id uuid not null unique references public.cash_entries(id),
 journal_entry_id uuid not null references public.journal_entries(id),
 no_bukti text not null,
 tanggal date not null,
 qty numeric(14,2) not null check (qty>0),
 nominal numeric(16,2) not null check (nominal>0 and nominal<=1000000000000),
 cash_account_id uuid not null references public.cash_accounts(id),
 beban_code text not null,
 catatan text check (catatan is null or length(catatan)<=500),
 actor_id uuid not null references public.profiles(id),
 actor_nama text not null,
 request_key text not null check (length(request_key) between 8 and 160),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 voided_at timestamptz,
 voided_by uuid references public.profiles(id),
 void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 1000),
 void_request_key text,
 void_cash_revision_id uuid,
 unique(actor_id,request_key),
 check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index operational_inventory_purchases_branch on public.operational_inventory_purchases(branch_id,created_at desc);
create index operational_inventory_purchases_item on public.operational_inventory_purchases(item_id);
alter table public.operational_inventory_purchases enable row level security;
revoke all on public.operational_inventory_purchases from public, anon, authenticated, service_role;
grant select on public.operational_inventory_purchases to authenticated;
create policy operational_inventory_purchases_read on public.operational_inventory_purchases for select to authenticated
 using ((select public.inventaris_operasional_allowed()) and public.user_can_access_branch(branch_id));
comment on table public.operational_inventory_purchases is
 'Pembelian Inventaris Operasional: satu Kas Keluar (cash_entries) + jurnal + penambahan jumlah barang. Ditulis hanya lewat RPC; dibatalkan hanya lewat menu Inventaris Operasional.';

-- Riwayat: jenis baru 'pembelian' dan 'batal_pembelian', terhubung ke baris pembelian.
alter table public.operational_inventory_history add column purchase_id uuid references public.operational_inventory_purchases(id);
alter table public.operational_inventory_history drop constraint operational_inventory_history_jenis_check;
alter table public.operational_inventory_history drop constraint operational_inventory_history_check;
alter table public.operational_inventory_history add constraint operational_inventory_history_jenis_check
 check (jenis in ('saldo_awal','opname','pembelian','batal_pembelian'));
alter table public.operational_inventory_history add constraint operational_inventory_history_sumber_check check (
 (jenis='saldo_awal' and count_id is null and purchase_id is null and qty_sebelum=0)
 or (jenis='opname' and count_id is not null and purchase_id is null)
 or (jenis='pembelian' and purchase_id is not null and count_id is null and qty_sesudah>qty_sebelum)
 or (jenis='batal_pembelian' and purchase_id is not null and count_id is null and qty_sesudah<qty_sebelum));
create index operational_inventory_history_purchase on public.operational_inventory_history(purchase_id) where purchase_id is not null;

-- ───────────── 3. Izin sekali pakai untuk jalur pembatalan resmi ─────────────
create table invop_private.cash_permits(
 xid text not null,
 cash_entry_id uuid not null,
 primary key (xid,cash_entry_id)
);
revoke all on invop_private.cash_permits from public, anon, authenticated, service_role;

-- Kas Keluar pembelian tidak boleh diubah/dihapus selain oleh pembatalan resmi di menu Inventaris Operasional.
create function invop_private.guard_purchase_cash() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if exists(select 1 from public.operational_inventory_purchases p where p.cash_entry_id=old.id)
    and not exists(select 1 from invop_private.cash_permits k where k.xid=pg_current_xact_id()::text and k.cash_entry_id=old.id) then
  raise exception 'INVENTARIS_KAS_TERKUNCI: Kas Keluar % berasal dari pembelian Inventaris Operasional. Batalkan dari menu Inventaris Operasional supaya jumlah barang ikut dikoreksi.', old.no_bukti
   using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
revoke all on function invop_private.guard_purchase_cash() from public, anon, authenticated, service_role;
create trigger invop_purchase_cash_guard before update or delete on public.cash_entries
 for each row execute function invop_private.guard_purchase_cash();

create function invop_private.guard_purchase_attachment() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if old.modul='pengeluaran' and exists(select 1 from public.operational_inventory_purchases p where p.cash_entry_id=old.ref_id) then
  raise exception 'INVENTARIS_NOTA_TERKUNCI: nota pembelian Inventaris Operasional tidak dapat diubah atau dihapus' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
revoke all on function invop_private.guard_purchase_attachment() from public, anon, authenticated, service_role;
create trigger invop_purchase_attachment_guard before update or delete on public.document_attachments
 for each row execute function invop_private.guard_purchase_attachment();

-- ───────────── 4. Gerbang: Finance aktif + menu + cabang ─────────────
create function public.inventaris_operasional_beli_allowed() returns boolean
language sql stable security definer set search_path='' as $fn$
 select coalesce((select p.role::text='FINANCE' from public.profiles p where p.id=auth.uid() and p.is_active),false)
   and public.inventaris_operasional_allowed();
$fn$;
comment on function public.inventaris_operasional_beli_allowed() is 'Boleh mencatat/membatalkan pembelian Inventaris Operasional? Hanya FINANCE aktif yang lolos gerbang menu. Akses cabang dicek terpisah.';
revoke all on function public.inventaris_operasional_beli_allowed() from public, anon, service_role;
grant execute on function public.inventaris_operasional_beli_allowed() to authenticated;

-- ───────────── 5. Catat pembelian (atomik) ─────────────
-- p_item: {"id":uuid} barang aktif cabang ini, atau {"nama":text,"satuan":text} barang baru.
-- p_attachments: [{"path":"pengeluaran/...","nama":..,"mime":..,"ukuran":..}] 1-10 berkas (wajib).
create function public.inventaris_operasional_beli(p_request_key text, p_branch uuid, p_item jsonb, p_qty numeric,
 p_nominal numeric, p_account_id uuid, p_catatan text, p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_nama_pelaku text; v_old public.operational_inventory_purchases%rowtype; v_payload jsonb; v_today date;
 v_item public.operational_inventory_items%rowtype; v_rek public.cash_accounts%rowtype; v_beban text; v_cash_coa text;
 v_rule uuid; v_approval uuid; v_pola text; v_digit integer; v_prefix text; v_seq bigint; v_no text; v_cash uuid;
 v_journal uuid; v_purchase uuid; v_hist uuid; v_nama text; v_satuan text; v_catatan text; v_result jsonb; v_ket text;
begin
 v_nama_pelaku := public.inventaris_operasional_pelaku(p_branch);
 if not public.inventaris_operasional_beli_allowed() then
  raise exception 'INVENTARIS_PEMBELIAN_FINANCE: hanya Finance aktif yang dapat mencatat pembelian inventaris' using errcode='42501';
 end if;
 if p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'Kunci permintaan tidak valid'; end if;
 v_catatan := nullif(btrim(coalesce(p_catatan,'')),'');
 v_payload := jsonb_build_object('branch',p_branch,'item',p_item,'qty',p_qty,'nominal',p_nominal,'account',p_account_id,'catatan',v_catatan,'attachments',p_attachments);
 perform pg_advisory_xact_lock(hashtextextended('invop-beli:'||auth.uid()::text||':'||p_request_key,0));
 select * into v_old from public.operational_inventory_purchases where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if v_old.payload is distinct from v_payload then raise exception 'Kunci permintaan sudah dipakai untuk pembelian lain. Muat ulang halaman'; end if;
  return v_old.result;
 end if;

 if p_qty is null or p_qty<=0 or p_qty>=1e12 or p_qty<>round(p_qty,2) then raise exception 'Jumlah barang harus lebih dari 0 (maks. 2 desimal)'; end if;
 if p_nominal is null or p_nominal<=0 or p_nominal>1000000000000 or p_nominal<>round(p_nominal,2) then raise exception 'Nominal pembelian harus lebih dari 0 (maks. 2 desimal)'; end if;
 if v_catatan is not null and length(v_catatan)>500 then raise exception 'Catatan maksimal 500 huruf'; end if;
 if jsonb_typeof(p_attachments) is distinct from 'array' or jsonb_array_length(p_attachments) not between 1 and 10 then
  raise exception 'INVENTARIS_NOTA_WAJIB: lampiran nota wajib (1-10 berkas)';
 end if;
 if exists(select 1 from jsonb_array_elements(p_attachments) e where jsonb_typeof(e) is distinct from 'object')
    or exists(select 1 from jsonb_to_recordset(p_attachments) as x(path text,nama text,mime text,ukuran numeric)
   where path is null or left(path,12)<>'pengeluaran/' or position('..' in path)>0 or length(path)>2000
     or nama is null or length(nama) not between 1 and 200 or length(mime)>120
     or (ukuran is not null and (ukuran<=0 or ukuran>10485760 or ukuran<>trunc(ukuran)))) then
  raise exception 'INVENTARIS_NOTA_WAJIB: lampiran nota tidak valid';
 end if;

 v_today := (now() at time zone 'Asia/Jakarta')::date;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and v_today<=closed_until) then raise exception 'Periode akuntansi sudah ditutup'; end if;

 select * into v_rek from public.cash_accounts c where c.id=p_account_id and c.is_active and (c.branch_id is null or c.branch_id=p_branch) for share;
 if not found then raise exception 'INVENTARIS_KAS_TIDAK_SAH: rekening kas/bank tidak aktif atau bukan milik cabang ini'; end if;
 select a.code into v_cash_coa from public.coa_accounts a where a.code=v_rek.coa_code and a.is_active and not a.is_header;
 if v_cash_coa is null then raise exception 'INVENTARIS_KAS_TIDAK_SAH: akun rekening kas/bank tidak aktif'; end if;

 select s.beban_code into v_beban from public.operational_inventory_settings s where s.id for share;
 if v_beban is null or not exists(select 1 from public.coa_accounts a where a.code=v_beban and a.is_active and not a.is_header and a.type='BEBAN')
    or exists(select 1 from public.cash_accounts c where c.coa_code=v_beban) then
  raise exception 'INVENTARIS_AKUN_BEBAN: akun beban pembelian inventaris belum valid';
 end if;

 -- Barang: yang sudah ada (dikunci) atau baru.
 if jsonb_typeof(p_item) is distinct from 'object' then raise exception 'Barang tidak valid'; end if;
 if p_item ? 'id' then
  select * into v_item from public.operational_inventory_items i
   where i.id=(case when (p_item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_item->>'id')::uuid end)
     and i.branch_id=p_branch and i.is_active for update;
  if not found then raise exception 'Barang tidak ditemukan di cabang ini'; end if;
 else
  v_nama := btrim(coalesce(p_item->>'nama','')); v_satuan := btrim(coalesce(p_item->>'satuan',''));
  if length(v_nama) not between 2 and 120 then raise exception 'Nama barang wajib 2-120 huruf'; end if;
  if length(v_satuan) not between 1 and 30 then raise exception 'Satuan wajib diisi (maks. 30 huruf)'; end if;
  perform pg_advisory_xact_lock(hashtextextended('invop-item:'||p_branch::text||':'||lower(v_nama)||':'||lower(v_satuan),0));
  if exists(select 1 from public.operational_inventory_items i where i.branch_id=p_branch and i.is_active and lower(i.nama)=lower(v_nama) and lower(i.satuan)=lower(v_satuan)) then
   raise exception 'Barang "%" (%) sudah ada di cabang ini; pilih dari daftar', v_nama, v_satuan;
  end if;
  insert into public.operational_inventory_items(branch_id,nama,satuan,qty,request_key,created_by)
   values(p_branch,v_nama,v_satuan,0,'beli:'||p_request_key,auth.uid()) returning * into v_item;
 end if;

 -- Persetujuan kas keluar (kunci sama dengan Kas Keluar biasa: kas|tanggal|rekening|akun lawan|jumlah dibulatkan).
 select r.id into v_rule from public.approval_rules r where r.jenis='kas-keluar' and r.is_active and p_nominal>r.min_nilai order by r.min_nilai desc limit 1;
 if v_rule is not null then
  select a.id into v_approval from public.approval_requests a
   where a.jenis='kas-keluar' and a.ref_id=concat_ws('|','kas',v_today::text,p_account_id::text,v_beban,round(p_nominal)::bigint::text)
     and a.status in ('menunggu','disetujui','ditolak') order by a.diajukan_at desc limit 1 for update;
  if v_approval is null or not exists(select 1 from public.approval_requests a where a.id=v_approval and a.status='disetujui') then
   raise exception 'INVENTARIS_PERLU_PERSETUJUAN: pembelian ini butuh persetujuan atasan sesuai aturan Kas Keluar';
  end if;
  update public.approval_requests set status='terpakai' where id=v_approval;
 end if;

 -- Nomor bukti KK (format master penomoran; bawaan KK.{YYYY}.{MM}. 5 digit).
 select d.pola,d.digit into v_pola,v_digit from public.document_numbering d where d.jenis='KK';
 if v_pola is null or v_pola !~ '^[A-Za-z0-9./{}-]{1,24}$' then v_pola := 'KK.{YYYY}.{MM}.'; v_digit := 5; end if;
 v_digit := least(greatest(coalesce(v_digit,5),1),8);
 v_prefix := replace(replace(replace(replace(v_pola,'{YYYY}',to_char(v_today,'YYYY')),'{YY}',to_char(v_today,'YY')),'{MM}',to_char(v_today,'MM')),'{DD}',to_char(v_today,'DD'));
 perform pg_advisory_xact_lock(hashtextextended('vetos:kk-number:'||v_prefix,0));
 select coalesce(max(substring(c.no_bukti from length(v_prefix)+1)::bigint),0)+1 into v_seq
  from public.cash_entries c where left(c.no_bukti,length(v_prefix))=v_prefix and substring(c.no_bukti from length(v_prefix)+1) ~ '^[0-9]{1,12}$';
 v_no := v_prefix||lpad(v_seq::text,greatest(v_digit,length(v_seq::text)),'0');

 -- Kas Keluar + jurnal + nota.
 v_ket := left('Pembelian Inventaris Operasional: '||v_item.nama||' '||trim(to_char(p_qty,'FM999999999990.99'),'.')||' '||v_item.satuan||coalesce(' — '||v_catatan,''),1000);
 perform public.sales_write_journal(v_today,p_branch,'kas-entry',v_no,'Kas Keluar '||v_rek.nama||' ('||v_no||') — '||v_ket,
  jsonb_build_array(jsonb_build_object('code',v_beban,'debit',p_nominal,'credit',0),jsonb_build_object('code',v_cash_coa,'debit',0,'credit',p_nominal)));
 select j.id into strict v_journal from public.journal_entries j where j.source='kas-entry' and j.source_ref=v_no;
 insert into public.cash_entries(no_bukti,jenis,tanggal,account_id,lawan_code,jumlah,branch_id,keterangan,created_by,journal_entry_id)
  values(v_no,'Keluar',v_today,v_rek.id,v_beban,p_nominal,p_branch,v_ket,auth.uid(),v_journal) returning id into v_cash;
 insert into public.document_attachments(modul,ref_id,path,nama,mime,ukuran,uploaded_by)
  select 'pengeluaran',v_cash,path,nama,mime,ukuran::bigint,auth.uid() from jsonb_to_recordset(p_attachments) as x(path text,nama text,mime text,ukuran numeric);

 -- Penghubung + jumlah barang + riwayat.
 v_purchase := gen_random_uuid();
 v_result := jsonb_build_object('purchase_id',v_purchase,'cash_entry_id',v_cash,'journal_id',v_journal,'no_bukti',v_no,'item_id',v_item.id);
 insert into public.operational_inventory_purchases(id,branch_id,item_id,cash_entry_id,journal_entry_id,no_bukti,tanggal,qty,nominal,cash_account_id,beban_code,catatan,actor_id,actor_nama,request_key,payload,result)
  values(v_purchase,p_branch,v_item.id,v_cash,v_journal,v_no,v_today,p_qty,p_nominal,v_rek.id,v_beban,v_catatan,auth.uid(),v_nama_pelaku,p_request_key,v_payload,v_result);
 insert into public.operational_inventory_history(item_id,branch_id,purchase_id,jenis,qty_sebelum,qty_sesudah,alasan,actor_id,actor_nama)
  values(v_item.id,p_branch,v_purchase,'pembelian',v_item.qty,v_item.qty+p_qty,left('Pembelian '||v_no,500),auth.uid(),v_nama_pelaku) returning id into v_hist;
 update public.operational_inventory_items set qty=qty+p_qty,revision=revision+1,updated_at=now() where id=v_item.id;
 return v_result;
end $fn$;
revoke all on function public.inventaris_operasional_beli(text,uuid,jsonb,numeric,numeric,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.inventaris_operasional_beli(text,uuid,jsonb,numeric,numeric,uuid,text,jsonb) to authenticated;

-- ───────────── 6. Batalkan pembelian (atomik, satu-satunya jalur) ─────────────
create function public.inventaris_operasional_batal_pembelian(p_request_key text, p_purchase_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_p public.operational_inventory_purchases%rowtype; v_item public.operational_inventory_items%rowtype;
 v_cash public.cash_entries%rowtype; v_rev jsonb; v_nama_pelaku text; v_reason text := btrim(coalesce(p_reason,''));
begin
 if p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'Kunci permintaan tidak valid'; end if;
 if length(v_reason) not between 3 and 1000 then raise exception 'Alasan pembatalan wajib diisi (3-1000 huruf)'; end if;
 select * into v_p from public.operational_inventory_purchases where id=p_purchase_id for update;
 if not found then raise exception 'Pembelian tidak ditemukan'; end if;
 v_nama_pelaku := public.inventaris_operasional_pelaku(v_p.branch_id);
 if not public.inventaris_operasional_beli_allowed() then
  raise exception 'INVENTARIS_PEMBELIAN_FINANCE: hanya Finance aktif yang dapat membatalkan pembelian inventaris' using errcode='42501';
 end if;
 if v_p.voided_at is not null then
  if v_p.voided_by=auth.uid() and v_p.void_request_key=p_request_key then
   return jsonb_build_object('purchase_id',v_p.id,'cash_revision_id',v_p.void_cash_revision_id,'voided',true);
  end if;
  raise exception 'Pembelian sudah dibatalkan';
 end if;
 select * into v_item from public.operational_inventory_items where id=v_p.item_id for update;
 if v_item.qty<v_p.qty then
  raise exception 'INVENTARIS_BATAL_KURANG: jumlah "%" sekarang (%) lebih kecil dari pembelian ini (%). Cek opname terakhir sebelum membatalkan.', v_item.nama, v_item.qty, v_p.qty;
 end if;
 select * into v_cash from public.cash_entries where id=v_p.cash_entry_id for update;
 if not found or v_cash.voided_at is not null then raise exception 'Kas Keluar pembelian tidak ditemukan atau sudah dibatalkan; rekonsiliasi diperlukan'; end if;
 -- Jalur kas resmi (jurnal pembalik + audit) dengan izin sekali pakai untuk transaksi ini saja.
 insert into invop_private.cash_permits(xid,cash_entry_id) values(pg_current_xact_id()::text,v_cash.id);
 v_rev := public.revise_cash_entry('invop-batal:'||left(p_request_key,100),v_cash.id,v_cash.revision,'void','{}'::jsonb,'Batal pembelian inventaris: '||v_reason);
 delete from invop_private.cash_permits where xid=pg_current_xact_id()::text;
 insert into public.operational_inventory_history(item_id,branch_id,purchase_id,jenis,qty_sebelum,qty_sesudah,alasan,actor_id,actor_nama)
  values(v_item.id,v_p.branch_id,v_p.id,'batal_pembelian',v_item.qty,v_item.qty-v_p.qty,left('Batal '||v_p.no_bukti||': '||v_reason,500),auth.uid(),v_nama_pelaku);
 update public.operational_inventory_items set qty=qty-v_p.qty,revision=revision+1,updated_at=now() where id=v_item.id;
 update public.operational_inventory_purchases set voided_at=now(),voided_by=auth.uid(),void_reason=v_reason,void_request_key=p_request_key,
  void_cash_revision_id=(v_rev->>'revision_id')::uuid where id=v_p.id;
 return jsonb_build_object('purchase_id',v_p.id,'cash_revision_id',(v_rev->>'revision_id')::uuid,'voided',true);
end $fn$;
revoke all on function public.inventaris_operasional_batal_pembelian(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.inventaris_operasional_batal_pembelian(text,uuid,text) to authenticated;

-- Pagar Admin Online (#549): fungsi SECURITY DEFINER dan tabel baru. Idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
