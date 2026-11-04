-- PRATINJAU BACA-SAJA: arsip massal antrean klinik sebelum 1 Nov 2026 (data percobaan, keputusan Andri 4 Nov 2026).
-- Tidak menulis apa pun (hanya SELECT). Jalankan sebagai postgres di SQL editor SETELAH migrasi
-- 20261106840000 aktif. Tidak bergantung pada fungsi arsip: bendera uang/stok dihitung langsung dari tabel.
-- Ubah HANYA tanggal batas di baris "cutoff".
--
-- Hasil 6 tabel (jalankan satu per satu bila editor hanya menampilkan hasil terakhir):
--   [1] jumlah per status x kategori   [2] daftar baris yang DILEWATI karena uang/stok/rawat inap   [3] Selesai impor / asal tidak pasti
--   [4] PERLU DITANGANI MANUAL: kunjungan masih di antrean (mis. Pembayaran + invoice draft/belum lunas) yang TIDAK akan diarsipkan
--   [5] Pembayaran/Selesai yang berisi data klinis dan AKAN DIPAKSA arsip (Owner wajib membaca baris demi baris)
--   [6] cek impor bercabang (branch_id terisi + penanda impor) di seluruh tabel kunjungan, sebelum arsip massal dijalankan
-- Kategori:
--   ARSIP_BIASA        tidak ada isi klinis/item/persetujuan, tidak ada uang/stok -> lolos arsip biasa
--   ARSIP_PERLU_PAKSA  ada isi klinis/item tertunda/persetujuan/tindak lanjut tapi TIDAK ada uang/stok -> diarsipkan dengan mode paksa OWNER
--   DILEWATI_UANG_STOK ada invoice/pembayaran/DP/refund/racikan terjual/pergerakan stok/tagihan rawat inap/rawat inap
--   DILEWATI_IMPOR     penanda impor terisi (legacy_source_key / legacy_record_no / legacy_source_hash), status apa pun
--   DILEWATI_ASAL_TIDAK_PASTI  Selesai tanpa penanda impor tetapi tanpa bukti ERP (checked_in_at kosong)

drop table if exists pg_temp.bulk_arsip_pratinjau;
create temp table bulk_arsip_pratinjau as   -- tabel sementara sesi ini saja (hilang saat sesi berakhir); tidak menyentuh data klinik
with p as (select timestamptz '2026-11-01 00:00:00+07' as cutoff),  -- <== batas (WIB)
f as (
 select v.id, v.status::text as status, v.branch_id, v.created_at, v.queue_number, v.checked_out_at,
  (v.legacy_source_key is not null or v.legacy_record_no is not null or v.legacy_source_hash is not null) as impor,
  (v.checked_in_at is not null) as bukti_erp,
  exists(select 1 from public.invoices i where i.visit_id=v.id) as ada_invoice,
  exists(select 1 from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.visit_id=v.id)
   or exists(select 1 from public.clinic_payment_receipts r where r.visit_id=v.id) as ada_pembayaran,
  exists(select 1 from public.clinic_customer_advances a where a.visit_id=v.id) as ada_dp,
  exists(select 1 from public.clinic_refunds r where r.visit_id=v.id) as ada_refund,
  exists(select 1 from public.clinic_compound_sales s where s.visit_id=v.id) as ada_racikan_terjual,
  exists(select 1 from public.stock_moves m join public.invoices i on i.invoice_no=m.source_ref where i.visit_id=v.id and m.source='klinik')
   or exists(select 1 from public.stock_moves m join public.clinic_compound_sales s on s.recipe_id::text=m.source_ref where s.visit_id=v.id and m.source='racik') as ada_pergerakan_stok,
  exists(select 1 from public.clinic_inpatient_billable_entries e where e.visit_id=v.id)
   or exists(select 1 from clinic_private.inpatient_bill_pay_requests e where e.visit_id=v.id)
   or exists(select 1 from clinic_private.inpatient_cashier_requests e where e.visit_id=v.id)
   or exists(select 1 from public.clinic_pending_cart_edits e where e.visit_id=v.id) as ada_tagihan_ranap,
  exists(select 1 from public.inpatient_records s where s.visit_id=v.id) or exists(select 1 from public.inpatient_rx_evidence e where e.visit_id=v.id) as ada_ranap,
  exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id=v.id) as ada_item_resep,
  exists(select 1 from public.consents c where c.visit_id=v.id and c.status='sudah_ttd') as ada_persetujuan_ttd,
  exists(select 1 from public.medical_records mr where mr.visit_id=v.id and (
    coalesce(nullif(btrim(mr.diagnosis),''),nullif(btrim(mr.anamnesis),''),nullif(btrim(mr.therapy),''),nullif(btrim(mr.gejala_klinis),''),
     nullif(btrim(mr.hasil_penunjang),''),nullif(btrim(mr.follow_up),''),nullif(btrim(mr.catatan_resep),'')) is not null
    or mr.suhu is not null or mr.berat is not null or coalesce(cardinality(mr.penunjang_urls),0)>0
    or mr.submission_key is not null or mr.submitted_by is not null or mr.clinical_revision>0 or mr.continued_from_record_id is not null)) as ada_isi_klinis,
  exists(select 1 from public.follow_ups x where x.visit_id=v.id) or exists(select 1 from public.visit_referrals x where x.visit_id=v.id)
   or exists(select 1 from public.clinic_record_addenda x where x.visit_id=v.id) or exists(select 1 from public.clinic_record_item_additions x where x.visit_id=v.id)
   or exists(select 1 from public.compounding_recipes c join public.medical_records mr on mr.id=c.medical_record_id where mr.visit_id=v.id)
   or v.continued_from_visit_id is not null or exists(select 1 from public.visits o where o.continued_from_visit_id=v.id) as ada_tindak_lanjut_dll
 from public.visits v, p where v.created_at < p.cutoff and v.archived_at is null)
