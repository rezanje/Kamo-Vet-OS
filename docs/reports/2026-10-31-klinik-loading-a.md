# Klinik-A — Loading halaman & proses klinik (2026-10-31)

Branch `claude/klinik-a-loading`, base `origin/main` = `291bb8c8c99957762fde613819417645ffb3a2f1`.
Paket "Agen A" dari brief paralel klinik. **Selesai sebagian**: sumber lambat yang terbukti di
kode sudah dipangkas dan dikunci tes; waktu nyata di Production/peramban **belum diukur**.

## Batas bukti (baca dulu)

| Yang dibuktikan di sini | Yang TIDAK dibuktikan |
|---|---|
| Urutan permintaan ke database per rute: berapa putaran yang harus ditunggu **satu per satu** (kedalaman antre), dihitung dengan klien Supabase tiruan (`src/lib/__tests__/helpers/round-trip-client.ts`). Sebelum = kode `291bb8c8`, sesudah = branch ini, fixture & skenario sama. | Waktu milidetik di Production, jaringan Vercel icn1 ⇄ Supabase, cold start fungsi, waktu peramban/hidrasi, ukuran kiriman ke peramban. Tidak ada akses Production/log/peramban data asli di sesi ini. |
| Biaya eksekusi query baca di PostgreSQL 16 lokal dengan SELURUH 337 migrasi + RLS asli, fixture fiktif seukuran klinik sibuk (`scripts/test-klinik-a-loading-postgres.py`). Hanya SELECT yang di-EXPLAIN ANALYZE. | Bentuk SQL persis yang dibuat PostgREST (harness memakai SQL pendekatan dengan sub-select json). PG17 (Production) — hanya PG16 tersedia. |

Estimasi kasar U07 (laporan 2026-10-28): satu putaran server⇄database ≈ 30–80 ms dari icn1.
Angka itu **perkiraan**, bukan ukuran; dipakai di bawah hanya untuk memberi skala.

## Ringkasan per rute (kedalaman antre, sebelum → sesudah)

"Putaran" = jumlah tunggu ke database yang berurutan pada jalur terpanjang. Layout `(app)`
dirender berdampingan dengan halaman, jadi yang dirasakan ≈ maksimum(layout, halaman) + middleware.

| Rute / kejadian | Sebelum | Sesudah | Penyebab utama |
|---|---|---|---|
| Middleware — setiap navigasi, refresh & Server Action di `/klinik/*` (akun STAFF) | 6 | **2** | Profil → profil lagi → kapabilitas peran → penempatan cabang → baris cabang → shift, semua berurutan; dua di antaranya bacaan ulang |
| Layout `(app)` — ikut di setiap halaman & `router.refresh` | STAFF 5 / DOCTOR 4 | **2** | Katalog cabang & aturan modul menunggu sesi+profil; shift menunggu profil; banner cabang aktif membaca ulang cabang yang sudah ada di katalog |
| Antrean (buka & refresh otomatis 15 dtk) | 7 | **4** | Label cabang & voucher menunggu penjaga cabang; penjaga cabang sendiri 4 putaran berurutan |
| Riwayat pasien (Antrean → pasien) | 5 | **3** | Riwayat operasional, riwayat klinis lintas cabang (RPC) dan ringkasan transaksi pemilik dibaca bergantian padahal hanya butuh id kunjungan |
| Rekam Medis — tampilan tersimpan (juga dirender di respons **Simpan**) | 8 | **3** | Invoice dibaca dua kali (query identik); adendum, kunjungan lanjutan, cek invoice aktif masing-masing putaran sendiri; tab saudara & izin racik (3 bacaan berantai) menahan tahap 2 |
| Rekam Medis — form pemeriksaan (katalog 3.600 SKU) | 13 | **9** | Obat racik jadi menunggu seluruh katalog; kunjungan lanjutan putaran sendiri; tab saudara/izin racik menahan katalog. Sisa 9 = rantai katalog bersama (lihat "Sisa") |
| Pembayaran — buka tagihan baru (rawat jalan) | **37** | **11** | Hampir semua bacaan berurutan; resep dibaca 2×; sesi Auth dibaca 2×; perkiraan rombongan dihitung walau hanya 1 hewan |
| Pembayaran — tampilan sesudah **Bayar & Selesai** (tagihan Lunas, terkunci) | **36** | **5** | Sama + katalog 3.600 SKU, stok/satuan/harga (57 permintaan) dan bekal promo dimuat padahal tidak ditampilkan |
| Pembayaran — pasien rawat inap (ke kasir rawat inap) | 12 | **9** | 5 bacaan awal berurutan; sisa = katalog bersama |
| OBAT KHUSUS rawat inap | 7 (sudah U07) | 7 | Tidak diubah; tes penjaga ditambahkan. Sisa = katalog bersama |

