# Serah-terima: tiga perbaikan impor rekam medis (temuan harness PR #328)

Status: **draft PR siap direview (Claude Code, 29 Okt 2026).** Belum merge/deploy, kedua migrasi
(`20261101090000`, `20261101100000`) belum dipasang di DB mana pun selain Postgres sekali-pakai. Dilanjutkan dari commit Hermes `3be71767`
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

## Temuan review independen #2: jejak sumber dari folder "08.." vs "+62.." (DIPERBAIKI, opsi C)
- **Masalah (terbukti):** `identityFromPath` (`src/lib/impor-rekam-medis.ts`) hanya membuang non-digit dari
  nomor di nama folder, dan `sourceKey` memakai digit itu apa adanya. Kartu yang sama, diimpor di dua sesi
  dari folder `Fiktif Satu - 08000000011` lalu `Fiktif Satu - +62 800-0000-011`, mendapat jejak
  `fiktif satu::08000000011::…` dan `fiktif satu::628000000011::…`; sidik isi hanya dibandingkan untuk
  jejak yang sama, jadi kartu kedua tersimpan lagi (2 kunjungan, 1 pelanggan, 1 anabul).
- **Keputusan koordinasi:** opsi C. Opsi A (menyatukan kartu berbeda yang isinya identik) dan B (format jejak
  baru, bergantung data historis kosong) ditolak. Tidak ada klaim/pengecekan isi Production.
- **Implementasi:** migrasi baru `supabase/migrations/20261101100000_impor_jejak_setara.sql` (draft, belum
  dipasang di mana pun selain Postgres sekali-pakai). Parser dan aplikasi TIDAK diubah; jejak tersimpan dan
  jejak baru tetap teks mentahnya; tidak ada backfill, UPDATE, DELETE, atau penggabungan pelanggan/kunjungan.

### Asumsi struktur jejak (eksplisit)
Dari `rowFromCard`:
1. Jejak **berstruktur** = tepat 4 bagian dipisah `::` —
   `kunciTeks(pemilik) :: digit HP folder :: kunciTeks(pasien/nama berkas) :: kunciTeks(nama tab)`.
   `kunciTeks` membuang `.` dan `:`, jadi bagian 1, 3, 4 tidak pernah memuat `::`; bagian 2 hanya digit.
2. Jejak **cadangan** `nama berkas::nama tab` (kartu di luar folder pemilik) = 2 bagian, tidak pernah
   dianggap setara dengan jejak lain; tetap hanya cocok persis.
3. Dua jejak berstruktur **setara** bila bagian 1, 3, 4 sama persis dan bagian 2 sama menurut
   `indonesian_phone_key` (08.. / 62.. / 0062..). Pemilik, pasien/berkas, atau tab berbeda = kartu sumber
   berbeda, walau isinya identik → tidak digabung.
4. Varian hanya dicari bila HP kanonik di jejak = HP kanonik baris yang dikirim (parser selalu mengisi HP
   baris dari folder yang sama). Kunci identitas HP yang dipegang pemanggil karena itu melindungi semua
   varian jejaknya. Baris yang tidak memenuhi ini hanya dicocokkan persis.
5. Risiko sisa yang diterima: nama berkas yang memuat `::` (mustahil di Windows) dengan bagian kedua berupa
   digit bisa terbaca berstruktur; itu pun hanya setara dengan jejak yang sama persis selain nomor HP.

### Aturan hasil
| Kecocokan riwayat (persis + setara) | Hasil | Menulis? |
|---|---|---|
| tidak ada | dibuat baru | ya |
| tepat 1, sidik identik | `sudah_ada` (kunjungan lama dikembalikan) | tidak |
| tepat 1, sidik beda | `ditahan` — bentrok | tidak |
| tepat 1, tanpa sidik (riwayat lama) | `ditahan` — belum terbukti | tidak |
| **lebih dari 1** (data lama sudah ganda) | `ditahan` — "jejak sumber ganda di riwayat lama", **gagal tertutup** | tidak |

### Bagian database yang berubah
1. `import_legacy_source_key_canonical(jejak)` — SQL, IMMUTABLE, `search_path=''`. Bagian HP jejak berstruktur
   dikanonikkan; selain itu dikembalikan apa adanya. Hanya untuk mencocokkan.
