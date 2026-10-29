# Rencana rilis operasional — impor rekam medis (PR #333, kode `e607722e`)

**Ini rencana, bukan izin eksekusi.** Tidak ada apply migrasi, deploy, merge, atau approve yang dilakukan atau
diizinkan oleh dokumen ini. Semua angka durasi lock **belum diketahui**: tidak ada akses Production, dan ukuran
tabel Production tidak dicek. Kueri pemeriksaan di bawah ditulis untuk operator berwenang, diuji hanya pada
Postgres sekali-pakai dengan data fiktif.

## 1. Apa yang dirilis

| Urutan | Item | Isi | Bergantung pada |
|---|---|---|---|
| 1 | Migrasi `supabase/migrations/20261101090000_impor_identitas_atomik.sql` | K1b (sidik isi), K3 (kunci HP kanonik), C3b (kunci identitas, RPC registrasi) | migrasi repo sebelumnya, terutama `20260910033000` (versi `import_legacy_medical_record_resolved`) dan `20261031210000` (impor massal, `import_legacy_phone_key`, indeks `customers_import_phone_key_idx`) |
| 2 | Migrasi `supabase/migrations/20261101100000_impor_jejak_setara.sql` | jejak sumber setara 08/62/0062, gagal tertutup bila kecocokan historis > 1 | migrasi 1 |
| 3 | Aplikasi (merge ke `main`) | registrasi klinik memakai RPC atomik; importer: Coba lagi, titik simpan berbasis SHA-256 isi | **migrasi 1 wajib sudah terpasang** |

**Urutan wajib: migrasi 1 → migrasi 2 → baru merge/deploy aplikasi.**
- `vercel.json` hanya mendeploy cabang `main`, jadi **merge = deploy Production**. Merge tidak boleh terjadi sebelum
  migrasi 1 terpasang: aplikasi baru memanggil `registrasi_pelanggan_atomik` dan `customer_pick_by_phone`; tanpa
  migrasi 1 **registrasi klinik gagal** (fungsi tidak ada).
- Aplikasi lama tetap jalan di atas database yang sudah dimigrasi (lihat §5), jadi jeda antara migrasi dan merge aman
  untuk operasional klinik — dengan importer DITAHAN.
- Migrasi 2 tidak dibutuhkan aplikasi, tetapi tanpa migrasi 2 impor dari folder `08..` dan `+62..` bisa mencatat
  kunjungan ganda. Importer tetap ditahan sampai keduanya terpasang.
- Tiap berkas migrasi dijalankan sebagai **satu transaksi** (keduanya punya pra-cek dan pasca-cek gagal tertutup;
  gagal = seluruh berkas batal, tidak ada perubahan setengah jalan). Catat ke riwayat migrasi dengan cara yang biasa
  dipakai tim (repo ini tidak mendokumentasikan caranya — perlu dikonfirmasi pemegang akses). Bila dipasang lewat SQL
  editor tanpa mencatat riwayat, `db push` berikutnya akan mencoba memasang ulang dan gagal karena fungsi sudah ada.

## 2. Backup (sebelum migrasi 1)
Minimum yang harus ada dan dikonfirmasi oleh pemegang akses (status saat ini: **belum diketahui**):
1. Backup otomatis/PITR Supabase aktif, dengan waktu titik pulih terakhir dicatat sebelum migrasi.
2. Simpan definisi fungsi yang akan ditimpa, untuk rollback tanpa menebak:
   `pg_get_functiondef` dari `import_legacy_medical_record_resolved(...)`, `import_legacy_medical_records_bulk(jsonb)`,
   `import_legacy_phone_key(text)`.
3. Bila kebijakan tim mewajibkan: dump logis tabel `customers`, `pets`, `visits`, `medical_records`. Berisi data
   pasien → disimpan sesuai kebijakan data, bukan di repo/chat.
4. Uji pemulihan dari backup **belum pernah dilakukan** untuk rilis ini.

## 3. Preflight read-only (dijalankan operator berwenang, sebelum migrasi 1)
Semua kueri SELECT saja. Hasil "tidak" pada P1 = **berhenti**, jangan pasang.

