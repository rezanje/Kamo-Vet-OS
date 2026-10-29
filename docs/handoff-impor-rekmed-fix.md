# Serah-terima: tiga perbaikan impor rekam medis (temuan harness PR #328)

Status: **draft PR siap direview (Claude Code, 29 Okt 2026).** Belum merge/deploy, migrasi belum
dipasang di DB mana pun selain Postgres sekali-pakai. Dilanjutkan dari commit Hermes `3be71767`
(branch `hermes/impor-rekmed-fix`), tidak dibuat ulang dari main.

## Dasar & batas (dari Reza, via Wowo)
- Disetujui: implementasi perbaikan K1b, K3 (0/+62), C3b lalu uji ulang fiktif sebelum Andri memeriksa sampel. PR #328 tetap baseline bukti.
- Dilarang: merge/deploy, pasang migrasi produksi, backfill/gabung pelanggan lama, impor pasien produksi, akses Google baru, memutuskan aturan bisnis (minimum digit HP, tanggal, klinis kosong, folder ambigu), koneksi/kredensial Production. Semua tes data fiktif + DB sekali-pakai.

## Yang dikerjakan
1. **K1b (key sama, isi beda)** — Hermes: `visits.legacy_source_hash` + `import_legacy_row_hash()`; RPC
   massal dan per baris hanya `sudah_ada` bila sidik identik; beda isi / tanpa sidik → `ditahan` + alasan.
   App mengirim baris `tercatat` ke DB untuk dibuktikan; folder dengan baris ditahan tidak dicatat selesai.
2. **K3 (0/+62)** — Hermes: `kunciHpIndonesia()` ≡ `public.indonesian_phone_key()`, vektor bersama
   `src/lib/__tests__/fixtures/kunci-hp-indonesia.json`. Data pelanggan lama tidak diubah.
3. **C3b (registrasi vs impor bersamaan)** — Hermes: `customer_identity_lock`, `registrasi_pelanggan_atomik`,
   `customer_pick_by_phone`; registrasi klinik memakai RPC ini.
4. **Claude Code (lanjutan):**
   - Harness PostgreSQL dijalankan untuk pertama kali — langsung lulus tanpa perbaikan kode harness inti.
   - Celah harness ditutup: jalur **per baris** (`import_legacy_medical_record_resolved`, dipakai
     `konfirmasiImporRekamMedis`/`simpanBatchImporRekamMedis`) belum pernah diuji. Ditambah X1–X3
     (paritas sidik per-baris ↔ massal dua arah, dan tolak bentrok di jalur per baris) dan C8
     (key sama, HP beda, bersamaan: B tertahan oleh baris A yang belum commit, lalu `ditahan`, tanpa
     pemilik yatim). `race()` sekarang bisa menunggu jenis kunci `row` selain `advisory`.
   - Migrasi: `import_legacy_source_conflict_reason` di-`revoke` dari `public, anon` (konsisten dengan fungsi lain).

## Temuan review independen: "Coba lagi" di tab yang sama membuang riwayat (diperbaiki)
- **Terbukti** (bug sudah ada di main sejak `0b4bb14`, bukan dari fix ini). `prosesPotongan` di
  `RekamMedisImportForm.tsx` mencatat baris ke pelacak ganda (`saringGandaPotongan`) sebelum dikirim.
  Bila keempat percobaan kirim gagal, "Coba lagi" mengurai ulang potongan yang sama; pelacak menilai
  semua barisnya `salinan`, tidak ada yang dikirim, potongan dianggap selesai, folder dicatat tuntas, dan
  layar menulis "selesai". Reproduksi di tes komponen: 0 dari 3 tersimpan; kasus 150+50: 50 hilang.
- **Perbaikan minimum:** potongan diurai + disaring SEKALI; hasilnya (daftar kiriman + indeks kiriman
  berikutnya) disimpan di antrian tab. Coba lagi melanjutkan dari kiriman yang belum dijawab server, tanpa
  mengurai ulang. Bila tab ditutup, titik simpan per folder tetap membuat folder itu dibaca ulang dari
  awal dengan pelacak baru, dan database membuktikan baris yang sudah tersimpan (`sudah_ada`).
