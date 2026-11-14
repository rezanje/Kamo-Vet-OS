-- B3 (meeting 12 Nov 2026, keputusan Reza: A): jurnal pembatalan struk petshop dan void & terbit ulang nota klinik dibukukan di
-- TANGGAL TRANSAKSI ASLI, supaya Laba Rugi / Buku Besar per hari sama dengan laporan omzet (yang sudah membaca tanggal asli).
-- Apply as ONE transaction (tanpa begin/commit sendiri). Semua tambalan berjangkar eksak atas definisi HIDUP; gagal tertutup bila berbeda.
--
-- MASALAH (docs/meeting-2026-11-12/TEMUAN-B3.md):
--  1. "Batalkan penjualan" petshop (cancel_posted_sale): jurnal pembalik pendapatan, penerimaan dan HPP bertanggal HARI PEMBATALAN,
--     padahal laporan omzet menghapus struk dari tanggal aslinya -> laporan omzet dan Laba Rugi beda tanggal.
--  2. "Void & terbitkan ulang" klinik (clinic_void_reissue_invoice_core): jurnal batal + jurnal terbit ulang bertanggal hari koreksi,
--     lalu koreksi nota pengganti (clinic_edit_invoice_core) juga hari koreksi -> selisih nilai (mis. 100rb -> 90rb) jatuh di hari
--     koreksi, sedangkan laporan omzet menaruh 90rb di tanggal asli (nota pengganti memakai created_at asli sejak 20261111035704).
--
-- RANCANGAN (aturan 2A yang sama dengan "Ubah transaksi" 20261116300000: omzet & kas/bank di tanggal transaksi, stok & HPP di hari diubah):
--  A. cancel_posted_sale — sama persis dengan varian pos_sale_edit_void: tiap jurnal pendapatan ('sale'/'sale-online') dan jurnal
--     penerimaan ('sale-receipt-cancel'/'sale-receipt-repost') dibalik di TANGGALNYA SENDIRI (pendapatan = tanggal struk; pasangan
--     batal/terima ulang penerimaan = tanggal efektifnya masing-masing), jadi seluruh rantai hilang dari tanggal asalnya. Jurnal HPP
--     ('sale-void-hpp') dan mutasi stok 'sale-void' tetap HARI INI (stok fisik kembali hari ini).
--  B. clinic_void_reissue_invoice_core — jurnal 'klinik-void' (pendapatan/piutang) dan 'klinik-reissue' nota pengganti dibukukan di
--     tanggal nota asli (created_at WIB; sama dengan tanggal nota pengganti). Pasangan HPP ('klinik-hpp-void' + 'klinik-hpp' nota
--     pengganti) TETAP HARI INI: terbit ulang tidak menggerakkan stok dan pasangan ini saling meniadakan di tanggal yang sama, jadi
--     tidak perlu menyentuh periode persediaan tanggal asli. (Jurnal admin DEMO di pembungkus juga sepasang di hari ini; tidak diubah.)
--  C. clinic_edit_invoice_core — koreksi nota hasil terbit ulang yang belum selesai (correction_pending + reissued_from, tanpa jendela
--     tanggal efektif "Batalkan penerimaan") membukukan jurnal penjualan koreksi di tanggal nota asli -> selisih nilai jatuh di tanggal
--     asli. Jurnal HPP koreksi tetap hari ini (stok koreksi bergerak hari ini, aturan 2A). Jendela tanggal efektif yang sudah ada tetap
--     didahulukan dan perilakunya tidak berubah.
--  Transaksi di hari yang sama (tanggal asli = hari ini) = perilaku lama persis (tanggal & pagar tidak berubah).
--
-- PAGAR (tanggal yang benar-benar dipakai; tidak ada jalan pintas):
--  * periode akuntansi tertutup (accounting_locks.closed_until) pada tanggal asli -> ditolak dengan pesan (petshop: pagar lama sudah
--    memeriksa tanggal struk; klinik: baru, kode PERIODE_TERKUNCI);
--  * rekonsiliasi bank aktif bertanggal >= tanggal jurnal pada rekening yang ikut dibalik -> ditolak (kode REKONSILIASI_TERKUNCI di klinik);
--  * penggajian bulan tanggal asli sudah dibuat -> ditolak (petshop: pagar lama; klinik: baru, kode GAJI_SUDAH_DIBUAT, karena komisi
--    klinik dihitung dari tanggal lunas nota yang dipertahankan nota pengganti);
--  * periode persediaan & stok tetap diperiksa pada HARI INI (gerakan stok/HPP tetap hari ini).
--  Laci/shift kasir: tidak berubah (efek fisik tetap pada shift hari ini, seperti sebelumnya).
--
-- DAMPAK: hanya jurnal BARU sesudah migrasi. Jurnal lama tidak diubah. Tidak ada data yang ditulis ulang. Signature/SECURITY/search_path/
-- grant fungsi yang ditambal tidak berubah. Pembatalan/terbit ulang transaksi di periode yang sudah ditutup (atau bulan yang sudah
-- digaji, untuk klinik) kini DITOLAK — sebelumnya lolos karena jurnalnya hari ini.
--
-- ROLLBACK: pasang ulang definisi fungsi sebelum migrasi ini (pg_get_functiondef dari cadangan / rantai migrasi sampai 20261118200000)
-- untuk cancel_posted_sale(uuid,integer,text,text), clinic_void_reissue_invoice_core(uuid,text,text) dan
-- clinic_edit_invoice_core(uuid,text,jsonb,jsonb), lalu drop function public.b3_tolak_tanggal_asli(date,text[],boolean,boolean) dan
-- public.b3_tanggal_jurnal(timestamptz). Jurnal yang sudah terbentuk tetap sah (seimbang) dan tidak perlu diubah.
set local lock_timeout = '5s';