**P1 — database cocok dengan versi yang direview & migrasi belum terpasang** (mengulang pra-cek migrasi):
```sql
select
  position('where v.legacy_source_key = p_source_key' in pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure)) > 0
    and position('pg_advisory_xact_lock(hashtext(v_owner_key' in pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure)) > 0 as resolved_versi_direview,
  position('select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;' in pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure)) > 0 as bulk_versi_direview,
  to_regclass('public.customers_import_phone_key_idx') is not null as indeks_hp_ada,
  to_regprocedure('public.indonesian_phone_key(text)') is null as migrasi1_belum_terpasang,
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'visits' and column_name = 'legacy_source_hash') as kolom_sidik_belum_ada,
  to_regprocedure('public.import_legacy_source_key_canonical(text)') is null as migrasi2_belum_terpasang;
```
Semua kolom harus `true`. (Bila fungsi lama tidak ada sama sekali, kueri ini error → juga berhenti.)

**P2 — ukuran tabel yang akan dikunci** (untuk memilih jendela waktu; tidak mengubah apa pun):
```sql
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as ukuran
from pg_stat_user_tables where schemaname = 'public' and relname in ('visits', 'customers');
```

**P3 — transaksi panjang yang bisa membuat migrasi mengantre** (tepat sebelum apply):
```sql
select pid, state, now() - xact_start as umur_transaksi, left(query, 80) as kueri
from pg_stat_activity where xact_start is not null and pid <> pg_backend_pid() order by xact_start;
```

**P4 — dampak (opsional, hanya angka agregat, butuh persetujuan karena menyentuh data pelanggan/kunjungan):**
```sql
-- Kunjungan berjejak impor tanpa sidik isi: bila kartunya diimpor ulang akan DITAHAN "belum terbukti".
select count(*) as kunjungan_berjejak from public.visits where legacy_source_key is not null;

-- Kelompok jejak lama yang setara 08/62/0062 (> 1 kunjungan): kartu ini akan DITAHAN "ganda di riwayat lama".
with k as (
  select case when cardinality(string_to_array(legacy_source_key, '::')) = 4 and split_part(legacy_source_key, '::', 2) ~ '^[0-9]+$'
    then split_part(legacy_source_key, '::', 1) || '::' || (
      case when split_part(legacy_source_key, '::', 2) ~ '^0062' and length(split_part(legacy_source_key, '::', 2)) >= 12 then '0' || substr(split_part(legacy_source_key, '::', 2), 5)
           when split_part(legacy_source_key, '::', 2) ~ '^62' and length(split_part(legacy_source_key, '::', 2)) >= 10 then '0' || substr(split_part(legacy_source_key, '::', 2), 3)
           else split_part(legacy_source_key, '::', 2) end)
      || '::' || split_part(legacy_source_key, '::', 3) || '::' || split_part(legacy_source_key, '::', 4)
    else legacy_source_key end as c
  from public.visits where legacy_source_key is not null)
select count(*) as kelompok_jejak_ganda from (select c from k group by c having count(*) > 1) g;

-- Nomor HP (kanonik) yang dipakai > 1 pelanggan: registrasi klinik dengan nomor ini akan DITOLAK
-- kecuali tulisan nomornya persis sama dengan salah satu kartu.
with h as (
  select case when d ~ '^0062' and length(d) >= 12 then '0' || substr(d, 5)
              when d ~ '^62' and length(d) >= 10 then '0' || substr(d, 3) else d end as k
  from (select regexp_replace(coalesce(phone, ''), '\D', '', 'g') as d from public.customers) s)
select count(*) as nomor_dipakai_banyak_pelanggan from (select k from h where k <> '' group by k having count(*) > 1) g;
```

Kueri P1–P4 sudah diuji pada Postgres 17.10 sekali-pakai dengan data fiktif: P1 semua `true` sebelum migrasi dan
`false` pada kolom "versi direview/belum terpasang" sesudahnya; P4 menghitung benar kasus fiktif (1 kelompok jejak
setara, 1 nomor dipakai dua pelanggan) dan ekspresi kanonik di P4 sama dengan fungsi migrasi 2 untuk data uji.

## 4. Paparan lock dan indeks (durasi: BELUM DIKETAHUI)
Durasi bergantung ukuran tabel dan lalu lintas saat itu (P2/P3); tidak ditebak di sini.