- **Tes regresi** `src/components/__tests__/medical-import-retry-resume.test.tsx` (gagal 3/3 di kode lama,
  lulus 3/3 sesudah perbaikan):
  1. 4 percobaan gagal sebelum commit → Coba lagi mengirim ulang dan menyimpan semua baris; folder tidak
     tercatat selesai selama gagal.
  2. kiriman 150 baris sukses, kiriman berikutnya gagal 4× → Coba lagi hanya mengirim 50 sisanya; 150
     pertama tidak dikirim lagi; total 200 tersimpan, 0 sudah ada.
  3. server sudah commit tetapi jawabannya hilang → dikirim ulang, dijawab `sudah_ada`, tidak ganda.
- Sisa kecil (tampilan, bukan kehilangan data): di "Simpan keputusan identitas", bila kiriman pertama
  sukses lalu kiriman berikutnya gagal, hitungan "tersimpan" kiriman pertama tidak ditampilkan; saat
  dicoba lagi baris itu dijawab "sudah ada" oleh database.

## Temuan review independen #2: jejak sumber dari folder "08.." vs "+62.." (TERBUKTI, BELUM DIUBAH)
- `identityFromPath` (`src/lib/impor-rekam-medis.ts`) hanya membuang non-digit dari nomor di nama folder,
  dan `sourceKey` memakai digit itu apa adanya. Kartu yang sama, diimpor di dua sesi terpisah dari folder
  `Fiktif Satu - 08000000011` lalu `Fiktif Satu - +62 800-0000-011`, menghasilkan jejak
  `fiktif satu::08000000011::…` dan `fiktif satu::628000000011::…`. Database hanya membandingkan sidik isi
  bila jejaknya sama, jadi kartu kedua **tersimpan lagi**.
- Bukti parser → RPC: `src/lib/__tests__/impor-rekam-medis-varian-hp-folder.test.ts` memastikan fixture
  `src/lib/__tests__/fixtures/impor-folder-hp-varian.json` = keluaran parser sungguhan dari xlsx fiktif;
  harness kasus **S1 (massal) dan S2 (per baris) FAIL**: 2 kunjungan, 1 pelanggan, 1 anabul — riwayat
  medis tercatat ganda pada pasien yang sama. Dalam SATU sesi impor, penyaring ganda tab sudah memakai HP
  kanonik, jadi ganda hanya terjadi lintas sesi.
- Harness sengaja dibiarkan FAIL di S1/S2 (harapan = perilaku benar; kegagalan = temuan terbuka).
- Kontrak jejak sumber TIDAK diubah, tidak ada backfill. Usulan minimum yang kompatibel (pilih satu):
  - **A (disarankan):** di RPC, sebelum membuat kunjungan baru, cari kunjungan impor milik pemilik+anabul
    yang sama dengan `legacy_source_hash` IDENTIK (sidik sudah memakai HP kanonik, nama, pasien, tanggal,
    isi klinis) → jawab `sudah_ada`. Jejak lama/baru tidak berubah; satu indeks parsial baru pada
    `visits(legacy_source_hash)`; pencarian dilakukan di bawah kunci identitas yang sudah ada. Konsisten
    dengan aturan penyaring ganda di tab (pemilik+HP+pasien+tanggal sama dan isi identik = salinan).
    Konsekuensi: dua kartu yang benar-benar identik isi dan tanggalnya untuk pasien yang sama dianggap satu.
  - **B:** jejak sumber baru memakai HP kanonik (`kunciHpIndonesia`). Satu baris kode, tetapi MENGUBAH
    kontrak jejak: kartu dari folder "+62.." yang sudah pernah diimpor akan mendapat jejak baru dan ganda
    bila diimpor ulang. Aman hanya bila Production masih 0 kunjungan impor saat dipasang (pra-cek 29 Okt: 0).
  - **C:** RPC menerima `source_key_aliases` (varian kanonik) dan menganggap jejak alias yang sudah ada
    sebagai jejak sama (tetap dengan bukti sidik). Kompatibel penuh, tetapi lebih banyak kode SQL + app.

