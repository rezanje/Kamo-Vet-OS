-- Tanggal efektif (backdate) — Batalkan penerimaan PETSHOP (kasir + pencairan marketplace) dan Terima pembayaran lagi, gaya Accurate.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Permintaan Andri (11 Nov 2026): "misal kita batalkan di hari berikutnya, dan harusnya kita bisa pilih tgl backdate dong biar bisa kebaca di
-- omset tgl aslinya, karena Accurate bisa seperti itu". Reza: ACC bertahap.
--
-- RANCANGAN (satu aturan, dipakai tiga RPC):
--  * Tanggal efektif = tanggal pembukuan jurnal pembalik ('sale-receipt-cancel' / 'sale-online-cair-void') dan jurnal terima ulang
--    ('sale-receipt-repost'). Baris sejarah TIDAK ditulis ulang: sales.created_at, baris penjualan, jurnal 'sale', stok, HPP, poin, komisi
--    tidak disentuh. Laporan omzet/penjualan membaca sales.created_at (tidak berubah oleh pembatalan penerimaan); Kas/Bank, Buku Besar,
--    Neraca, Arus Kas, Piutang membaca tanggal jurnal -> ikut tanggal efektif.
--  * Rentang: tidak boleh di masa depan; tidak boleh sebelum tanggal penerimaan yang dibalik (tanggal struk / jurnal penjualan / terima ulang
--    sebelumnya; untuk terima ulang: tidak sebelum tanggal pembatalannya; untuk pencairan marketplace: tidak sebelum tanggal jurnal pencairan).
--  * Sebelum hari ini: hanya Owner (tanpa membaca kebijakan; tidak bisa terkunci) atau ADMIN/FINANCE yang dicentang Owner untuk izin khusus
--    'penjualan.pos_penerimaan.tanggal_mundur' (bawaan mati). Alasan wajib (pembatalan sudah wajib; terima ulang mundur: alasan baru).
--  * Periode akuntansi tertutup pada tanggal itu -> DITOLAK dengan kalimat jelas (buka lewat Tutup Buku; tidak ada jalan pintas). Pagar
--    rekonsiliasi bank memakai tanggal efektif.
--  * Efek fisik laci/bank TETAP di shift terbuka pelaku (atau 'tanpa_shift'), persis aturan #501; tanggal efektif tidak mengubahnya, jadi
--    angka tutup shift tidak dihitung dobel dan tidak hilang. Penjaga tutup-shift basi tidak disentuh.
--  * Audit: tanggal pilihan (effective_date / receive_effective_date) + waktu nyata (created_at / closed_at) + pelaku + alasan; kunci
--    idempotensi memuat tanggal (kunci sama + tanggal beda = ditolak).
--  * Bentuk RPC lama (4 argumen) tetap ada sebagai pembungkus (tanggal kosong = hari ini): aplikasi lama tetap jalan.
--  * Tidak diubah: aturan di bawah HPP, fee merchant (tetap ditolak), split (satu set), retur/refund, shift, stok.

set local lock_timeout = '5s';

