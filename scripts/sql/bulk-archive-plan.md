# Rencana arsip massal antrean sebelum 1 Nov 2026 — DRAF, BELUM DIJALANKAN

Keputusan Andri 4 Nov 2026: semua antrean sebelum 1 Nov 2026 adalah data percobaan → diarsipkan massal, alasan `data percobaan sebelum 1 Nov 2026`.
Berkas (di repo `scripts/sql/`, branch `hermes/arsip-followup`; salinan di folder bukti):
- `bulk-arsip-antrian-pratinjau.sql` — BACA-SAJA (hanya tabel sementara sesi). 6 hasil, lihat langkah 1.
- `bulk-arsip-antrian-jalankan.sql` — fungsi `pg_temp` + satu `select`; **simulasi (dry run) secara bawaan**.

Prasyarat: migrasi `20261106840000` sudah aktif (fungsi klasifikasi, jalur arsip paksa, dan trigger penanda asal) dan diterapkan sebagai SATU transaksi.

## Aturan keselamatan parameter (dijaga di database dan diuji native)
| Parameter | Aturan |
|---|---|
| `p_jalankan` | **hanya `true`** yang mengarsipkan sungguhan. `false` **atau NULL = dry run** (tidak menulis apa pun). |
| `p_batas` | NULL = **50** (bukan tanpa batas). Harus **1..500**; 0, negatif, atau di atas 500 **ditolak**. |
| Tanggal | batas tidak boleh melewati 1 Nov 2026 (+07); alasan ≥ 5 huruf/angka; hanya OWNER aktif. |

## Hasil skrip (satu tabel, urut: ringkasan dulu)
- `RINGKASAN` — satu baris; kolom `ringkasan` (jsonb): `dry_run`, `batas`, `archived_this_run`, `would_archive_this_run`, **`remaining_archivable`**, `skipped_total`, **`skipped_by_reason`** (hitungan per alasan), `manual_total`, `akan_dipaksa_per_status` (mis. `{"Pembayaran": 3, "Selesai": 12}`), `gagal`.
- `PERLU_MANUAL` — bagian terpisah **perlu ditangani manual**: kunjungan yang masih di antrean (Menunggu/Diperiksa/Pembayaran) tetapi tidak pernah diarsipkan skrip karena uang/stok/rawat inap. Contoh utama: **Pembayaran dengan invoice draft/belum lunas** (invoice apa pun, termasuk draft atau dibatalkan, adalah penghalang keras) dan rawat inap berjalan. Maksimum 200 baris ditampilkan; jumlah seluruhnya di `manual_total`.
- `AKAN_DIARSIPKAN` (dry run) / `DIARSIPKAN` (jalankan) — maksimum `p_batas` baris per eksekusi, dengan `detail` = `arsip biasa` atau `dipaksa: <syarat yang dilewati>`; `GAGAL` = ditolak atau kena lock timeout (tidak terarsip, dicoba lagi di batch berikutnya).
- Yang dilewati permanen (invoice/pembayaran/DP/refund/racikan terjual/rawat inap, **riwayat impor**, Selesai asal tidak pasti, dan yang dipulihkan manual setelah arsip massal) **tidak ditampilkan per baris**; hanya dihitung di `skipped_total` dan `skipped_by_reason`. Karena itu hasil per-baris pendek dan pengulangan **konvergen**.

## Langkah (Reza, SQL editor sebagai postgres, di luar jam klinik)
1. **Pratinjau** — jalankan `bulk-arsip-antrian-pratinjau.sql`. Hasil:
   [1] jumlah per status × kategori; [2] DILEWATI uang/stok/rawat inap; [3] Selesai impor / asal tidak pasti;
   [4] **perlu ditangani manual** (masih di antrean, tidak akan diarsipkan); [5] **Pembayaran/Selesai dengan isi klinis yang AKAN DIPAKSA arsip**;
   [6] hitungan impor bercabang (informasi).