-- ───────────── 1. Helper ─────────────
-- Tanggal pembukuan klinik untuk transaksi asli: tanggal WIB transaksi bila sebelum hari ini (WIB); hari yang sama = current_date seperti dulu.
create function public.b3_tanggal_jurnal(p_waktu timestamptz) returns date
 language sql stable security definer set search_path='' as $$
 select case when (p_waktu at time zone 'Asia/Jakarta')::date < (now() at time zone 'Asia/Jakarta')::date
  then (p_waktu at time zone 'Asia/Jakarta')::date else current_date end
$$;
revoke all on function public.b3_tanggal_jurnal(timestamptz) from public,anon,authenticated,service_role;

-- Pagar tanggal asli: tutup buku, rekonsiliasi bank (rekening p_codes), penggajian (opsional). p_kode = awali pesan dengan kode (klinik).
create function public.b3_tolak_tanggal_asli(p_date date, p_codes text[], p_gaji boolean, p_kode boolean) returns void
 language plpgsql stable security definer set search_path='' as $$
declare v_acc date; v_code text; v_msg text;
begin
 select l.closed_until into v_acc from public.accounting_locks l where l.id;
 if v_acc is not null and p_date<=v_acc then
  v_code:='PERIODE_TERKUNCI';
  v_msg:=format('Periode akuntansi sampai %s sudah ditutup, jadi pembatalan tidak bisa dibukukan di tanggal transaksi asli (%s). Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku',
   to_char(v_acc,'DD/MM/YYYY'),to_char(p_date,'DD/MM/YYYY'));
 elsif exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
   left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
   where r.voided_at is null and r.tanggal>=p_date and (c.id is null or c.code=any(coalesce(p_codes,'{}')))) then
  v_code:='REKONSILIASI_TERKUNCI';
  v_msg:=format('Rekonsiliasi bank sudah mencakup tanggal transaksi asli (%s) pada rekening transaksi ini, jadi pembatalannya tidak bisa dibukukan di tanggal itu. Batalkan rekonsiliasinya dulu di Kas & Bank',
   to_char(p_date,'DD/MM/YYYY'));
 elsif p_gaji and exists(select 1 from public.payrolls pr where pr.periode=to_char(p_date,'YYYY-MM')) then
  v_code:='GAJI_SUDAH_DIBUAT';
  v_msg:=format('Penggajian bulan %s sudah dibuat, jadi transaksi tanggal %s tidak bisa dibatalkan atau dikoreksi sekarang. Hitung ulang atau hapus penggajiannya lebih dulu',
   to_char(p_date,'MM/YYYY'),to_char(p_date,'DD/MM/YYYY'));
 end if;
 if v_code is not null then
  raise exception using errcode='P0001', message=case when p_kode then v_code||': '||v_msg else v_msg||'.' end;
 end if;