-- ───────────────────────── 1. Kolom tanggal efektif (tabel dari #499, kosong di produksi; baris lama = NULL = tanggal catat) ─────────────────────────
alter table public.pos_receipt_cancellations
  add column effective_date date,
  add column receive_effective_date date,
  add column receive_reason text;
alter table public.pos_receipt_cancellations
  add constraint pos_receipt_cancellations_effective_date_check
    check (effective_date is null or effective_date <= (created_at at time zone 'Asia/Jakarta')::date),
  add constraint pos_receipt_cancellations_receive_date_check
    check (receive_effective_date is null or (closed_kind = 'diterima-ulang'
      and receive_effective_date <= (closed_at at time zone 'Asia/Jakarta')::date
      and receive_effective_date >= coalesce(effective_date, (created_at at time zone 'Asia/Jakarta')::date))),
  add constraint pos_receipt_cancellations_receive_reason_check
    check (receive_reason is null or length(btrim(receive_reason)) between 3 and 1000);
comment on column public.pos_receipt_cancellations.effective_date is 'Tanggal pembukuan jurnal pembalik (pilihan pelaku; NULL = tanggal catat). Waktu nyata ada di created_at.';
comment on column public.pos_receipt_cancellations.receive_effective_date is 'Tanggal pembukuan jurnal terima ulang (pilihan pelaku). Waktu nyata ada di closed_at.';
comment on column public.pos_receipt_cancellations.receive_reason is 'Alasan tanggal efektif mundur pada terima ulang (wajib bila tanggal sebelum hari ini).';
alter table public.online_disbursement_cancellations
  add column effective_date date;
alter table public.online_disbursement_cancellations
  add constraint online_disbursement_cancellations_effective_date_check
    check (effective_date is null or effective_date <= (created_at at time zone 'Asia/Jakarta')::date);
comment on column public.online_disbursement_cancellations.effective_date is 'Tanggal pembukuan jurnal pembalik pencairan (pilihan pelaku; NULL = tanggal catat).';

-- Catatan tetap tidak boleh diubah; hanya kolom penutupan (kini termasuk tanggal efektif + alasan terima ulang) yang boleh terisi sekali.
create or replace function public.guard_receipt_cancel_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.closed_at is null
  and (to_jsonb(new)-array['closed_at','closed_by','closed_kind','receive_journal_id','after_payments','receive_effect_shift_id','receive_effective_date','receive_reason'])
   is not distinct from (to_jsonb(old)-array['closed_at','closed_by','closed_kind','receive_journal_id','after_payments','receive_effect_shift_id','receive_effective_date','receive_reason'])
  and new.closed_at is not null then return new; end if;
 raise exception 'Riwayat pembatalan penerimaan tidak dapat diubah atau dihapus';
end $$;

-- ───────────────────────── 2. Hak: tanggal mundur = izin khusus (Owner selalu; peran lain hanya bila dicentang) ─────────────────────────
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('penjualan.pos_penerimaan.tanggal_mundur','Tanggal efektif mundur — Batalkan penerimaan / Terima pembayaran lagi petshop (kasir dan marketplace)','Penjualan',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('penjualan.pos_penerimaan.tanggal_mundur','penjualan') on conflict do nothing;

create function public.pos_receipt_backdate_allowed(p_branch uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;
  return public.pos_receipt_actor_allowed(p_branch)
   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)
   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penerimaan.tanggal_mundur'=any(a.allowed));
 exception when others then return false;
 end;
end $$;
revoke all on function public.pos_receipt_backdate_allowed(uuid) from public,anon,service_role;
grant execute on function public.pos_receipt_backdate_allowed(uuid) to authenticated;

-- ───────────────────────── 3. Batas bawah tanggal (internal) + pratinjau rentang untuk layar ─────────────────────────
-- 'cancel': tanggal struk dan tanggal jurnal uang yang akan dibalik (jurnal 'sale', terima ulang sebelumnya, koreksi metode). 'receive': juga tidak
-- sebelum tanggal pembatalan yang sedang terbuka.
create function public.pos_receipt_date_floor(p_sale_id uuid, p_op text) returns date language plpgsql stable security definer set search_path='' as $$
declare s public.sales%rowtype; fl date; oc date;
begin
 select * into s from public.sales where id=p_sale_id;
 if not found then return null; end if;
 fl:=greatest((s.created_at at time zone 'Asia/Jakarta')::date,
  coalesce((select max(e.tanggal) from public.journal_entries e where e.voided_at is null and (
     (e.source='sale' and e.source_ref=s.no_struk)
     or (e.source='sale-receipt-repost' and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=s.id))
     or e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=s.id))),date '1900-01-01'));
 if p_op='receive' then
  select coalesce(c.effective_date,(c.created_at at time zone 'Asia/Jakarta')::date) into oc from public.pos_receipt_cancellations c where c.sale_id=s.id and c.closed_at is null;
  fl:=greatest(fl,coalesce(oc,date '1900-01-01'));
 end if;
 return fl;
end $$;
revoke all on function public.pos_receipt_date_floor(uuid,text) from public,anon,authenticated,service_role;