## Temuan review independen #3: titik simpan melewati folder yang isinya berubah (diperbaiki)
- `tandaRuangImpor` hanya memakai akar + jumlah folder + jumlah berkas + total byte. Bila kartu di folder
  yang sudah tercatat selesai diedit setelah impor terputus dan ukurannya sama, folder itu dilewati tanpa
  dibaca, sehingga editan tidak pernah sampai ke pemeriksaan sidik/bentrok di database.
- Perbaikan minimum (deteksi sumber berubah): sumber lokal mencatat waktu ubah tiap berkas (`diubah`),
  dan tanda ruang memuat sidik (jalur, ukuran, waktu ubah) semua berkas. Satu berkas berubah → tanda beda →
  titik simpan lama tidak dipakai → semua folder dibaca ulang; database menjawab `sudah_ada` untuk yang
  sama dan menahan yang bentrok. Format titik simpan tidak berubah; titik simpan lama cukup tidak terpakai.
- Tes: `src/components/__tests__/medical-import-checkpoint-changed-source.test.tsx` (kartu A diedit, isi
  beda panjang sama, waktu ubah beda → wajib dikirim ulang; folder tak berubah tetap dilewati) dan unit
  `tandaRuangImpor` di `impor-rekam-medis-aliran.test.ts`. Gagal di kode lama, lulus sesudahnya.
  Tes lama "melewati folder yang sudah selesai" kini menghitung tanda dari berkas yang sama (bukan string
  tetap), maksud tesnya tidak berubah.
- Sisa: berkas yang isinya berubah tetapi ukuran DAN waktu ubahnya sama persis (alat yang memalsukan
  waktu ubah) tetap tidak terdeteksi. Sumber Google Drive nanti wajib mengisi `diubah`.