select f.*,
 case
  when f.ada_invoice or f.ada_pembayaran or f.ada_dp or f.ada_refund or f.ada_racikan_terjual or f.ada_pergerakan_stok or f.ada_tagihan_ranap or f.ada_ranap then 'DILEWATI_UANG_STOK'
  when f.impor then 'DILEWATI_IMPOR'
  when (f.status='Selesai' or f.checked_out_at is not null) and not f.bukti_erp then 'DILEWATI_ASAL_TIDAK_PASTI'
  when f.ada_item_resep or f.ada_persetujuan_ttd or f.ada_isi_klinis or f.ada_tindak_lanjut_dll then 'ARSIP_PERLU_PAKSA'
  else 'ARSIP_BIASA' end as kategori
from f;

-- [1] jumlah per status x kategori
select status, kategori, count(*) as jumlah, min(created_at)::date as tertua, max(created_at)::date as terbaru
from bulk_arsip_pratinjau group by status, kategori order by status, kategori;

-- [2] baris yang dilewati karena uang / stok / rawat inap (periksa satu per satu sebelum menjalankan)
select b.id as visit_id, b.status, b.created_at::date as tanggal, b.queue_number, pt.name as pasien, c.name as pemilik,
 b.ada_invoice, b.ada_pembayaran, b.ada_dp, b.ada_refund, b.ada_racikan_terjual, b.ada_pergerakan_stok, b.ada_tagihan_ranap, b.ada_ranap
from bulk_arsip_pratinjau b
left join public.visits v on v.id=b.id left join public.pets pt on pt.id=v.pet_id left join public.customers c on c.id=v.customer_id
where b.kategori='DILEWATI_UANG_STOK' order by b.created_at, b.id;

-- [3] Selesai yang bukan jelas dari ERP (klasifikasi untuk Reza)
select b.id as visit_id, b.status, b.created_at::date as tanggal, b.impor, b.bukti_erp, b.kategori
from bulk_arsip_pratinjau b where b.kategori in ('DILEWATI_IMPOR','DILEWATI_ASAL_TIDAK_PASTI') order by b.kategori, b.created_at limit 500;

-- [4] perlu ditangani manual: masih di antrean aktif (bukan Selesai) tetapi ada penghalang uang/stok/rawat inap -> skrip TIDAK akan mengarsipkannya
-- (invoice draft/belum lunas/dibatalkan pun menghalangi). Selesaikan atau batalkan lewat alur kasir/rawat inap, atau minta Reza menanganinya.
select b.id as visit_id, b.status, b.created_at::date as tanggal, b.queue_number, pt.name as pasien, c.name as pemilik,
 (select string_agg(distinct i.paid_status::text||case when i.voided_at is not null then ' (dibatalkan)' else '' end, ', ') from public.invoices i where i.visit_id=b.id) as status_invoice,
 b.ada_pembayaran, b.ada_dp, b.ada_refund, b.ada_racikan_terjual, b.ada_tagihan_ranap, b.ada_ranap, 'perlu ditangani manual' as keterangan
from bulk_arsip_pratinjau b
left join public.visits v on v.id=b.id left join public.pets pt on pt.id=v.pet_id left join public.customers c on c.id=v.customer_id
where b.kategori in ('DILEWATI_UANG_STOK','DILEWATI_IMPOR') and b.status<>'Selesai' and b.checked_out_at is null
order by b.status, b.created_at, b.id;

-- [5] BC3: Pembayaran / Selesai dengan isi klinis atau item/persetujuan -> AKAN DIPAKSA arsip dan hilang dari daftar Rekam Medis (riwayat per hewan tetap
-- menampilkannya). Baca baris demi baris; yang masih dibutuhkan jangan diarsipkan (biarkan di luar skrip dengan menyesuaikan batas tanggal atau tangani dulu).
select b.id as visit_id, b.status, b.created_at::date as tanggal, b.queue_number, pt.name as pasien, c.name as pemilik,
 b.ada_isi_klinis, b.ada_item_resep, b.ada_persetujuan_ttd, b.ada_tindak_lanjut_dll
from bulk_arsip_pratinjau b
left join public.visits v on v.id=b.id left join public.pets pt on pt.id=v.pet_id left join public.customers c on c.id=v.customer_id
where b.kategori='ARSIP_PERLU_PAKSA' and b.status in ('Pembayaran','Selesai') order by b.status, b.created_at, b.id;

-- [6] cek impor bercabang (seluruh tabel, bukan hanya sebelum batas): kunjungan impor dengan branch_id terisi. Penanda impor tidak bisa lagi dihapus
-- oleh staf (trigger), jadi ini hanya hitungan informasi; semua baris ini DIKECUALIKAN dari arsip (DILEWATI_IMPOR).
select count(*) as impor_bercabang, min(created_at)::date as tertua, max(created_at)::date as terbaru
from public.visits where branch_id is not null
 and (legacy_source_key is not null or legacy_record_no is not null or legacy_source_hash is not null);