create function public.pos_receipt_date_bounds(p_sale_id uuid, p_op text default 'cancel') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sales%rowtype; today date:=(now() at time zone 'Asia/Jakarta')::date; fl date; closed date; dd date; n integer;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_op is null or p_op not in('cancel','receive','online') then raise exception 'Jenis tindakan tidak dikenal' using errcode='22023'; end if;
 select * into s from public.sales where id=p_sale_id;
 if not found or not public.pos_receipt_actor_allowed(s.branch_id) then raise exception 'Anda tidak diizinkan melihat rentang tanggal ini.' using errcode='42501'; end if;
 if p_op='online' then
  select count(*) into n from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
   and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
  if n=1 then
   select e.tanggal into dd from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
    and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
  else
   select e.tanggal into dd from public.journal_entries e where e.source='sale-online-cair' and e.source_ref like 'CAIR-%' and e.branch_id=s.branch_id and e.created_at=s.disbursed_at and e.voided_at is null
    and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
  end if;
  fl:=greatest((s.created_at at time zone 'Asia/Jakarta')::date,coalesce(dd,date '1900-01-01'));
 else
  fl:=public.pos_receipt_date_floor(s.id,p_op);
 end if;
 select closed_until into closed from public.accounting_locks where id;
 return jsonb_build_object('min_date',fl,'max_date',today,'today',today,'closed_until',closed,
  'effective_min',greatest(fl,coalesce(closed+1,fl)),'can_backdate',public.pos_receipt_backdate_allowed(s.branch_id));
end $$;
revoke all on function public.pos_receipt_date_bounds(uuid,text) from public,anon,service_role;
grant execute on function public.pos_receipt_date_bounds(uuid,text) to authenticated;

