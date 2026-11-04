# Arsip antrean klinik — lanjutan PR #438 (keputusan Andri 4 Nov 2026)

Migrasi: `supabase/migrations/20261106840000_antrian_arsip_paksa_dan_selesai_erp.sql` (setelah `20261106400000`, tidak mengubah file lama).
Bukti native: `scripts/test-antrian-arsip-postgres.py` (96 tes lama tetap hijau + tes baru).

## 1. Arsip PAKSA oleh OWNER
RPC baru `public.clinic_force_archive_visit(p_visit_id, p_reason, p_request_key, p_confirm)` (hanya `authenticated`, SECURITY DEFINER, `search_path=''`).

| Syarat | Ditegakkan di |
|---|---|
| Hanya OWNER aktif (ADMIN → `FORCE_DENIED`, STAFF/DOCTOR/FINANCE/nonaktif → `ACCESS_DENIED`) | database |
| Alasan >= 5 huruf/angka (tanda baca tidak dihitung), maksimal 500 | database + server action |
| Kata konfirmasi persis `PAKSA` (`FORCE_CONFIRM`) | database + server action (+ kotak persetujuan di layar) |
| Kunci baris `FOR UPDATE`, periksa ulang di bawah kunci, `lock_timeout=5s` | database |
| Jejak: `visit_archive_events.forced=true` + `overridden` (daftar syarat yang dilewati) + `activity_log` | database |

Yang boleh dilewati (**soft**): isi klinis, item/layanan belum ditagih, racikan pada rekam medis, persetujuan bertanda tangan, tindak lanjut/rujukan/addendum, tautan lanjutan rawat inap (status Diperiksa/Pembayaran memang tidak menghalangi).
Yang **tidak pernah** bisa dipaksa (**hard**): invoice (batal pun), pembayaran/kwitansi, uang muka, refund, penjualan racikan, jejak tagihan/kasir rawat inap, rawat inap (berjalan/riwayat), Selesai hasil impor, Selesai yang asalnya tidak pasti.
Arsip biasa (OWNER/ADMIN) tidak berubah; bila hanya syarat soft yang menghalangi, pesannya menyebut bahwa pemilik dapat memaksa.

## 2. Status Selesai hanya bila berasal dari ERP
Penanda yang dipakai (semua jalur impor rekam medis mengisinya; dijaga tes cakupan `pg_proc`: setiap fungsi yang `insert into visits ... 'Selesai'` harus mengisi `legacy_source_key`):

| Penanda | Diisi oleh |
|---|---|
| `visits.legacy_source_key` | semua impor: 0907, 0908, 0910, massal (1031), atomik (1101 09), jejak_setara (1101 10), penulis_riwayat_bersama (1101 12) |
| `visits.legacy_record_no` | impor sejak 0908 (nomor kartu lama) |
| `visits.legacy_source_hash` | impor sejak 1101 (sidik isi) |
| bukti ERP: `visits.checked_in_at` | registrasi klinik (`registrasi/actions.ts`) dan lanjutan rawat inap (`clinic_continue_visit_to_inpatient`); TIDAK diisi impor |

Aturan (`clinic_private.visit_archive_origin`): penanda impor terisi → `impor` (ditolak, juga saat dipaksa, **untuk status apa pun**: membalik status Selesai → Diperiksa tidak meloloskan); `checked_in_at` terisi → `erp` (boleh, mengikuti syarat biasa: tanpa invoice/pembayaran dst.); selain itu `tidak_pasti` → **ditolak (gagal tertutup)** bila kunjungan sudah selesai.