Jumlah bacaan total per render hampir sama (yang dihapus hanya bacaan ganda/tak terpakai):
Pembayaran Lunas 104 → 29 bacaan, Pembayaran baru 104 → 94, Rekam Medis tersimpan 23 → 22.

### Alur "sesudah Simpan" (gabungan)
- **Simpan rekam medis → Pembayaran**: POST action (middleware 6→2) + render ulang Rekam Medis
  tersimpan di respons action (maks(layout 5, halaman 8) → 3) + navigasi ke Pembayaran
  (middleware 6→2, maks(layout 5, halaman 37) → 11). Total jalur ≈ **57 → 18 putaran**
  (+ bacaan pra-simpan & RPC simpan yang sudah dipercepat U07, tidak diubah).
- **Bayar & Selesai**: POST action (middleware 6→2) + render ulang Pembayaran di respons action
  (36 → 5) + navigasi ke `?success=bayar` yang merender halaman yang sama **sekali lagi** (36 → 5,
  middleware 6→2). Total ≈ **84 → 14 putaran** (+ bacaan & posting di action, U07, tidak diubah).
- Dengan perkiraan 30–80 ms/putaran itu setara ±2,5–6,7 dtk → ±0,4–1,1 dtk untuk Bayar & Selesai.
  **Ini estimasi, bukan ukuran Production.**

## Apa yang diubah (kecil, tanpa melewati penjaga)

Pola: bacaan yang tidak saling bergantung **dimulai** lebih awal (helper `mulai` dari U07), tetapi
**hasilnya tetap ditunggu dan diperiksa di posisi lama**, jadi urutan validasi, redirect, notFound
dan pesan galat tidak berubah; bacaan yang ditinggal karena redirect lebih awal tidak jadi galat liar.

1. `src/lib/branch-access.ts` — `allowedBranchIds`: penempatan cabang dibaca bersamaan dengan profil
   (dulu profil → kapabilitas → penempatan). Keputusan sama; akun bebas-cabang tetap `null`.
2. `src/lib/operational-branch.ts` — `resolveOperationalBranch`: baris cabang dibaca bersamaan dengan
   hak cabang, **dipakai hanya setelah** `canUseBranch` lolos (cabang adalah master yang memang boleh
   dibaca semua akun; dibuang bila tidak berhak).
3. `src/lib/supabase/middleware.ts` — cabang operasional & shift dimulai bersama profil/aturan modul.
   Urutan keputusan tetap: akun aktif → aturan modul → cabang sah → shift di cabang lain ditolak.
   Shift hanya ditunggu bila cabang lolos (sama seperti dulu).
4. `src/app/(app)/layout.tsx` + `src/components/ActiveBranch.tsx` — katalog cabang & aturan modul
   dimulai bersama sesi; shift STAFF dibaca bersama profil dan hanya ditunggu untuk STAFF; banner
   cabang aktif memakai katalog cabang aktif yang sudah dibaca (cabang di luar katalog tetap dibaca
   seperti dulu; layout kasir tidak berubah).
5. `src/app/(app)/klinik/antrian/page.tsx` — label cabang & voucher dimulai bersama sesi/penjaga cabang.
6. `src/app/(app)/klinik/antrian/[id]/page.tsx` — riwayat klinis (RPC) & ringkasan transaksi dimulai
   bersama riwayat operasional.
7. `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` — invoice tidak dibaca dua kali (query
   identik dari tahap 1 dipakai ulang); adendum, cek invoice aktif & kunjungan lanjutan ikut tahap 2;
   obat racik dibaca begitu kategori ada; tab saudara & izin racik ditunggu saat render.
   Izin adendum tetap diputuskan RPC `clinic_can_add_record_addendum`; koreksi tetap via
   `clinic_can_correct_record`.