-- ───────────────────────── 5. Tiga RPC bertanggal efektif (bentuk lama menjadi pembungkus) ─────────────────────────
create function public.cancel_pos_sale_receipt(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_effective_date date)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; prior public.receipt_cancel_requests%rowtype;
 payload jsonb; result jsonb; audit uuid:=gen_random_uuid(); jid uuid; reason text:=btrim(coalesce(p_reason,''));
 today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; src_status text; eff uuid; edate date; floor_date date;
 before_payments jsonb; n_pay integer; sum_pay numeric; sum_fee numeric; cash_total numeric; codes text[]; lines jsonb; shift_mode text;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 3 and 1000 then
  raise exception 'Identitas atau alasan pembatalan penerimaan tidak valid. Isi alasan minimal 3 huruf.' using errcode='22023'; end if;
 -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 -- BACKDATE_PETSHOP: tanggal efektif (kosong = hari ini). Tidak boleh di masa depan.
 edate:=coalesce(p_effective_date,today);
 if edate>today then raise exception 'Tanggal efektif % belum tiba (hari ini %). Pilih hari ini atau tanggal sebelumnya.',to_char(edate,'DD/MM/YYYY'),to_char(today,'DD/MM/YYYY') using errcode='22023'; end if;
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan penerimaan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 -- Tanggal sebelum hari ini: hanya Owner, atau peran yang dicentang Owner (izin khusus, bawaan mati). Diperiksa SEBELUM kunci baris.
 if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then
  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan penerimaan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang penjualan tidak aktif' using errcode='42501'; end if;
 payload:=jsonb_build_object('op','cancel','sale_id',p_sale_id,'revision',p_expected_revision,'reason',reason)
  ||case when p_effective_date is not null then jsonb_build_object('effective_date',p_effective_date) else '{}'::jsonb end;
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'; end if;
 if s.voided_at is not null then raise exception 'Penjualan ini sudah dibatalkan; tidak ada penerimaan yang bisa dibatalkan.'; end if;
 if s.channel is not null then raise exception 'Order marketplace: batalkan PENCAIRAN-nya, bukan penerimaan kasir.'; end if;
 if s.payment_plan is null or s.payments_finalized_at is null or s.total<=0 then
  raise exception 'Struk ini belum punya penerimaan yang selesai (atau struk lama tanpa rincian pembayaran). Gunakan Batalkan penjualan atau hubungi finance.'; end if;
 if exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null) then
  raise exception 'Penerimaan struk ini sudah dibatalkan. Terima pembayaran lagi, atau ubah transaksi lewat Batalkan penjualan.'; end if;
 if s.merchant_fee_total<>0 then
  raise exception 'Struk ini memuat fee merchant (kartu/QRIS berbiaya). Gunakan Batalkan penjualan lalu input ulang di kasir.'; end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null)
  or exists(select 1 from public.sale_payment_refunds r join public.sale_payments p on p.id=r.sale_payment_id where p.sale_id=s.id)
  or exists(select 1 from public.sales_refund_requests where sale_id=s.id and status in('pending','diproses','selesai')) then
  raise exception 'Sebagian uang struk ini sudah dikembalikan lewat retur/refund, jadi penerimaan tidak bisa dibatalkan begitu saja. Batalkan dulu retur/refund-nya (Penjualan > Retur), atau pakai Batalkan penjualan.'; end if;
 floor_date:=public.pos_receipt_date_floor(s.id,'cancel');
 if edate<floor_date then
  raise exception 'Tanggal efektif % tidak boleh sebelum tanggal penerimaan yang dibatalkan (%).',to_char(edate,'DD/MM/YYYY'),to_char(floor_date,'DD/MM/YYYY') using errcode='22023'; end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and edate<=closed then
  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini tidak bisa dibukukan.',closed; end if;
  raise exception 'Periode akuntansi sampai % sudah ditutup; tanggal efektif % tidak bisa dibukukan. Pilih tanggal sesudah % atau buka kembali periodenya lewat Tutup Buku.',to_char(closed,'DD/MM/YYYY'),to_char(edate,'DD/MM/YYYY'),to_char(closed,'DD/MM/YYYY'); end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb),count(*),coalesce(sum(p.amount),0),coalesce(sum(p.fee_amount),0),
  coalesce(sum(p.amount) filter(where p.method='Tunai'),0),coalesce(array_agg(distinct p.coa_code),'{}')
  into before_payments,n_pay,sum_pay,sum_fee,cash_total,codes from public.sale_payments p where p.sale_id=s.id;
 if n_pay not between 1 and 6 or n_pay<>jsonb_array_length(s.payment_plan) or sum_pay<>s.total or sum_fee<>0 then
  raise exception 'Alokasi pembayaran struk tidak lengkap atau tidak sama dengan total; perlu rekonsiliasi finance.'; end if;
 -- Laci: shift terbuka -> di shift itu; shift tertutup -> angka tutupnya dibiarkan, koreksi dicatat di shift terbuka cabang ini.
 if s.shift_id is not null then
  select status into src_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift struk tidak ditemukan; perlu rekonsiliasi finance.'; end if;
 end if;
 if src_status='open' then eff:=s.shift_id;
 -- MITIGASI_1111 R2: shift asal sudah tutup -> hanya shift terbuka MILIK PELAKU; tanpa itu, tidak menyentuh laci siapa pun (ditandai 'tanpa_shift').
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop' and opened_by=actor
   order by opened_at desc,id limit 1 for update;
 end if;
 shift_mode:=case when eff is null then case when cash_total>0 then 'tanpa_shift' else 'nonkas' end when eff is not distinct from s.shift_id then 'shift_asal_terbuka' else 'shift_pelaku' end;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=edate and (c.id is null or c.code=any(codes))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pembayaran struk ini sampai tanggal efektif (atau hari ini). Batalkan rekonsiliasinya dulu.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',x.coa_code,'debit',0,'credit',x.amount) order by x.method,x.id),'[]'::jsonb)
  || jsonb_build_array(jsonb_build_object('code','150001','debit',s.total,'credit',0)) into lines from public.sale_payments x where x.sale_id=s.id;
 perform public.sales_write_journal(edate,s.branch_id,'sale-receipt-cancel',audit::text,'Penerimaan dibatalkan '||s.no_struk||case when edate<today then ' [tanggal efektif '||to_char(edate,'DD/MM/YYYY')||']' else '' end,lines);
 select id into strict jid from public.journal_entries where source='sale-receipt-cancel' and source_ref=audit::text;
 insert into public.pos_receipt_cancellations(id,sale_id,branch_id,reason,before_sale,before_payments,reversal_journal_id,source_shift_id,source_shift_status,effect_shift_id,created_by,shift_mode,effective_date)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor,shift_mode,edate);
 if eff is not null then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select audit,s.id,eff,p.method,-p.amount,'batal' from public.sale_payments p where p.sale_id=s.id;
 end if;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',audit,'journal_id',jid,'unpaid',true,'effect_shift_id',eff,
  'source_shift_status',src_status,'effect_in_other_shift',(eff is not null and eff is distinct from s.shift_id),'shift_mode',shift_mode,'effective_date',edate);
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'cancel',s.id,payload,result);
 return result;
end 
$$;
revoke all on function public.cancel_pos_sale_receipt(uuid,integer,text,text,date) from public,anon,service_role;
grant execute on function public.cancel_pos_sale_receipt(uuid,integer,text,text,date) to authenticated;