end $$;
revoke all on function public.b3_tolak_tanggal_asli(date,text[],boolean,boolean) from public,anon,authenticated,service_role;

-- ───────────── 2. Tambalan berjangkar ─────────────
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

-- 2a. Batalkan penjualan petshop: pendapatan/penerimaan dibalik di tanggalnya sendiri, HPP hari ini (sama dengan pos_sale_edit_void).
select pg_temp.patch('public.cancel_posted_sale(uuid,integer,text,text)', array[
 $a$ perform public.reverse_sale_staff_effects(s,audit);$a$,
 $r$ -- B3_TANGGAL_ASLI: jurnal pendapatan & penerimaan dibalik di tanggalnya sendiri; rekonsiliasi bank pada tanggal itu menolak.
 -- (Tutup buku & penggajian tanggal struk sudah diperiksa di atas.) Jurnal yang memang hari ini = perilaku lama.
 for r in select e.tanggal,array_agg(distinct a.code) codes from public.journal_entries e
   join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id
   where e.tanggal<d and ((e.source=v_source and e.source_ref=s.no_struk)
    or (e.source in('sale-receipt-cancel','sale-receipt-repost') and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=s.id)))
   group by e.tanggal order by e.tanggal loop
  perform public.b3_tolak_tanggal_asli(r.tanggal,r.codes,false,false);
 end loop;
 perform public.reverse_sale_staff_effects(s,audit);$r$,
 $a$values(reversal,public.sales_next_number('JRN',d),d,'Pembatalan '||s.no_struk,$a$,
 $r$values(reversal,public.sales_next_number('JRN',case when j.source=v_source||'-hpp' then d else j.tanggal end /* B3_TANGGAL_ASLI */),
    case when j.source=v_source||'-hpp' then d else j.tanggal end,'Pembatalan '||s.no_struk,$r$], 'B3_TANGGAL_ASLI');

-- 2b. Void & terbitkan ulang klinik: jurnal batal + terbit ulang di tanggal nota asli; pasangan HPP tetap hari ini.
select pg_temp.patch('public.clinic_void_reissue_invoice_core(uuid,text,text)', array[
 $a$  select pola,digit into v_pattern,v_digits from public.document_numbering where jenis='INV';$a$,
 $r$  -- B3_TANGGAL_ASLI: jurnal batal & terbit ulang (pendapatan/piutang) dibukukan di tanggal nota asli (= tanggal nota pengganti).
  -- Pagar tanggal itu: tutup buku, rekonsiliasi bank rekening yang dibalik, penggajian bulan itu (komisi = tanggal lunas asli).
  -- Pasangan HPP batal + HPP terbit ulang tetap hari ini (stok tidak bergerak; keduanya saling meniadakan).
  if public.b3_tanggal_jurnal(v_invoice.created_at)<>current_date then
    perform public.b3_tolak_tanggal_asli(public.b3_tanggal_jurnal(v_invoice.created_at),
      array(select distinct a.code from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
        join public.coa_accounts a on a.id=l.account_id
        where e.source_ref=v_invoice.invoice_no and e.source in ('klinik','klinik-reissue','klinik-edit')
          and a.code is distinct from v_cash_code),true,true);
  end if;
  select pola,digit into v_pattern,v_digits from public.document_numbering where jenis='INV';$r$,
 $a$perform public.clinic_write_journal(current_date,'Pembatalan '||v_invoice.invoice_no,$a$,
 $r$perform public.clinic_write_journal(public.b3_tanggal_jurnal(v_invoice.created_at),'Pembatalan '||v_invoice.invoice_no,$r$,
 $a$perform public.clinic_write_journal(current_date,'Terbit ulang '||v_no,$a$,
 $r$perform public.clinic_write_journal(public.b3_tanggal_jurnal(v_invoice.created_at),'Terbit ulang '||v_no,$r$], 'B3_TANGGAL_ASLI');

-- 2c. Koreksi nota hasil terbit ulang (belum selesai): jurnal penjualan koreksi di tanggal nota asli; HPP koreksi hari ini.
select pg_temp.patch('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', array[
 $a$  v_jdate date;
begin$a$,
 $r$  v_jdate date;
  v_hdate date; -- B3_TANGGAL_ASLI: tanggal jurnal HPP koreksi bila berbeda dari jurnal penjualan koreksi
begin$r$,
 $a$  if v_jdate <> current_date then perform clinic_private.backdate_assert_open(v_jdate); end if;$a$,
 $r$  if v_jdate <> current_date then perform clinic_private.backdate_assert_open(v_jdate); end if;
  -- B3_TANGGAL_ASLI: koreksi nota hasil "void & terbitkan ulang" (belum selesai, tanpa jendela tanggal efektif) dibukukan di tanggal
  -- nota asli -> selisih nilai masuk Laba Rugi di tanggal yang sama dengan laporan omzet. HPP koreksi tetap hari ini (stok bergerak hari ini).
  if clinic_private.backdate_date(p_invoice_id) is null and v_invoice.correction_pending and v_invoice.reissued_from is not null then
    v_jdate := public.b3_tanggal_jurnal(v_invoice.created_at);
    v_hdate := current_date;
    if v_jdate <> current_date then
      perform public.b3_tolak_tanggal_asli(v_jdate,
        array(select distinct a.code from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
          join public.coa_accounts a on a.id=l.account_id
          where e.source_ref=v_invoice.invoice_no and e.source in ('klinik','klinik-reissue','klinik-edit')),true,true);
    end if;
  end if;$r$,
 $a$perform public.clinic_write_journal(v_jdate,'Pembalikan HPP '||v_invoice.invoice_no,$a$,
 $r$perform public.clinic_write_journal(coalesce(v_hdate,v_jdate),'Pembalikan HPP '||v_invoice.invoice_no,$r$,
 $a$perform public.clinic_write_journal(v_jdate,'HPP koreksi '||v_invoice.invoice_no,$a$,
 $r$perform public.clinic_write_journal(coalesce(v_hdate,v_jdate),'HPP koreksi '||v_invoice.invoice_no,$r$], 'B3_TANGGAL_ASLI');

-- ───────────── 3. Pemeriksaan akhir ─────────────
do $check$
declare f text;
begin
 foreach f in array array['public.cancel_posted_sale(uuid,integer,text,text)','public.clinic_void_reissue_invoice_core(uuid,text,text)',
   'public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'] loop
  if position('B3_TANGGAL_ASLI' in pg_get_functiondef(f::regprocedure))=0 or position('SECURITY DEFINER' in pg_get_functiondef(f::regprocedure))=0 then
   raise exception 'B3_TANGGAL_ASLI belum terpasang di %',f;end if;
 end loop;
 if position('B3_TANGGAL_ASLI' in pg_get_functiondef('public.pos_sale_edit_void(uuid,integer,text,text)'::regprocedure))>0 then
  raise exception 'pos_sale_edit_void tidak boleh berubah';end if;
end $check$;