2. Indeks ekspresi **tidak unik**, parsial `where legacy_source_key is not null`:
   `visits_legacy_source_key_canonical_idx`. Tidak unik supaya data lama yang mungkin sudah memuat dua varian
   tidak memaksa backfill/penggabungan. Dibangun di dalam transaksi migrasi → menahan tulis ke `visits`
   selama pembangunan (lamanya bergantung ukuran tabel; tidak kami cek).
3. `import_legacy_source_match(jejak, hp)` — plpgsql, STABLE, SECURITY INVOKER: semua kunjungan yang cocok
   (setara bila berstruktur & HP sama, selain itu persis).
4. `import_legacy_source_ambiguous_reason()` — teks alasan gagal tertutup.
5. `import_legacy_medical_records_bulk` dan `import_legacy_medical_record_resolved` diganti (`create or
   replace`): kedua titik cari jejak di massal (biasa + jalur pengecualian/balapan) dan titik cari di per
   baris memakai fungsi pencocokan + aturan di atas. Pra-cek gagal tertutup bila fungsi yang ditimpa bukan
   versi `20261101090000`; pasca-cek memastikan bentuk kanonik, hitungan pemakaian pencocokan di massal,
   aturan `> 1`, dan urutan kunci di per baris.

### Kunci (lock)
- **Massal:** tidak berubah — semua kunci identitas HP diambil terurut di awal. Karena varian hanya dicari
  bila HP jejak = HP baris, varian 08/62 kartu yang sama selalu berbagi kunci yang sudah dipegang. Urutan
  kunci sama → tidak ada deadlock baru (C7 lulus).
- **Per baris:** `customer_identity_lock(p_phone)` sekarang diambil **sebelum** mencari jejak (dulu sesudah).
  Varian jejak tidak dijaga indeks unik, jadi tanpa ini dua sesi bisa sama-sama tidak melihat varian lawan.
  Akibat samping: kiriman ulang identik menunggu impor lain untuk HP yang sama selesai.

### Keamanan
- Tidak ada fungsi SECURITY DEFINER baru; pencarian berjalan dengan RLS pemanggil, sama seperti pencarian
  persis sebelumnya. Gerbang OWNER/ADMIN pada impor tidak berubah.
- `import_legacy_source_key_canonical`: revoke `public, anon`; grant `authenticated, service_role` — wajib,
  karena pemeliharaan indeks ekspresi saat insert `visits` berjejak memeriksa hak EXECUTE peran penulis.
  Kunjungan klinik biasa (tanpa jejak) tidak menghitungnya karena indeks parsial.
- `import_legacy_source_match`, `import_legacy_source_ambiguous_reason`: revoke `public, anon`; grant `authenticated`.

### Bukti (harness, data fiktif, PG 17.10 + 16.15: 49/49 PASS)
Baris S = keluaran parser sungguhan (`src/lib/__tests__/impor-rekam-medis-varian-hp-folder.test.ts` menjaga
fixture `impor-folder-hp-varian.json` tetap sama dengan parser).
| Kasus | Skenario | Jalur |
|---|---|---|
| S1–S4 | riwayat ada 08 → impor +62, dan riwayat ada +62 → impor 08; isi sama: tidak ada kunjungan baru, kunjungan lama dikembalikan | massal + per baris |
| S5–S6 | varian + isi diubah: ditahan bentrok, tidak ada yang ditulis | massal + per baris |
| S7–S8 | riwayat lama +62 tanpa sidik → impor 08: ditahan belum terbukti | massal + per baris |
| S9–S12 | sudah ada DUA riwayat (08 dan +62) → impor jejak 08 persis atau varian 0062: gagal tertutup, tidak memilih, tidak menulis | massal + per baris |
| S13–S14 | kartu sumber berbeda (tab lain, folder +62) dengan isi identik: tetap kunjungan terpisah | massal + per baris |
| C9–C10 | 08 dan +62 diimpor bersamaan: 1 kunjungan | massal + per baris |

Uji mutasi (migrasi dirusak sementara, pasca-cek dimatikan khusus mutan, lalu dipulihkan):
tanpa pencarian setara → 14 FAIL (S1–S12, C9, C10); memilih kecocokan pertama → S9–S12 FAIL; kunci per
baris sesudah pencarian → C10 FAIL. Dengan pasca-cek aktif, mutan urutan kunci ditolak saat migrasi.