create function public.receive_pos_sale_payment(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_plan jsonb,p_effective_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; c public.pos_receipt_cancellations%rowtype; prior public.receipt_cancel_requests%rowtype;
 payload jsonb; result jsonb; jid uuid; today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; s0_status text; eff uuid; edate date; floor_date date; rreason text:=nullif(btrim(coalesce(p_reason,'')),'');
 r record; plan_norm jsonb; old_norm jsonb; parts integer; lines jsonb:='[]'; acode text; acc public.coa_accounts%rowtype; cacc public.cash_accounts%rowtype;
 codes text[]:='{}'; cash_new numeric:=0; changed boolean; after_pay jsonb; new_plan jsonb; shift_mode text;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or p_plan is null or jsonb_typeof(p_plan) is distinct from 'array' then
  raise exception 'Identitas atau rincian pembayaran tidak valid' using errcode='22023'; end if;
 -- BACKDATE_PETSHOP: tanggal efektif penerimaan ulang (kosong = hari ini). Tidak boleh di masa depan; alasan wajib bila sebelum hari ini.
 edate:=coalesce(p_effective_date,today);
 if edate>today then raise exception 'Tanggal efektif % belum tiba (hari ini %). Pilih hari ini atau tanggal sebelumnya.',to_char(edate,'DD/MM/YYYY'),to_char(today,'DD/MM/YYYY') using errcode='22023'; end if;
 if length(coalesce(rreason,'')) > 1000 or (edate<today and length(coalesce(rreason,'')) < 3) then
  raise exception 'Isi alasan tanggal efektif mundur (minimal 3 huruf, maksimal 1000).' using errcode='22023'; end if;
 -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan menerima pembayaran ulang struk ini. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then
  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan menerima pembayaran ulang struk ini. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang penjualan tidak aktif' using errcode='42501'; end if;
 -- Normalisasi rencana (urut metode) supaya payload idempoten tidak bergantung urutan kiriman.
 if exists(select 1 from jsonb_array_elements(p_plan) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'method') is distinct from 'string' or jsonb_typeof(x->'amount') is distinct from 'number') then
  raise exception 'Rincian pembayaran tidak valid (metode dan jumlah).'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount) order by x.method),'[]'::jsonb),count(*)
  into plan_norm,parts from jsonb_to_recordset(p_plan) as x(method text,amount numeric);
 payload:=jsonb_build_object('op','receive','sale_id',p_sale_id,'revision',p_expected_revision,'plan',plan_norm)
  ||case when p_effective_date is not null then jsonb_build_object('effective_date',p_effective_date,'reason',rreason) else '{}'::jsonb end;
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum menerima pembayaran.'; end if;
 if s.voided_at is not null then raise exception 'Penjualan ini sudah dibatalkan; tidak ada yang perlu dibayar.'; end if;
 select * into c from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null for update;
 if not found then raise exception 'Struk ini sudah dibayar (penerimaannya tidak sedang dibatalkan).'; end if;
 if parts not between 1 and 6 or exists(select 1 from jsonb_to_recordset(plan_norm) x(method text,amount numeric)
   where method is null or method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') or amount is null or amount<=0
    or amount>1000000000000 or amount<>round(amount,2))
  or (select count(distinct method) from jsonb_to_recordset(plan_norm) x(method text))<>parts
  or (select coalesce(sum(amount),0) from jsonb_to_recordset(plan_norm) x(amount numeric))<>s.total then
  raise exception 'Rincian pembayaran harus 1 sampai 6 metode berbeda, tiap jumlah positif, dan jumlahnya sama dengan total struk Rp%.',to_char(s.total,'FM999G999G999G999'); end if;
 floor_date:=public.pos_receipt_date_floor(s.id,'receive');
 if edate<floor_date then
  raise exception 'Tanggal efektif % tidak boleh sebelum tanggal pembatalan penerimaan (%).',to_char(edate,'DD/MM/YYYY'),to_char(floor_date,'DD/MM/YYYY') using errcode='22023'; end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and edate<=closed then
  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; penerimaan hari ini tidak bisa dibukukan.',closed; end if;
  raise exception 'Periode akuntansi sampai % sudah ditutup; tanggal efektif % tidak bisa dibukukan. Pilih tanggal sesudah % atau buka kembali periodenya lewat Tutup Buku.',to_char(closed,'DD/MM/YYYY'),to_char(edate,'DD/MM/YYYY'),to_char(closed,'DD/MM/YYYY'); end if;
 if s.shift_id is not null then
  select status into s0_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift struk tidak ditemukan; perlu rekonsiliasi finance.'; end if;
 end if;
 select coalesce(sum(amount) filter(where method='Tunai'),0) into cash_new from jsonb_to_recordset(plan_norm) x(method text,amount numeric);
 if s0_status='open' then eff:=s.shift_id;
 -- MITIGASI_1111 R2: shift asal sudah tutup -> hanya shift terbuka MILIK PELAKU; tanpa itu ditandai 'tanpa_shift' (tidak menyentuh laci siapa pun).
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop' and opened_by=actor
   order by opened_at desc,id limit 1 for update;
 end if;
 shift_mode:=case when eff is null then case when cash_new>0 then 'tanpa_shift' else 'nonkas' end when eff is not distinct from s.shift_id then 'shift_asal_terbuka' else 'shift_pelaku' end;
 -- Akun tiap metode (sama dengan pencatatan kasir).
 for r in select method,amount from jsonb_to_recordset(plan_norm) x(method text,amount numeric) order by method loop
  acode:=public.unit_posting_cash(r.method,s.branch_id);
  select * into acc from public.coa_accounts where coa_accounts.code=acode and is_active and not is_header and type='ASET' and normal_balance='D' for share;
  if not found then raise exception 'Akun pembayaran % tidak tersedia.',acode; end if;
  select * into cacc from public.cash_accounts where coa_code=acode and is_active and (branch_id is null or branch_id=s.branch_id) order by branch_id nulls last,id limit 1 for share;
  if not found then raise exception 'Rekening pembayaran % tidak aktif atau bukan cabang ini.',acode; end if;
  codes:=codes||acode;
  lines:=lines||jsonb_build_array(jsonb_build_object('code',acode,'debit',r.amount,'credit',0));
 end loop;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations rc left join public.cash_accounts a on a.id=rc.cash_account_id
  left join public.coa_accounts cc on cc.code=coalesce(rc.bank_coa_code,a.coa_code)
  where rc.voided_at is null and rc.tanggal>=edate and (cc.id is null or cc.code=any(codes))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pembayaran sampai tanggal efektif (atau hari ini). Batalkan rekonsiliasinya dulu.'; end if;
 lines:=lines||jsonb_build_array(jsonb_build_object('code','150001','debit',0,'credit',s.total));
 perform public.sales_write_journal(edate,s.branch_id,'sale-receipt-repost',c.id::text,'Penerimaan diterima ulang '||s.no_struk||case when edate<today then ' [tanggal efektif '||to_char(edate,'DD/MM/YYYY')||']' else '' end,lines);
 select id into strict jid from public.journal_entries where source='sale-receipt-repost' and source_ref=c.id::text;
 select coalesce(jsonb_agg(jsonb_build_object('method',p->>'method','amount',(p->>'amount')::numeric) order by p->>'method'),'[]'::jsonb) into old_norm
  from jsonb_array_elements(c.before_payments) p;
 changed:=old_norm is distinct from plan_norm;
 if changed then
  new_plan:=(select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount,'fee_percent',0,'fee_amount',0) order by x.method),'[]'::jsonb) from jsonb_to_recordset(plan_norm) x(method text,amount numeric));
  insert into public.sale_payment_correction_gate(transaction_id,backend_pid,sale_id) values(txid_current(),pg_backend_pid(),s.id);
  delete from public.sale_payments where sale_id=s.id;
  for r in select method,amount from jsonb_to_recordset(plan_norm) x(method text,amount numeric) order by method loop
   acode:=public.unit_posting_cash(r.method,s.branch_id);
   select * into acc from public.coa_accounts where coa_accounts.code=acode;
   select * into cacc from public.cash_accounts where coa_code=acode and is_active and (branch_id is null or branch_id=s.branch_id) order by branch_id nulls last,id limit 1;
   insert into public.sale_payments(sale_id,method,amount,fee_percent,fee_amount,coa_code,account_snapshot)
    values(s.id,r.method,r.amount,0,0,acode,jsonb_build_object('coa_id',acc.id,'code',acc.code,'name',acc.name,'cash_account_id',cacc.id,'cash_account_name',cacc.nama));
  end loop;
  update public.sales set payment_plan=new_plan,metode_bayar=case when parts>1 then 'Split' else plan_norm->0->>'method' end,
   revision=revision+1,bayar=total,kembali=0 where id=s.id;
  delete from public.sale_payment_correction_gate where transaction_id=txid_current() and backend_pid=pg_backend_pid() and sale_id=s.id;
 end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into after_pay from public.sale_payments p where p.sale_id=s.id;
 if (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total then raise exception 'Alokasi hasil tidak sama dengan total struk'; end if;
 -- Efek laci. Shift struk masih terbuka: alokasi dasar struk sudah berganti ke rencana baru, jadi batalan lama (-lama) dibatalkan balik (+lama).
 -- Shift struk sudah tertutup (atau tanpa shift): uang baru masuk ke shift terbuka sekarang (+baru).
 if s0_status='open' and eff=s.shift_id then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select c.id,s.id,s.shift_id,x.method,x.amount,'terima' from jsonb_to_recordset(old_norm) x(method text,amount numeric);
 elsif eff is not null then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select c.id,s.id,eff,x.method,x.amount,'terima' from jsonb_to_recordset(plan_norm) x(method text,amount numeric);
 end if;
 update public.pos_receipt_cancellations set closed_at=now(),closed_by=actor,closed_kind='diterima-ulang',receive_journal_id=jid,
  after_payments=after_pay,receive_effect_shift_id=eff,receive_effective_date=edate,receive_reason=rreason where id=c.id;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',c.id,'journal_id',jid,'unpaid',false,'changed_methods',changed,
  'revision',s.revision+case when changed then 1 else 0 end,'effect_shift_id',eff,'shift_mode',shift_mode,'effective_date',edate);
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'receive',s.id,payload,result);
 return result;