| Migrasi | Langkah | Lock | Yang tertahan selama lock dipegang |
|---|---|---|---|
| 1 | `alter table visits add column legacy_source_hash text` | ACCESS EXCLUSIVE pada `visits` (perubahan metadata, kolom nullable tanpa default) — **dipegang sampai transaksi migrasi 1 selesai** | semua baca/tulis `visits`: antrian, registrasi kunjungan, rekam medis, kasir klinik yang membaca kunjungan |
| 1 | `reindex index customers_import_phone_key_idx` (tidak concurrent) | SHARE pada `customers` + ACCESS EXCLUSIVE pada indeks itu | tulis `customers` (registrasi pelanggan baru, Kasir/CRM tambah pelanggan); kueri yang memakai indeks itu. Karena satu transaksi dengan langkah di atas, `visits` juga tetap terkunci selama reindex |
| 1 | create/replace fungsi | lock katalog singkat | — |
| 2 | `create index visits_legacy_source_key_canonical_idx` (tidak concurrent, parsial) | SHARE pada `visits` sampai transaksi migrasi 2 selesai | semua tulis `visits` (baca tetap jalan). Indeks parsial tetap memindai seluruh tabel saat dibangun |
| 2 | create/replace fungsi | lock katalog singkat | — |

Teramati pada Postgres 17.10 sekali-pakai (data fiktif), migrasi dijeda tepat sebelum commit:
migrasi 1 memegang `visits` AccessExclusiveLock (+ ShareUpdateExclusiveLock), `customers` ShareLock, dan
`customers_import_phone_key_idx` AccessExclusiveLock; migrasi 2 memegang `visits` ShareLock. Durasinya di
Production tetap belum diketahui.

Mitigasi yang bisa dipilih operator (tanpa mengubah teks migrasi):
- Jalankan di luar jam operasional klinik **dan** petshop.
- Set `lock_timeout` sesi ke nilai pendek pilihan operator sebelum apply, supaya bila ada transaksi panjang (P3)
  migrasi gagal cepat dan bersih alih-alih mengantre dan membuat semua permintaan lain ikut menunggu.
- Mengubah indeks migrasi 2 menjadi `create index concurrently` terpisah **mengubah teks migrasi** → butuh review
  ulang; tidak dilakukan di PR ini.

## 5. Kompatibilitas dan rollback

| Kondisi | Aman? | Catatan |
|---|---|---|
| Aplikasi lama + DB sesudah migrasi 1 (dan 2) | Ya | Nama/argumen RPC lama tidak berubah; registrasi lama (cek+insert) tetap jalan, **tanpa** perlindungan C3b; importer lama tetap jalan tetapi masih punya bug Coba lagi → **importer ditahan**. |
| Aplikasi baru + DB tanpa migrasi 1 | **Tidak** | Registrasi klinik gagal. Jangan merge sebelum migrasi 1. |
| Aplikasi baru + DB migrasi 1 tanpa migrasi 2 | Jalan, importer belum aman | Impor 08/62 bisa ganda → importer ditahan sampai migrasi 2. |
| Rollback aplikasi (revert merge), DB tetap | Ya | Kembali ke baris pertama tabel ini. **Rollback yang disarankan.** |
| Rollback migrasi 2 saja | Mungkin | Pasang ulang badan dua RPC dari migrasi 1, drop 3 fungsi baru + indeks. Skrip rollback **belum ada** di repo; perlu ditulis dan direview bila diwajibkan. |
| Rollback migrasi 1 | Hanya setelah aplikasi di-revert | Pulihkan `import_legacy_medical_record_resolved` (dari `20260910033000`/definisi tersimpan §2), `import_legacy_medical_records_bulk` dan `import_legacy_phone_key` (dari `20261031210000`), lalu reindex indeks HP; drop fungsi baru. Kolom `legacy_source_hash` boleh dibiarkan (nullable). Skrip **belum ada**. |

Data yang ditulis versi baru (kunjungan dengan sidik, pelanggan dari RPC registrasi) tetap valid untuk versi lama;
tidak ada data yang perlu dibalik. Preferensi: perbaikan maju, bukan rollback DB.

