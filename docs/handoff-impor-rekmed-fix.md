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
- Harness sengaja dibiarkan FAIL untuk temuan ini (harapan = perilaku benar; kegagalan = temuan terbuka).
- **Tidak ada klaim soal isi Production.** Pra-cek "0 kunjungan impor" dari 29 Okt adalah catatan lama
  Hermes, tidak dicek ulang; rancangan di bawah tidak bergantung padanya.

### Kriteria terima (harness, berlaku untuk opsi apa pun)
| Kasus | Harapan | Kode PR sekarang |
|---|---|---|
| S1/S2 | kartu dari folder `08..` lalu `+62..` (massal / per baris): tidak menambah kunjungan | FAIL (2 kunjungan) |
| S3 | arah sebaliknya, `+62..` lalu `08..`: tidak menambah kunjungan | FAIL |
| S4 | jejak varian HP + isi diubah: `ditahan` bentrok, tidak menimpa, tidak menambah | FAIL (tersimpan) |
| S5 | riwayat lama `+62..` tanpa sidik, lalu impor `08..`: `ditahan`, tidak menambah | FAIL |
| S6 | kartu berbeda (tab lain) yang isinya kebetulan identik, pemilik+anabul sama: tetap 2 kunjungan | PASS |
| C9 | `08..` dan `+62..` diimpor BERSAMAAN (massal): 1 kunjungan | FAIL |
| C10 | sama, jalur per baris: 1 kunjungan | FAIL |

S6 sengaja menolak opsi A (A akan menggabungkan dua kartu berbeda yang isinya identik). Opsi A tidak
dijalankan tanpa keputusan.

### Rincian opsi C (disarankan) — BELUM diimplementasikan di PR
Prototipe: `docs/usulan/impor-jejak-setara-opsi-c.prototipe.sql` (bukan migrasi; hanya dipasang sementara
di Postgres sekali-pakai). Hasil: **41/41 PASS** di PG 17.10, termasuk S1–S6, C9, C10, dan semua kasus
lama. Uji mutasi: tanpa memindahkan kunci ke sebelum pencarian (lihat "Kunci") → C10 FAIL; jadi urutan
kunci itu wajib, bukan hiasan.

Apa yang TIDAK berubah: jejak tersimpan (`visits.legacy_source_key`) tetap teks mentah apa adanya; jejak
baru juga tetap format lama (parser tidak diubah); indeks unik jejak tetap; tidak ada backfill, UPDATE, DELETE,
atau penggabungan; sidik isi tetap sama; tidak ada perubahan aplikasi yang wajib.

Bagian database yang berubah:
1. Fungsi baru `import_legacy_source_key_canonical(jejak)` (SQL, IMMUTABLE, `search_path=''`): bila jejak
   bergaya folder (tepat 4 bagian `pemilik::digitHP::pasien::tab`, bagian ke-2 digit saja), bagian HP diganti
   `indonesian_phone_key`; selain itu jejak dikembalikan apa adanya. Bagian nama/pasien/tab tidak bisa
   memuat `::` (parser membuang `.` dan `:`), jadi pemisahan aman. Jejak cadangan `berkas::tab` (kartu di
   luar folder pemilik) tidak punya bagian HP → hanya cocok persis seperti sekarang.
2. Indeks ekspresi baru, **tidak unik**, parsial `where legacy_source_key is not null` pada
   `visits(import_legacy_source_key_canonical(legacy_source_key))`. Tidak unik karena data lama mungkin
   sudah memuat dua varian; unik akan memaksa backfill/penggabungan. Dibangun dalam transaksi migrasi →
   menahan tulis ke `visits` selama pembangunan; lamanya bergantung ukuran tabel di Production (tidak kami
   ketahui). Alternatif: `create index concurrently` sebagai langkah terpisah sebelum migrasi fungsi.
3. Fungsi baru `import_legacy_source_match(jejak, sidik, hp)` (plpgsql, STABLE, SECURITY INVOKER):
   cocok persis dulu; bila tidak ada, cari jejak setara — **hanya** bila HP kanonik di jejak = HP kanonik
   baris (jadi kunci identitas HP yang dipegang pemanggil juga melindungi semua varian jejaknya). Urutan
   hasil: sidik identik dulu.
4. Kedua RPC impor (`import_legacy_medical_records_bulk`, `import_legacy_medical_record_resolved`) memakai
   fungsi pencocokan itu di semua titik cari jejak (termasuk jalur pengecualian/balapan massal). Aturan
   tetap: sidik identik → `sudah_ada` (kunjungan lama dikembalikan, tidak ditulis apa pun); ada kecocokan
   tetapi sidik beda → `ditahan` bentrok; kecocokan tanpa sidik → `ditahan` belum terbukti; tidak ada → buat
   baru. Bila data lama punya beberapa varian setara, tidak ada yang digabung: satu yang identik → sudah ada,
   tidak ada yang identik → ditahan.