### Bukti asal tidak bisa dipalsukan (syarat review independen)
Trigger `a1_guard_visit_origin_evidence` (BEFORE UPDATE OF empat kolom itu, hanya jalan bila salah satunya berubah):
- `legacy_source_key` / `legacy_record_no` / `legacy_source_hash` / `checked_in_at` yang **sudah terisi** tidak bisa diubah atau dikosongkan oleh peran apa pun (STAFF, DOKTER, ADMIN, OWNER, bahkan `postgres`) lewat UPDATE biasa → `ORIGIN_LOCKED`.
- Yang **masih kosong** tidak bisa diisi belakangan oleh peran API (`authenticated`/`anon`/`service_role`); penanda hanya lahir saat INSERT (registrasi mengisi `checked_in_at`, semua jalur impor mengisi penanda impor saat INSERT — tidak berubah). DB admin (postgres di SQL editor) tetap boleh mengisi penanda yang masih kosong: itulah jalur klasifikasi oleh Reza (di bawah).
- Mengubah bukti yang sudah terisi butuh langkah sengaja (`alter table public.visits disable trigger a1_guard_visit_origin_evidence`), tidak bisa lewat aplikasi.
- Tidak dicakup: hapus-lalu-buat-ulang kunjungan (DELETE oleh STAFF/OWNER, temuan L4 PR #438) — itu menghapus isi klinisnya, bukan memalsukan asal baris yang ada.

### Celah yang tidak bisa dibuktikan dari kode (butuh Reza)
Kunjungan Selesai yang dibuat SEBELUM kolom `checked_in_at` ada (31 Agt 2026) atau yang dimasukkan lewat SQL/CSV di luar fungsi impor tidak punya penanda apa pun. Itu yang jatuh ke `tidak_pasti`. Kami **tidak menebak**. Klasifikasi oleh Reza (postgres, SQL editor, satu per satu setelah daftar dibaca): kunjungan yang jelas dari ERP diberi `checked_in_at` (hanya bila masih kosong; trigger mengizinkan DB admin, menolak peran API). Tidak ada kolom `origin` baru: penanda yang sudah ada + trigger tahan-ubah dipakai. SQL baca-saja untuk klasifikasi (dua pernyataan terpisah):

```sql
-- Ringkasan asal kunjungan Selesai (BACA SAJA)
select case when legacy_source_key is not null or legacy_record_no is not null or legacy_source_hash is not null then 'impor'
            when checked_in_at is not null then 'erp' else 'tidak_pasti' end as asal,
       count(*) as jumlah, min(created_at)::date as tertua, max(created_at)::date as terbaru,
       count(*) filter (where exists(select 1 from public.invoices i where i.visit_id = v.id)) as punya_invoice,
       count(*) filter (where branch_id is null) as tanpa_cabang,
       count(*) filter (where queue_number is not null) as punya_no_antri
from public.visits v where status::text = 'Selesai' or checked_out_at is not null group by 1 order by 1;
```

```sql
-- Daftar yang perlu diklasifikasi Reza (tidak_pasti), terbaru dulu
select v.id, v.created_at::date as tanggal, v.queue_number, v.branch_id, v.source,
       exists(select 1 from public.invoices i where i.visit_id = v.id) as punya_invoice,
       exists(select 1 from public.medical_records m where m.visit_id = v.id) as punya_rekam_medis
from public.visits v
where (v.status::text = 'Selesai' or v.checked_out_at is not null)
  and v.legacy_source_key is null and v.legacy_record_no is null and v.legacy_source_hash is null and v.checked_in_at is null
order by v.created_at desc limit 500;
```

## 3. Tampilan
- Antrian: OWNER melihat "Paksa arsip" di samping "Arsipkan": peringatan merah, alasan wajib (min. 5 huruf/angka), kotak persetujuan, ketik `PAKSA`. ADMIN hanya "Arsipkan"; server action menolak non-owner dengan "Hanya pemilik yang boleh memaksa arsip antrean." dan RPC menolak lagi di database.
- Baris Selesai kini boleh diarsipkan (tombol tampil) kecuali yang `legacy_source_key`-nya terisi; keputusan akhir tetap di database.
- Pesan `lock timeout` dijelaskan dalam bahasa biasa.

## 4. Arsip massal sebelum 1 Nov 2026 (versi setelah review)
Lihat `scripts/sql/bulk-archive-plan.md` untuk urutan aman: simulasi (`p_jalankan` NULL/false = simulasi, `p_batas` NULL = 50, maksimum 500) → baca daftar baris demi baris (baris Pembayaran/Selesai yang AKAN_DIARSIPKAN dengan isi klinis akan **dipaksa arsip**) → bagian terpisah **PERLU_MANUAL** (Pembayaran dengan invoice draft/belum lunas tidak pernah diarsipkan skrip) → jalankan per batch sampai `remaining_archivable = 0`.
`scripts/sql/bulk-arsip-antrian-pratinjau.sql` (baca-saja) dan `scripts/sql/bulk-arsip-antrian-jalankan.sql` (simulasi secara bawaan; **belum dijalankan di database mana pun**, hanya diuji pada fixture fiktif). Rencana dan langkah: `scripts/sql/bulk-archive-plan.md`.

## 5. Yang sengaja tidak diubah
`refuse_archived_visit`, `guard_visit_archive`, permit per transaksi, daftar tabel penjaga INSERT, patch `daftar_rekam_medis`, tanda tangan publik `clinic_archive_visit/clinic_unarchive_visit`. Saran review L2/L3/L4 (TOCTOU penulis tanpa kunci visit, UPDATE visit_id, DELETE arsip) tidak dikerjakan di sini.