## Hasil tes (head draft PR)
- Harness `scripts/test-impor-rekam-medis-postgres.py --pg-bin <dir>`: **33 PASS, 2 FAIL (S1/S2 =
  temuan #2 terbuka), 0 BLOCKED** di PostgreSQL 17.10 dan 16.15. Semua kasus lain (P/R/U/K/X/N/A/C1–C8/Z)
  lulus stabil. 319 migrasi repo teraplikasi.
- Uji mutasi (fix sengaja dirusak sementara, lalu dipulihkan): tanpa kunci identitas di registrasi →
  C3/C4/C6 FAIL; tanpa cek sidik per baris → X3 FAIL. Harness memang menangkap regresi.
- `npm test` penuh: 605 berkas / 4655 tes lulus (1 di-skip, sudah ada sebelumnya).
- `npm run lint`: 0 error (14 warning `<img>` yang sudah ada, bukan di berkas yang diubah).
- `npx tsc --noEmit` (heap 4 GB): lulus.
- `npm run build` (heap 6 GB): lulus. Dengan heap bawaan mesin uji (≈2 GB) build kehabisan memori —
  kondisi mesin, bukan kode; `Technical checks` di GitHub yang menjadi acuan.
- Cara menjalankan PG17 tanpa Docker: biner `@embedded-postgres/linux-x64@17.10.0-beta.17` (npm) disalin
  ke dir yang bisa dibaca user `postgres`, lalu `--pg-bin <dir>/bin`.

## Review migrasi — catatan
- Urutan kunci: impor massal mengambil semua kunci identitas terurut sebelum baris pertama; registrasi
  hanya satu kunci → tidak ada siklus (C7 lulus). Sisa kasus teoretis: dua impor bersamaan yang membawa
  **jejak sumber sama dengan HP berbeda dalam urutan terbalik** bisa saling tunggu di indeks unik;
  Postgres memutus salah satu (deadlock terdeteksi), baris korban `ditahan` dengan alasan, tidak ada data
  hilang/ganda. Tidak ditangani khusus karena sangat jarang dan aman-gagal.
- Sidik tanggal: aplikasi selalu mengirim `YYYY-MM-DDT00:00:00+07:00` di kedua jalur, jadi tidak
  bergantung zona waktu sesi.
- Hak akses: fungsi kunci HP baru di-`revoke` dari `anon`. Probe: insert pelanggan oleh peran selain
  `authenticated`/`service_role` memang sudah gagal sebelumnya karena `quest_customer_phone_key`, jadi
  tidak ada jalur baru yang rusak.
- `customer_pick_by_phone` memakai RLS pemanggil; kebijakan `customers_read` untuk `authenticated` adalah
  baca semua, jadi STAF melihat semua kandidat (N2/C3/C6 lulus sebagai STAF).

## Perubahan perilaku yang perlu diketahui pemilik
- Registrasi klinik **menolak** nomor HP yang terdaftar pada beberapa pelanggan (dan tidak ada yang
  tulisannya persis sama), dengan pesan "minta admin memeriksa data pelanggan". Dulu sistem diam-diam
  membuat kartu baru lagi. Layar cari-HP di registrasi tampil kosong untuk nomor seperti ini.
  Jumlah nomor seperti ini di Production **belum diketahui** (tidak ada akses Production).

## Celah Kasir / CRM / impor pelanggan — dilaporkan, BELUM dikerjakan (di luar scope)
Jalur pembuat pelanggan lain belum memakai kunci identitas dan kunci HP kanonik:

| Jalur | Celah |
|---|---|
| `src/app/kasir/actions.ts` `tambahCustomerKasir` | cek `eq("phone")` persis: `08..` vs `+62..` lolos → kartu ganda; cek-lalu-insert tanpa kunci → bisa ganda bila bersamaan dengan impor/registrasi; bila sudah ada >1 kartu dengan nomor persis sama, `maybeSingle()` gagal diam-diam → kartu ketiga dibuat. |
| `src/app/(app)/crm/pelanggan/baru/actions.ts` `simpanPelanggan` | sama persis dengan Kasir. |
| `src/app/(app)/pengaturan/impor/actions.ts` (impor CSV pelanggan) | normalisasi sendiri (`normalTelp`, tanpa batas panjang, `8xx` → `08xx`) dan pemeriksaan set di aplikasi tanpa kunci; tidak bentrok dengan impor rekam medis secara atomik. |

**Tidak ada proteksi global.** Kunci identitas di PR ini hanya melindungi impor rekam medis ↔ registrasi
klinik. Kasir dan CRM tidak mengambil kunci itu dan tidak memakai HP kanonik, jadi selama Kasir/CRM belum
diubah, kartu ganda tetap mungkin lewat jalur itu (nomor 08 vs +62, atau bersamaan dengan impor/registrasi).

Usulan perubahan minimum (satu PR terpisah, perlu persetujuan):
1. Satu RPC `tambah_pelanggan_atomik(nama, hp, …kolom tambahan)` di migrasi baru: ambil
   `customer_identity_lock(hp)`, panggil `customer_pick_by_phone`; bila `one`/`ambiguous` → tolak
   "No HP sudah terdaftar" (perilaku Kasir/CRM sekarang memang menolak, bukan memakai ulang); bila `none` → insert.
2. Ganti blok cek+insert di Kasir dan CRM dengan RPC itu (±10 baris per berkas), tambah kasus harness
   untuk Kasir/CRM bersamaan dengan impor.
3. Impor CSV pelanggan dibiarkan dulu (beda aturan `8xx` adalah keputusan bisnis); cukup dicatat.

Catatan lain: ada tiga normalisasi HP berbeda (`indonesian_phone_key`, `quest_customer_phone_key`,
`normalTelp`). Menyatukannya menyentuh aturan bisnis (nomor `8xx` tanpa 0, minimum digit) → keputusan pemilik.

## Sisa hambatan
- Migrasi belum dipasang di Production (butuh persetujuan teks persis migrasi).
- `Technical checks` GitHub di head final dicatat di PR.
- Simulasi/UAT pengguna (Andri memeriksa sampel) belum dilakukan.