2. **Owner membaca [4] dan [5] baris demi baris.** Baris Pembayaran dan Selesai yang punya isi klinis (diagnosis, resep/item, persetujuan bertanda tangan, tindak lanjut) **akan di-force-archive** dan hilang dari daftar Rekam Medis (riwayat per hewan tetap menampilkannya). Yang masih dibutuhkan jangan dibiarkan masuk batch (tangani dulu). Andri/Reza menyetujui angka di [1] dan daftar [2]–[5].
3. **Selesaikan [4] secara manual** (Pembayaran dengan invoice draft/belum lunas: lanjutkan kasir atau minta Reza; skrip tidak akan pernah mengarsipkannya).
4. **Dry run** — buka `bulk-arsip-antrian-jalankan.sql`, ganti `OWNER_UUID` (profil OWNER aktif). Biarkan `false` (atau `NULL` — sama-sama dry run) dan `p_batas` 50. Baca baris `RINGKASAN` (`would_archive_this_run`, `remaining_archivable`, `skipped_by_reason`, `akan_dipaksa_per_status`) dan daftar `AKAN_DIARSIPKAN` **baris demi baris** (kolom `detail`: `dipaksa: ...` = isi klinis yang akan dilewati). Tidak menulis apa pun.
5. **Jalankan per batch** — ubah `false` → `true`. Ulangi eksekusi yang sama (batch 50, boleh sampai 500) sampai baris `RINGKASAN` menunjukkan **`remaining_archivable = 0`**. Kriteria berhenti BUKAN "hasil kosong" (selalu ada ringkasan dan mungkin `PERLU_MANUAL`).
   - Bila `archived_this_run = 0` tetapi `remaining_archivable > 0`: berhenti, baca baris `GAGAL` (detail galat), jangan lanjut membabi buta.
   - Satu eksekusi adalah satu pernyataan, atomik: bila kena `statement_timeout`/dibatalkan, **tidak ada** yang terarsip; kecilkan `p_batas` lalu ulangi. Kunci baris dipegang sampai pernyataan selesai (± 500 kunci pada batch penuh): jalankan di luar jam klinik; `lock_timeout` 5 dtk per kunjungan mengubah rebutan kunci menjadi baris `GAGAL`, bukan hang.
6. **Verifikasi** — tab Diarsipkan di Antrian; `select count(*) from visit_archive_events where reason='data percobaan sebelum 1 Nov 2026'`; jalankan pratinjau lagi (kategori `ARSIP_*` harus kosong).
7. **Pulihkan** satu per satu dari tab Diarsipkan bila ada yang salah (OWNER/ADMIN). Yang dipulihkan tidak akan diarsipkan ulang (kunci permintaan `bulk-arsip-20261101-<id>`; dihitung sebagai `SUDAH_PERNAH` di `skipped_by_reason`).

## Yang dilewati dan dilaporkan (tidak pernah dipaksa)
invoice (batal/draft pun) · pembayaran/kwitansi · uang muka · refund · racikan terjual · jejak tagihan/kasir rawat inap · rawat inap berjalan/riwayat · kunjungan hasil impor (penanda `legacy_*` terisi, status apa pun; penanda ini tidak bisa dihapus staf: trigger) · Selesai yang asalnya tidak pasti. Efek stok hanya bisa muncul lewat invoice/racikan terjual/rawat inap, jadi semuanya tercakup; pratinjau juga menampilkan pergerakan stok per kunjungan sebagai bukti tambahan.

## Jaminan (diuji native di `scripts/test-antrian-arsip-postgres.py`, fixture fiktif)
Pratinjau tidak menulis; dry run (termasuk `p_jalankan` NULL) tidak menulis; hanya OWNER aktif; batas tanggal tidak boleh melewati 1 Nov 2026; alasan ≥ 5 huruf/angka; `p_batas` NULL = 50 dan di luar 1..500 ditolak; idempoten; yang dipulihkan manual tidak diarsipkan ulang; pengulangan konvergen ke `remaining_archivable = 0` walau ada baris dilewati permanen; uang/stok/jurnal tidak berubah; kunjungan setelah batas dan yang sudah diarsipkan tidak disentuh.

## Belum diverifikasi
Tidak dijalankan pada database hosted dan belum ada hitungan nyata (berapa impor bercabang, berapa Selesai `tidak_pasti`, berapa Pembayaran dengan invoice draft); kinerja pada puluhan ribu kunjungan belum diukur (satu klasifikasi per kunjungan sebelum cutoff di setiap eksekusi, ± puluhan µs/baris pada harness); perilaku SQL editor Supabase untuk fungsi `pg_temp` multi-pernyataan hanya diuji lewat psql.