## 6. Operasional klinik dan kapan importer DITAHAN
- **Registrasi/klinik normal tetap berjalan** sebelum, sesudah migrasi, dan sesudah deploy — kecuali selama lock
  migrasi dipegang (§4: tulis `visits`/`customers` tertahan; durasi belum diketahui).
- Perubahan perilaku sesudah deploy: registrasi **menolak** nomor HP yang terdaftar pada beberapa pelanggan (kecuali
  tulisannya persis sama dengan salah satu). Jumlahnya belum diketahui (P4). **Perlu keputusan pemilik**: SOP meja
  depan bila ditolak (mis. admin memeriksa data pelanggan dulu). Agen tidak memutuskan aturan ini.
- **Importer DITAHAN** (tidak dipakai untuk data pasien nyata):
  1. sejak preflight sampai migrasi 1 + 2 terpasang **dan** aplikasi baru ter-deploy + smoke test lulus;
  2. sampai ada izin terpisah untuk impor pasien nyata/Production (rencana ini bukan izin itu);
  3. selama jendela migrasi/rollback apa pun;
  4. selama celah Kasir/CRM di §7 belum ditutup oleh perubahan yang ikut dirilis.
- Smoke test pasca-deploy tanpa menulis data: buka registrasi, cari nomor pelanggan fiktif/uji yang sudah ada dengan
  format `08..` dan `+62..` (pencarian bersifat baca-saja).

## 7. Batas nyata Kasir/CRM (belum memakai kunci identitas)
`tambahCustomerKasir` (Kasir) dan `simpanPelanggan` (CRM) masih cek `phone` persis lalu insert, tanpa kunci identitas
dan tanpa kunci HP kanonik. **Tidak ada perlindungan global** terhadap kartu pelanggan ganda.

Celah yang tersisa setelah rilis ini:
1. **Format nomor (tidak tergantung waktu).** Importer menyimpan nomor pelanggan baru sebagai digit dari nama folder
   (mis. `62812..` atau `0812..`). Kasir/CRM yang mengetik `0812-..` atau `+62 812..` tidak menemukan kartu itu dan
   **membuat kartu baru**. Celah ini sudah ada sebelum PR ini, tetapi impor menambah jumlah kartu yang bisa
   "terlewat".
2. **Balapan (tergantung waktu).** Kasir/CRM menambah pelanggan bersamaan dengan impor/registrasi untuk orang yang
   sama → bisa dua kartu. Bila >1 kartu bernomor persis sama sudah ada, `maybeSingle()` gagal diam-diam → kartu
   ketiga.

Dampak: kartu pelanggan ganda (poin/riwayat belanja terpecah). **Rekam medis impor tidak hilang dan tidak digabung
diam-diam**: impor berikutnya untuk pemilik dengan dua kartu bernama+HP sama akan **ditahan "Perlu keputusan"**
(gagal tertutup).

**Apakah importer bisa diluncurkan secara teknis dengan pembatasan sementara?** Ya, *untuk ruang lingkup importer*
— dengan pembatasan berikut, dan tanpa klaim aman global:
- **Jendela impor** hanya di luar jam buka Kasir/petshop dan saat tidak ada staf yang menambah pelanggan lewat
  Kasir/CRM (menutup celah 2 selama impor; tidak menutup celah 1).
- **SOP staf (berlaku terus sampai Kasir/CRM diperbaiki):** sebelum "Tambah customer" di Kasir/CRM, cari dulu di
  pencarian global dengan **8 digit terakhir** nomor HP dan dengan nama; pakai kartu yang ada bila ketemu.
  (Pencarian global mencocokkan sebagian nomor, jadi `62812..`/`0812..` sama-sama muncul.)
- **Laporan pasca-impor read-only** (P4 bagian "nomor dipakai banyak pelanggan", diulang sesudah tiap jendela impor):
  kenaikannya diperiksa admin **manual**; tidak ada penggabungan otomatis.
- Pemilik menerima secara tertulis bahwa risiko celah 1 tetap ada sampai Kasir/CRM diperbaiki.

Keputusan koordinasi (29 Okt): celah Kasir/CRM **ditutup dalam kode** (PR dependent, draft) sebelum rilis — tidak
mengandalkan SOP di luar jam. Pembatasan operasional di atas hanya relevan bila rilis dilakukan tanpa perubahan itu,
dan itu bukan rencana saat ini.