Kunci (lock):
- Massal: tidak berubah — semua kunci identitas HP diambil terurut di awal; alias hanya dipakai bila HP
  jejak = HP baris, jadi varian `08/62` dari kartu yang sama selalu berbagi kunci yang sudah dipegang.
  Urutan kunci sama → tidak ada deadlock baru (C7 tetap lulus).
- Per baris: `customer_identity_lock(p_phone)` dipindah ke SEBELUM pencarian jejak (sekarang sesudah).
  Tanpa ini dua sesi bisa sama-sama tidak melihat varian lawan (C10 terbukti). Akibat samping: kiriman
  ulang identik menunggu impor lain untuk HP yang sama selesai (benar dan singkat).
- Varian jejak tidak dijaga indeks unik, jadi kebenaran bersamaan bergantung pada kunci HP di atas;
  harness C9/C10 adalah penjaganya.

Keamanan:
- Tidak ada fungsi SECURITY DEFINER baru; pencarian berjalan dengan RLS pemanggil seperti pencarian persis
  sekarang. Gerbang OWNER/ADMIN pada impor tidak berubah.
- `import_legacy_source_key_canonical`: revoke `public, anon`; grant `authenticated, service_role` — WAJIB,
  karena pemeliharaan indeks ekspresi saat insert `visits` berjejak memeriksa hak EXECUTE peran penulis
  (sudah dibuktikan dengan probe pada fungsi kunci HP). Kunjungan klinik biasa (tanpa jejak) tidak
  memanggilnya karena indeks parsial.
- `import_legacy_source_match`: revoke `public, anon`; grant `authenticated`.

Aplikasi: tidak wajib berubah. Opsional: pemindaian identitas (`import_legacy_identity_scan`) ikut
melaporkan jejak setara sebagai "tercatat" supaya hitungan di layar tepat dan baris itu tidak memicu
pertanyaan identitas yang tidak perlu (hasil akhir tetap benar tanpa ini).

Opsi lain sebagai pembanding: **A** menggabungkan kartu berbeda yang isinya identik (gagal S6) — butuh
keputusan bisnis. **B** (jejak baru pakai HP kanonik di parser) mengubah kontrak jejak: kartu yang dulu
tersimpan dengan jejak `62..` akan mendapat jejak baru dan tercatat ganda saat diimpor ulang, kecuali
digabung dengan C; keamanannya bergantung pada isi Production yang tidak kami cek.

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
- **Batas jaminan (dibuktikan, belum diperbaiki):** isi yang berubah dengan ukuran DAN waktu ubah sama
  persis — misalnya disalin/dipulihkan dengan timestamp dipertahankan — **masih melewati titik simpan**.
  Tes `it.fails` "BATAS: …" di berkas tes yang sama membuktikannya (assertion biasa gagal: editan tidak
  dikirim); begitu celah ditutup, tes itu merah dan `.fails` wajib dicabut. Jadi perbaikan #3 TIDAK menjamin
  semua sumber berubah terdeteksi; ia hanya menangkap perubahan yang mengubah ukuran atau waktu ubah.
- Usulan perlakuan minimum aman (belum dikerjakan, pilih satu):
  - **Sidik isi per folder (disarankan):** saat folder tuntas, simpan di titik simpan SHA-256 (Web Crypto)
    dari byte semua berkasnya — byte itu memang sudah dibaca saat impor. Saat dilanjutkan, folder yang
    tercatat selesai dibaca byte-nya lagi dan di-hash (tanpa mengurai, tanpa kirim); dilewati hanya bila
    sidik sama, selain itu diproses ulang dan database yang membuktikan. Biaya: membaca ulang byte folder
    selesai dari disk lokal. Jaminan: perubahan isi apa pun terdeteksi (selain tabrakan SHA-256).
  - **Tanpa lewati:** hapus fitur lewati folder selesai; semua folder diurai dan dikirim ulang, database
    menjawab `sudah_ada`/bentrok. Paling sederhana dan paling kuat, tetapi melanjutkan impor besar jadi
    selama impor dari awal.
- Sumber Google Drive nanti wajib mengisi `diubah` (dan sidik isi bila usulan pertama dipakai).

## Hasil tes (head draft PR)
- Harness `scripts/test-impor-rekam-medis-postgres.py --pg-bin <dir>`: **34 PASS, 7 FAIL, 0 BLOCKED** di
  PostgreSQL 17.10. Ketujuh FAIL = kriteria terima temuan #2 (S1–S5, C9, C10) yang sengaja dibiarkan
  terbuka. Semua kasus lain (P/R/U/K/X/N/A/C1–C8/S6/Z) lulus stabil. Dengan prototipe opsi C dipasang
  sementara: 41/41 PASS. 319 migrasi repo teraplikasi.
- Uji mutasi (fix sengaja dirusak sementara, lalu dipulihkan): tanpa kunci identitas di registrasi →
  C3/C4/C6 FAIL; tanpa cek sidik per baris → X3 FAIL. Harness memang menangkap regresi.
- `npm test` penuh: 605 berkas / 4655 tes lulus + 1 `it.fails` (batas titik simpan) (1 di-skip lama).
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