8. `src/app/(app)/klinik/pembayaran/[visitId]/page.tsx` — bacaan yang hanya butuh `visitId`/rekam
   medis/invoice dimulai bersamaan; resep dibaca **sekali** untuk baris tagihan dan kategori consent
   (dulu bacaan kedua yang galatnya diabaikan — sekarang galat resep menghentikan halaman, lebih
   ketat); sesi tidak dibaca ulang untuk gerbang shift (akun sama); **katalog Barang & Jasa + bekal
   promo hanya dimuat bila ada keranjang yang bisa diubah** (tagihan baru, koreksi yang diizinkan RPC,
   atau panel bayar rombongan ≥2 hewan); perkiraan rombongan hanya dihitung bila ada ≥2 hewan
   (satu-satunya tempat ditampilkan). Gerbang shift, consent rawat inap, racikan tertunda, cek DEMO,
   kelayakan koreksi (RPC) dan semua `unverifiedBilling` tetap di posisi dan urutan lama.

Tidak ada migrasi, tidak ada perubahan action/writer, RLS, consent, stok, atau penyegaran
saldo/draf sesudah simpan. `PembayaranForm`/`RekamForm` tidak disentuh.

## Pengukuran database (PG16 lokal, RLS aktif, fixture fiktif)

Fixture: 3.600 SKU aktif, 1.800 satuan, 2.880 baris stok, 2.500 pemilik, 4.000 hewan,
8.045 kunjungan (45 hari ini), 7.220 rekam medis, 21.660 baris resep, 2 cabang.
Waktu = planning + execution median dari EXPLAIN ANALYZE, peran `authenticated` + JWT fiktif.

| Bacaan | Dengan RLS (DOCTOR/STAFF) | Tanpa RLS (pembanding) | catatan |
|---|---|---|---|
| Middleware: profil / aturan modul / kapabilitas / penempatan / cabang / shift | 0,26–3,3 ms masing-masing | – | murah — biaya nyata = putaran jaringan, bukan query |
| Antrean hari ini (34 baris + embed) | ±17,5 ms | ±2,3 ms | |
| Katalog: `count=exact` / 1 halaman 500 SKU | ±1,1 / ±4,4 ms | – | |
| Detail SKU per batch 200 (stok / satuan / harga cabang) | ±5,8 / 0,9 / 0,7 ms | – | 19 batch × 3 tabel per render form |
| Rekam medis: kunjungan + embed / resep | ±6,4 / ±7,9 ms | – | |
| **Daftar Riwayat Rekam Medis: `count=exact`** | **±5.223 ms** | ±5,2 ms | ±1.000× karena RLS |
| **Daftar Riwayat Rekam Medis: 1 halaman 500 baris** | **±7.711 ms** (OWNER ±9.018 ms) | ±42 ms | halaman memuat SEMUA halaman (maks 10.000) |

Angka run 2 (`pg-reads.json`); run 1 (`pg-reads-run1.json`) selisih <10%. Rencana eksekusi count
riwayat: `riwayat-count-plan.txt` — `user_can_access_branch()` dievaluasi beberapa kali per baris
`visits` (kebijakan SELECT + kebijakan `for all`) dan lagi per baris `medical_records` lewat sub-plan
`visits` (4.886 loop × 2).

**Kesimpulan pengukuran**: untuk Antrean, Rekam Medis, Pembayaran, OBAT KHUSUS biaya per query
di database kecil (ms); lambatnya didominasi **jumlah putaran berurutan** — itu yang dipangkas.
Pengecualian: **daftar Riwayat Rekam Medis** (`/klinik/rekam-medis`) mahal di database itu sendiri.

### Temuan belum diperbaiki: daftar Riwayat Rekam Medis
- Halaman membaca **seluruh** kunjungan bertanda rekam medis (sampai 10.000 baris, embed pemilik/
  hewan/cabang/rekam medis/rawat inap), lalu mencari & memotong 50 baris di server.
- Kebijakan RLS `visits_select` & `mr_select` memanggil `user_can_access_branch(branch_id)`
  (plpgsql security definer, membaca profil/kapabilitas/penempatan/header per panggilan) **per baris**,
  dan `mr_select` mengecek `visits` lagi per baris rekam medis. Pada fixture 8.045 kunjungan, satu
  `count` ±5,2 dtk (tanpa RLS 5 ms) dan satu halaman 500 baris ±7,7–9 dtk (tanpa RLS 42 ms) di PG
  lokal; halaman butuh count + ±10 halaman (6 sekaligus) → perkiraan puluhan detik di database
  untuk ukuran ini. Ini **terukur di lokal**, bukan di Production.