Batas yang tersisa: tampilan aplikasi. Pemindaian identitas di aplikasi masih mencocokkan jejak secara
persis, jadi kartu varian dihitung "baru" sebelum dikirim; database tetap menjawab `sudah_ada`/`ditahan`
dengan benar, dan di jalur per baris pesan "N riwayat baru berhasil disimpan" bisa ikut menghitung kartu yang
ternyata sudah ada. Data benar; hitungan layar bisa lebih besar.

## Temuan review independen #3: titik simpan melewati folder yang isinya berubah (DIPERBAIKI, berbasis isi)
- **Masalah:** folder yang tercatat selesai dilewati tanpa dibaca. Tanda ruang awal hanya memakai akar +
  jumlah folder + jumlah berkas + total byte; tambahan waktu ubah (commit `5754eeef`) tetap tidak cukup:
  isi yang berubah dengan ukuran DAN waktu ubah sama (mis. disalin dengan timestamp dipertahankan) terbukti
  masih dilewati (tes `it.fails` di commit `473cc6b7`).
- **Perbaikan:** titik simpan v2 menyimpan, untuk tiap folder tuntas, **SHA-256 isi** semua berkasnya —
  dihitung dari byte yang benar-benar diurai dan dikirim. Saat dilanjutkan, folder tercatat dibaca ulang
  byte-nya dan di-hash (tanpa mengurai, tanpa mengirim); hanya folder yang sidik isinya SAMA PERSIS yang
  dilewati. Folder lain diproses ulang dan database membuktikan: kartu identik `sudah_ada`, kartu berubah
  `ditahan` bentrok (idempoten). Metadata (ukuran, waktu ubah) tidak lagi dipercaya untuk melewati folder.
- Catatan titik simpan lama (v1, hanya nama folder) tidak dibaca → semua folder diproses ulang sekali (aman).
  Browser tanpa Web Crypto (konteks tidak aman) → tidak ada sidik → tidak ada folder yang dilewati (aman, lebih
  lambat). Folder dengan riwayat ditahan/menunggu keputusan tetap tidak dicatat selesai.
- Tes (gagal di kode lama/mutan, lulus sekarang): komponen "isi berubah dengan ukuran DAN waktu ubah sama tetap
  dibaca dan dikirim ulang" (dulu `it.fails`), folder tak berubah tetap dilewati, unit `buktikanFolderSelesai`
  (isi beda panjang sama → tidak terbukti; folder tanpa catatan tidak dibaca), `sidikIsiFolder` (jalur ikut,
  berkas tanpa sidik → null), bentuk v1 ditolak. Mutan "percayai catatan tanpa membandingkan sidik" → 2 FAIL.
- **Batas jaminan:** deteksi berbasis isi SHA-256 (tabrakan diabaikan). Biaya: saat melanjutkan, byte folder
  yang tercatat selesai dibaca ulang dari disk sebelum impor jalan (tanpa indikator khusus di layar). Coba lagi
  di tab yang SAMA tidak membaca ulang folder yang sudah tuntas di sesi itu — folder itu sudah diimpor dari
  byte yang di-hash; editan sesudahnya diperlakukan seperti editan setelah impor (terdeteksi saat diimpor ulang).
- Tes komponen impor kini menunggu sampai impor berhenti (selesai/Coba lagi) dengan batas waktu, bukan
  jumlah putaran tetap, karena SHA-256 berjalan di luar antrean mikro.

## Hasil tes (head draft PR)
- Harness `scripts/test-impor-rekam-medis-postgres.py --pg-bin <dir>`: **49/49 PASS, 0 FAIL, 0 BLOCKED** di
  PostgreSQL 17.10 (2×) dan 16.15; 320 migrasi repo teraplikasi.
- Uji mutasi (fix sengaja dirusak sementara, lalu dipulihkan): tanpa kunci identitas di registrasi →
  C3/C4/C6 FAIL; tanpa cek sidik per baris → X3 FAIL. Harness memang menangkap regresi.
- `npm test` penuh: 605 berkas / 4658 tes lulus (1 di-skip lama). Tes impor terarah 3× berturut-turut stabil.
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