end 
$$;
revoke all on function public.receive_pos_sale_payment(uuid,integer,text,jsonb,date,text) from public,anon,service_role;
grant execute on function public.receive_pos_sale_payment(uuid,integer,text,jsonb,date,text) to authenticated;

create function public.cancel_online_disbursement(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_effective_date date)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; prior public.receipt_cancel_requests%rowtype; payload jsonb; result jsonb;
 audit uuid:=gen_random_uuid(); reason text:=btrim(coalesce(p_reason,'')); today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; edate date; floor_date date;
 dj public.journal_entries%rowtype; n_j integer; bank_code text; bank_amount numeric; fee numeric; jid uuid; lines jsonb;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 3 and 1000 then
  raise exception 'Identitas atau alasan pembatalan pencairan tidak valid. Isi alasan minimal 3 huruf.' using errcode='22023'; end if;
 -- BACKDATE_PETSHOP: tanggal efektif pembalikan pencairan (kosong = hari ini). Tidak di masa depan, tidak sebelum tanggal pencairan.
 edate:=coalesce(p_effective_date,today);
 if edate>today then raise exception 'Tanggal efektif % belum tiba (hari ini %). Pilih hari ini atau tanggal sebelumnya.',to_char(edate,'DD/MM/YYYY'),to_char(today,'DD/MM/YYYY') using errcode='22023'; end if;
 -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan pencairan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then
  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan pencairan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 payload:=jsonb_build_object('op','online','sale_id',p_sale_id,'revision',p_expected_revision,'reason',reason)
  ||case when p_effective_date is not null then jsonb_build_object('effective_date',p_effective_date) else '{}'::jsonb end;
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan pencairan.'; end if;
 if s.voided_at is not null then raise exception 'Order ini sudah dibatalkan.'; end if;
 if s.channel is null or s.channel not in('Shopee','Tokopedia','TikTok Shop') then raise exception 'Hanya order marketplace yang punya pencairan.'; end if;
 if s.marketplace_status is distinct from 'cair' or s.disbursed_at is null then raise exception 'Order ini belum dicairkan (sudah berstatus piutang).'; end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null) then
  raise exception 'Order ini sudah punya retur. Batalkan returnya dulu sebelum membatalkan pencairan.'; end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and edate<=closed then
  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan hari ini tidak bisa dibukukan.',closed; end if;
  raise exception 'Periode akuntansi sampai % sudah ditutup; tanggal efektif % tidak bisa dibukukan. Pilih tanggal sesudah % atau buka kembali periodenya lewat Tutup Buku.',to_char(closed,'DD/MM/YYYY'),to_char(edate,'DD/MM/YYYY'),to_char(closed,'DD/MM/YYYY'); end if;
 -- Jurnal pencairan: satuan (source_ref = no struk) atau gabungan (CAIR-..., dibuat di transaksi yang sama dengan disbursed_at).
 select count(*) into n_j from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
  and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 if n_j=1 then
  select e.* into dj from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
   and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 elsif n_j=0 then
  select count(*) into n_j from public.journal_entries e where e.source='sale-online-cair' and e.source_ref like 'CAIR-%' and e.branch_id=s.branch_id and e.created_at=s.disbursed_at and e.voided_at is null and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
  if n_j<>1 then raise exception 'Jurnal pencairan order ini tidak dapat dipastikan (pencairan gabungan tidak teridentifikasi). Hubungi finance.'; end if;
  select e.* into dj from public.journal_entries e where e.source='sale-online-cair' and e.source_ref like 'CAIR-%' and e.branch_id=s.branch_id and e.created_at=s.disbursed_at and e.voided_at is null and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 else raise exception 'Jurnal pencairan order ini ganda; perlu rekonsiliasi finance.'; end if;
 -- Pembalikan tidak boleh mendahului jurnal pencairan yang dibalik (tanggal pencairan = tanggal jurnalnya), dan tidak mendahului tanggal order.
 floor_date:=greatest(dj.tanggal,(s.created_at at time zone 'Asia/Jakarta')::date);
 if edate<floor_date then
  raise exception 'Tanggal efektif % tidak boleh sebelum tanggal pencairan (%).',to_char(edate,'DD/MM/YYYY'),to_char(floor_date,'DD/MM/YYYY') using errcode='22023'; end if;
 fee:=coalesce(s.komisi,0);
 if fee<0 or fee>s.total then raise exception 'Komisi order tidak valid; perlu rekonsiliasi finance.'; end if;
 select a.code into bank_code from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=dj.id and l.debit>0 and a.type='ASET' order by l.debit desc,a.code limit 1;
 if bank_code is null then raise exception 'Akun bank pencairan tidak ditemukan pada jurnal; perlu rekonsiliasi finance.'; end if;
 bank_amount:=s.total-fee;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=edate and (c.id is null or c.code=bank_code)) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pencairan sampai tanggal efektif (atau hari ini). Batalkan rekonsiliasinya dulu.'; end if;
 lines:=jsonb_build_array(jsonb_build_object('code','130009','debit',s.total,'credit',0));
 if bank_amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code',bank_code,'debit',0,'credit',bank_amount)); end if;
 if fee>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','740020','debit',0,'credit',fee)); end if;
 perform public.sales_write_journal(edate,s.branch_id,'sale-online-cair-void',audit::text,'Pencairan dibatalkan '||s.no_struk||case when edate<today then ' [tanggal efektif '||to_char(edate,'DD/MM/YYYY')||']' else '' end,lines);
 select id into strict jid from public.journal_entries where source='sale-online-cair-void' and source_ref=audit::text;
 insert into public.online_disbursement_cancellations(id,sale_id,branch_id,reason,before_sale,disbursement_journal_id,reversal_journal_id,bank_code,amount_bank,amount_fee,created_by,effective_date)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),dj.id,jid,bank_code,bank_amount,fee,actor,edate);
 update public.sales set marketplace_status='piutang',komisi=0,disbursed_at=null where id=s.id;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',audit,'journal_id',jid,'status','piutang','effective_date',edate);
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'online',s.id,payload,result);
 return result;