**Penyelesaian teknis** cukup dibuktikan dengan uji sintetis lokal: harness Postgres sekali-pakai dengan data fiktif +
tes vitest/komponen. **Tidak membuat preview deploy atau lingkungan baru tanpa izin.**

Syarat sebelum rilis Production (operasional, bukan tambahan teknis):
- Persetujuan atas teks persis migrasi; preflight P1 hijau; backup §2 terkonfirmasi; jendela waktu dipilih.
- Keputusan pemilik: SOP meja depan bila registrasi ditolak karena nomor dipakai beberapa pelanggan (§6).
- Bila rollback DB diwajibkan: skrip rollback §5 ditulis dan direview lebih dulu.
- Impor pasien nyata/Production tetap izin terpisah.

## 8. Checklist verifikasi pengguna (opsional; data fiktif)
**Bukan syarat teknis tambahan.** Skenario yang sama sudah dibuktikan otomatis oleh uji sintetis lokal. Checklist ini
hanya dipakai bila pemilik meminta verifikasi lapangan, dan hanya di lingkungan yang sudah diizinkan (tidak membuat
lingkungan baru). Bukti tiap langkah: tangkapan layar hasil impor + jumlah riwayat pasien uji sebelum/sesudah.

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| U1 | Impor folder fiktif normal (mis. `Fiktif Satu - 0800000011/Kucing.xlsx`, 3 tab) | 3 tersimpan; riwayat pasien uji = 3 |
| U2 | **Gagal/Coba lagi:** mulai impor folder lain, putuskan jaringan (DevTools → Offline) saat mengirim, tunggu "Coba lagi", sambungkan, klik Coba lagi | semua riwayat folder itu tersimpan; tidak ada yang hilang; tidak ada yang ganda |
| U3 | **Tab tertutup:** tutup tab di tengah impor banyak folder, buka lagi, pilih folder yang sama, lanjutkan | folder yang sudah selesai dilewati; sisanya diproses; total riwayat tidak ganda |
| U4 | **File berubah:** sesudah U1 selesai (titik simpan ada), ubah diagnosis di satu tab kartu U1 dengan panjang teks sama, kembalikan tanggal ubah berkas (salin dengan timestamp dipertahankan), lalu impor ulang/lanjutkan | folder itu diproses ulang; kartu yang diubah **ditahan "bentrok"**; kartu lain "sudah ada"; riwayat lama tidak berubah |
| U5 | **08 → 62:** sesi baru, impor kartu yang sama persis dari folder `Fiktif Satu - +62 800-0000-011` | semua "sudah ada"; jumlah riwayat tetap |
| U6 | **62 → 08:** pasien uji lain: impor dulu dari folder `+62..`, lalu dari folder `08..` | "sudah ada"; jumlah riwayat tetap |
| U7 | **Konflik:** folder `+62..` dengan satu kartu diubah isinya | kartu itu **ditahan "bentrok"**; riwayat lama tidak berubah; catatan ditahan bisa diunduh dengan alasan |
| U8 | **Ambigu historis:** di lingkungan uji, buat dua riwayat setara untuk satu kartu (hanya bisa lewat seed SQL oleh pengembang, karena aplikasi sekarang mencegahnya), lalu impor kartu itu | **ditahan "ganda di riwayat lama"**; tidak ada riwayat dipilih/ditambah |
| U9 | **Kartu berbeda isi identik:** dua tab berbeda dengan isi persis sama untuk pasien yang sama | tetap 2 riwayat (tidak digabung) |
| U10 | **Registrasi:** pelanggan uji terdaftar `0800..`; daftar ulang dengan `+62 800..` | memakai pelanggan yang sama; tidak ada kartu baru |
| U11 | **Registrasi ambigu:** nomor uji yang dipakai dua pelanggan uji | ditolak dengan pesan "minta admin memeriksa data pelanggan" |

Status: checklist ini belum dijalankan oleh pengguna. Padanan otomatisnya sudah lulus: harness Postgres (S1–S14,
C9–C10, X1–X3, K/U/R), tes komponen Coba lagi dan titik simpan berbasis isi.