## Kasir / CRM — DITUTUP di PR dependent (draft), impor CSV pelanggan dilaporkan
Keputusan koordinasi: tutup jalur pembuatan pelanggan yang melewati kunci identitas dalam kode, minimal, tanpa
mengubah aturan bisnis. Dikerjakan di cabang `claude/relaxed-pascal-g1kbka-kasir-crm` (PR dependent, base = cabang
PR #333).

Perilaku lama (diperiksa sebelum diubah):
| Jalur | Validasi | Cek duplikat | Bila sudah ada | Insert |
|---|---|---|---|---|
| Kasir `tambahCustomerKasir` | nama+HP wajib, `nomorHpValid` | `eq("phone")` persis, `maybeSingle()` | tolak "No HP sudah terdaftar" | name, phone, email, dob, address, pekerjaan, sumber_info, catatan → kembalikan baris |
| CRM `simpanPelanggan` | sama | sama | tolak (redirect pesan sama) | + npwp → redirect daftar |

Perubahan minimal:
- Migrasi draft `20261101110000_pelanggan_baru_atomik.sql`: `pelanggan_baru_atomik(...)` SECURITY INVOKER (RLS & hak
  insert pemanggil tetap; revoke `public, anon`; grant `authenticated`), ambil `customer_identity_lock(HP)` lalu
  `customer_pick_by_phone`; ada ≥1 pelanggan dengan HP kanonik sama → `{status:"terdaftar"}`; selain itu insert nilai
  APA ADANYA (tanpa merapikan) → `{status:"dibuat", customer_id}`. Pra-cek (butuh migrasi 0900) & pasca-cek (kunci
  sebelum cek, bukan SECURITY DEFINER) gagal tertutup.
- Kasir/CRM memanggil RPC itu menggantikan blok cek+insert. Validasi di depan, pesan, kolom, dan alur sesudahnya sama;
  Kasir membaca baris pelanggan baru dengan `select` kolom yang sama seperti dulu.
- Tidak menyentuh kebutuhan pet, cabang, peran, flow pelanggan, atau hak akses.
- Kasir: bila RPC sudah menyimpan tetapi membaca baris pelanggan sesudahnya gagal, pesan kini menyatakan pelanggan
  sudah tersimpan dan meminta mencari lalu memilihnya (dulu galat mentah seolah gagal simpan, lalu tambah ulang
  ditolak "No HP sudah terdaftar"). CRM tidak membaca ulang, jadi tidak terkena. Tes regresi di tes aksi.

Konsekuensi yang perlu diketahui (akibat kunci HP kanonik, bukan aturan baru): nomor sama dengan tulisan berbeda
(08/+62/tanda hubung) kini ditolak; nomor yang sudah dipakai >1 kartu ditolak (dulu `maybeSingle()` diam-diam membuat
kartu baru).

Bukti: tes aksi `src/lib/__tests__/pelanggan-baru-atomik-action.test.ts` (8 lulus; 7 gagal di kode lama), harness
B1–B7 dan C11–C15 (61/61 PG 17.10 + 16.15). Mutan: tanpa kunci → C11–C15 FAIL; cek nomor persis → B2–B4, C11, C12,
C14 FAIL.

**Jalur yang masih melewati kunci — dilaporkan, tidak diubah:** impor CSV pelanggan (Pengaturan → Impor,
OWNER/ADMIN). Menutupnya butuh keputusan kebijakan yang tidak bisa dihindari: normalisasi `normalTelp` (nomor `8xx`
dianggap `08xx`, `0062..` tidak dikonversi, tanpa batas panjang) berbeda dari `indonesian_phone_key`, dan perlu
diputuskan apakah satu baris bentrok membatalkan seluruh berkas atau hanya baris itu. Sampai diputuskan: jangan
dijalankan bersamaan dengan impor rekam medis.

Catatan lain: ada tiga normalisasi HP berbeda (`indonesian_phone_key`, `quest_customer_phone_key`, `normalTelp`).
Menyatukannya menyentuh aturan bisnis (nomor `8xx` tanpa 0, minimum digit) → keputusan pemilik.

## Sisa hambatan
- Ketiga migrasi (`20261101090000`, `20261101100000`, `20261101110000`) belum dipasang di Production.
- `Technical checks` GitHub di head final dicatat di PR.
- Verifikasi pengguna lapangan opsional (bukan syarat teknis); impor pasien nyata tetap izin terpisah.