- Perbaikan yang benar menyentuh **kebijakan akses (RLS)** atau mengubah halaman jadi pencarian/
  paging di database — dua-duanya bukan "perubahan kecil aman" dan perlu paket tersendiri dengan
  review keamanan (bandingkan advisor `auth_rls_initplan` yang sudah dicatat U07). Tidak dikerjakan.
- Ukuran data Production untuk tabel ini **tidak diketahui** dari sesi ini; dampak nyata perlu dicek.

## Sisa sumber lambat yang diketahui (tidak diubah, alasan)
1. **Rantai katalog bersama** (`loadClinicPaymentMaster`, `loadClinicSkuDetails`,
   `loadClinicCompoundSkus`): halaman katalog 500/putaran → gudang → 19 batch × 3 tabel (6 sekaligus)
   = ±6–7 putaran + ±3.600 SKU dikirim ke peramban. Menentukan sisa kedalaman Rekam Medis form (9),
   Pembayaran baru (11), Pembayaran rawat inap (9), OBAT KHUSUS (7). File ini juga wilayah Agen B
   (tampilan stok) — sengaja tidak disentuh agar tidak bentrok. Usulan: baca stok/satuan/harga per
   gudang/cabang sekali jalan (bukan per batch id), atau pencarian barang di server.
2. **Bekal promo** (`bekalPotonganKlinik`) menunggu katalog selesai hanya untuk id barang; bisa
   dimulai lebih awal bila fungsi dipecah (shared dengan action pembayaran — wilayah Agen C/D).
3. **Bayar & Selesai merender Pembayaran dua kali** (respons action karena `revalidatePath(back)` +
   navigasi ke `?success=bayar`). Kini tiap render 5 putaran, tapi tetap dua kali. Menghilangkannya
   menyentuh action pembayaran (wilayah Agen C/D) dan kesegaran data sesudah simpan — tidak diubah.
4. Ranap tagihan `SimpanBayarForm`: `router.push(href)` lalu `router.refresh()` — berpotensi render
   ganda; belum diukur, tidak diubah.
5. `auth.getUser()` (panggilan ke server Auth) masih 2× per render Rekam Medis (halaman + izin racik)
   dan 1× di layout + 1× di halaman. Mengganti ke verifikasi lokal mengubah semantik sesi — tidak diubah.
6. Middleware & layout kini membaca shift/penempatan secara spekulatif (1 bacaan murah ekstra untuk
   akun non-STAFF/ber-akses-semua). Ditukar dengan 2–4 putaran lebih sedikit per permintaan.

## Yang perlu Andri tunjuk untuk konfirmasi
Mohon Andri (atau kasir/dokter) sebutkan **halaman dan tombol** yang paling terasa lambat, dengan
cabang & jam kira-kira, supaya bisa dicocokkan dengan log `[u07:*]` sesudah rilis:
1. Pembayaran — buka tagihan pasien rawat jalan, dan sesudah tekan **Bayar & Selesai**.
2. Rekam Medis — buka form pemeriksaan pasien baru, dan sesudah **Simpan**.
3. Antrean — buka & saat daftar memperbarui sendiri.
4. Riwayat pasien (dari Antrean) dan **daftar Rekam Medis** (menu Rekam Medis) — terutama bila
   jumlah riwayat sudah besar setelah impor.
5. Rawat Inap — OBAT KHUSUS & tagihan rawat inap.

## Bukti & cara mengulang
- Tes kedalaman (RED di `291bb8c8`, GREEN di branch): `src/components/__tests__/klinik-a-*.test.tsx`.
  `KLINIK_A_REPORT=<file> node node_modules/vitest/vitest.mjs run src/components/__tests__/klinik-a-*.test.tsx`
  menulis rincian per gelombang.
- Harness DB: `KAMO_PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/test-klinik-a-loading-postgres.py --json out.json`
  (±10 menit; jalankan di bawah `flock /opt/data/kamo-heavy-test.lock`).
- Log mesin agen: `/opt/data/klinik-a-evidence/` (red-*.log, green-vitest.log, before/after-*.txt,
  pg-reads*.json/log, tsc.log, eslint.log, vitest-full.log).