end 
$$;
revoke all on function public.cancel_online_disbursement(uuid,integer,text,text,date) from public,anon,service_role;
grant execute on function public.cancel_online_disbursement(uuid,integer,text,text,date) to authenticated;

-- Bentuk lama tetap ada (aplikasi lama masih memanggilnya): ACL/pemilik/konfigurasi tidak berubah, hanya isi.
create or replace function public.cancel_pos_sale_receipt(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 -- Bentuk lama (aplikasi sebelum fitur tanggal efektif): tanpa tanggal = hari ini, perilaku persis sama.
 return public.cancel_pos_sale_receipt(p_sale_id,p_expected_revision,p_request_key,p_reason,null::date);
end $$;
create or replace function public.receive_pos_sale_payment(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 -- Bentuk lama (aplikasi sebelum fitur tanggal efektif): tanpa tanggal = hari ini, perilaku persis sama.
 return public.receive_pos_sale_payment(p_sale_id,p_expected_revision,p_request_key,p_plan,null::date,null::text);
end $$;
create or replace function public.cancel_online_disbursement(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 -- Bentuk lama (aplikasi sebelum fitur tanggal efektif): tanpa tanggal = hari ini, perilaku persis sama.
 return public.cancel_online_disbursement(p_sale_id,p_expected_revision,p_request_key,p_reason,null::date);
end $$;

