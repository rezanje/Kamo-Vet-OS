# Migrasi kartu medis dari master ternormalisasi — audit kontrak + rencana

Status: checkpoint 1 (ac2277fd) sudah direview. **§9 "Koreksi review" berlaku dan menggantikan bagian yang bertentangan.**
Implementasi draft (kode + tes sintetis + dry-run offline bawaan) mengikuti §9.

Batas sesi ini:
- Default baca-saja dan dry-run.
- Tanpa baca/tulis DB produksi baru, migrasi, merge, deploy, preview, perubahan grant/role/keamanan, service-role, SQL mentah,
  Sheet/Drive, maupun data pasien asli.
- Izin rilis RS-2 yang lalu **bukan** izin migrasi data. Apply operasional nanti butuh persetujuan tersendiri.

Basis:
- `main` 7f88f4a8 (dibaca segar 30 Okt 2026). Branch baru `claude/migrasi-kartu-medis`, dibuat dari main itu.
  Branch lama sudah merged lewat PR346 dan tidak dipakai lagi.
- Tidak menyentuh area PR351/352/341, ranap/pembayaran, maupun PR owner lain:
  - PR354 HRIS, PR353 promo, PR352 ranap, PR341 susulan rekam medis (Hermes);
  - PR328 hanya harness tes lama untuk impor; tidak diubah.

Tujuan pengguna: data kartu medis pasien masuk ke app **tanpa klik impor per folder**, cocok, dan rapi.
Arahnya:
- master ternormalisasi yang sudah ditinjau tim, lalu runner backend/lokal yang memakai jalur semantik impor yang sama;
- foto/gambar dikecualikan, tanpa OCR.

---

## 1. Status runtime (sesi ini)

| Komponen | Status |
|---|---|
| Node | v22.22.0 |
| `exceljs` | 4.4.0 (sudah dependensi; membaca tanggal Excel asli sebagai `Date`) |
| `@supabase/supabase-js` | ^2.58 (sudah dependensi) |
| `typescript` | ^5 |
| `vitest` | 4.1.9 |
| `tsx` / `ts-node` | **tidak ada**. Usul: CLI dikompilasi `tsc` ke CommonJS di folder sementara lalu dijalankan `node`; tanpa dependensi baru. Pustaka yang dipakai ulang hanya memakai import relatif (`./kontak`), jadi tidak butuh alias `@/` |
| Postgres sekali pakai | PG16 (`/usr/lib/postgresql/16/bin`) dan PG17 (`/opt/pg17/bin`), untuk harness integrasi |
| Koneksi DB / kredensial | tidak dipakai, tidak diubah. Environment UI "Not connected" tidak disentuh |

Tidak ada blocker untuk tahap kode + tes sintetis. Blocker untuk **apply operasional** nanti: cara runner login
sebagai OWNER/ADMIN asli (§7, keputusan K4).

---

## 2. Audit jalur impor yang ada (fakta dari kode)

### 2.1 Aplikasi (`src/app/(app)/klinik/rekam-medis/impor/actions.ts`)

**Jalur massal `prosesPotonganImporRekamMedis`** (`:481`):
1. `assertBolehImpor` (`:55`): user login, `profiles.role` OWNER/ADMIN. **Tidak** cek `is_active`; database yang menegakkannya.
2. `validasiRows` (`:252`): maksimal 200 baris (`MAKS_BARIS_POTONGAN_REKAM_MEDIS`). Pemeriksaannya:
   - tanggal `YYYY-MM-DD`;
   - identitas wajib (jejak, file, tab, pasien, pemilik, HP).
3. `pindaiIdentitasPotongan` (`:400`) memanggil `import_legacy_identity_scan(source_keys, owner_keys, phone_keys)`.
4. `pilahRiwayatTersimpan` membagi baris menjadi `baru` dan `tercatat`. Baris `tercatat` tetap dikirim, karena hanya DB
   yang bisa membuktikan isinya identik (K1b).
5. Untuk baris `baru`:
   - `identitasPersisRekamMedis` (`src/lib/impor-rekam-medis.ts:195`): pemilik unik menurut kunci nama **dan**
     kunci HP. Anabul unik per pemilik menurut kunci nama; lebih dari satu berarti `null`.
   - `klarifikasiIdentitasRekamMedis` (`:207`): calon menurut nama **atau** HP, dan baris ditahan menunggu keputusan manusia.
6. `simpanMassalRekamMedis` (`:430`): kiriman maksimal 150 baris (`MAKS_BARIS_PER_KIRIMAN`) ke
   `import_legacy_medical_records_bulk({p_rows})`. Jawabannya wajib array dengan panjang sama, berisi status per baris.

**Temuan F1 — `validasiRows` memotong teks diam-diam.** `cleanText(..., max)` memakai `.slice(0, max)`, dengan batas:
- pemilik/pasien 160, HP 40, alamat 1000;
- spesies/ras 100, kelamin 50, dokter 160;
- note 5000, klinis 10000.

Ini bertentangan dengan kontrak "tanpa pemotongan diam-diam". Runner **tidak** akan memakai `validasiRows`; ia memakai
validasi ketat sendiri (§4.4). Perbaikan jalur UI tidak termasuk usulan ini (keputusan K7).

### 2.2 Database (definisi terakhir)

**`import_legacy_identity_scan`** (`20261031210000`): SECURITY INVOKER, `statement_timeout` 30 detik, maksimal 1000 kunci
per larik. Hasilnya:
- `sudah_ada`: hanya kecocokan jejak **persis**, dan terlihat menurut RLS pemanggil. Dengan header cabang aktif, riwayat
  bersama tidak terlihat (F4), tapi tidak berbahaya karena simpan massal mencari ulang lewat `cari_jejak`;
- `customers`: calon menurut kunci nama ATAU kunci HP;
- `pets` milik calon itu.

**`import_legacy_medical_records_bulk(p_rows jsonb)`** (`20261101120000:593`): INVOKER, 30 detik, maksimal 500 baris.
- Cek awal: `is_admin` dan `kamo_import.pastikan_pengimpor()`, yaitu OWNER/ADMIN **aktif** ditambah header cabang
  (bila ada) yang sah.
- Kunci identitas HP diambil terurut supaya bebas deadlock.
- Per baris:
  - `source_key` kosong atau > 500 → `ditahan`;
  - sidik dihitung DB (`import_legacy_row_hash`);
  - `cari_jejak`: terkunci (cabang tak terjangkau) / lebih dari satu kecocokan → `ditahan`;
  - satu kecocokan dengan sidik sama → `sudah_ada`; sidik beda/kosong → `ditahan` (riwayat lama tidak diubah);
  - selain itu `import_legacy_medical_record_resolved` di dalam blok `begin … exception`
    (**subtransaksi per baris**). Bila gagal, dicek ulang dan hasilnya `sudah_ada`/`ditahan`.
- Hasil per baris: `{source_key, status ∈ tersimpan|sudah_ada|ditahan, reason, visit_id}`.
- **Atomisitas:** satu panggilan RPC = satu transaksi PostgREST. Kegagalan level panggilan (timeout, auth, header)
  membatalkan seluruh panggilan itu saja; panggilan sebelumnya tetap ter-commit. Kegagalan per baris hanya membatalkan
  subtransaksi baris itu. Akan dibuktikan di harness (§6).

**`import_legacy_medical_record_resolved`** (INVOKER):
- Mewajibkan tanggal, pemilik, HP, dan pasien. Lalu `customer_identity_lock(phone)` dan `cari_jejak`.
- Pemilik, bila `p_customer_id` tidak diberikan:
  - pemilik persis (kunci nama + kunci HP) lebih dari satu → galat "perlu keputusan";
  - HP sudah dipakai nama lain → galat;
  - selain itu `insert customers(name, phone, address)`.
- Anabul, bila `p_pet_id` tidak diberikan: `lower(btrim(name))` sama → **ambil yang tertua, `limit 1`**, tanpa
  memfilter status (F2). Bila tidak ada → `insert pets(...)`.
- Terakhir `kamo_import.simpan_riwayat_bersama`. Penulis ini:
  - memvalidasi ulang bahwa pemilik adalah kandidat (kunci HP ATAU nama) dan anabul milik pemilik;
  - `insert visits(customer_id, pet_id, poli='Poli Umum', dokter, keluhan = note ?? anamnesis, status='Selesai',
    created_at = record_date, legacy_source_key, legacy_record_no, legacy_source_hash)` dengan `branch_id` NULL (D1);
  - `insert medical_records(visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep = therapy)`;
  - terapi hanya teks: tidak ada `prescription_items`, stok, tagihan, atau sales.

**`import_legacy_row_hash`**: md5 atas larik berisi:
- record_no;
- tanggal WIB;
- kunci nama pemilik, kunci HP (`indonesian_phone_key`), kunci nama pasien;
- alamat, spesies, ras, kelamin, dob, dokter, note, anamnesis, klinis, diagnosis, terapi (di-trim).

Sidik ini **bukan** SHA-256 berkas, dan tidak memuat nama file/tab.

**`import_legacy_source_key_canonical` / `import_legacy_source_match`**: hanya jejak **berstruktur 4 bagian** dengan
bagian ke-2 digit yang disetarakan HP-nya (08/62/0062 → 08), dan hanya bila HP baris sama. Jejak 2 bagian
(`file::sheet`) dicocokkan persis. Jejak tersimpan tidak pernah diubah.

**D2:** `authenticated` tidak bisa INSERT/UPDATE/DELETE riwayat bersama secara langsung. Runner tidak pernah menulis tabel
langsung; semua tulisan lewat RPC di atas.

### 2.3 Batas kolom efektif (skema hasil semua migrasi, PG17 lokal)

| Field payload | Kolom tujuan | Batas efektif DB | Batas action (dipotong) | Batas runner (ditolak bila lebih) |
|---|---|---|---|---|
| owner_name | customers.name `varchar(100) NOT NULL` | 100 | 160 | **100** |
| phone | customers.phone `varchar(30) NOT NULL` | 30 | 40 | **30** |
| address | customers.address `text` | — | 1000 | 1000 |
| patient_name | pets.name `varchar(100) NOT NULL` | 100 | 160 | **100** |
| species / breed | pets.* `varchar(50)` | 50 | 100 | **50** |
| gender | pets.gender `varchar(10)` | 10 | 50 | **10** (teks apa adanya, tanpa enum karangan) |
| dob | pets.dob `date` | — | 10 | tanggal persis atau NULL |
| doctor | visits.dokter `varchar(100)` | 100 | 160 | **100** |
| note | visits.keluhan `text` | — | 5000 | 5000 |
| anamnesis / clinical_findings / diagnosis / therapy | medical_records `text` | — | 10000 | 10000 |
| record_no | visits.legacy_record_no `text` | — | 100 | 100 |
| source_key | visits.legacy_source_key `text` | 500 (RPC) | 500 | 500 |
| source_file / source_sheet | tidak disimpan di DB | — | 255 | 255 |

Catatan:
- Batas action lebih longgar daripada DB. Baris yang lolos action tapi melebihi DB gagal di DB dan berstatus `ditahan`.
- Runner memakai batas yang **paling ketat**. Untuk teks bebas tanpa batas DB, runner memakai batas action.

Kendala lain di skema:
- **Indeks unik:**
  - `pets_nama_unik_per_pemilik` (customer, lower(btrim(name))) hanya untuk `status='Aktif'`;
  - `visits_legacy_source_key_global_unique` (`legacy_source_key` dengan `branch_id` NULL);
  - `visits_legacy_source_key_unique` (branch, key).
- **Trigger** customers/pets: log aktivitas (a01), `guard_customer_imported_at` (Q01), dan audit pindah pemilik anabul.
  Tidak ada yang menulis keuangan atau stok.

### 2.4 Temuan risiko (untuk keputusan, bukan diubah diam-diam)

- **F1** — UI memotong teks diam-diam (§2.1).
- **F2** — `resolved` memilih anabul tertua via `limit 1` tanpa memfilter status bila tidak diberi `p_pet_id`.
  Runner mengirim `pet_id` hasil resolusi bila ada satu kandidat. Bila nol kandidat, runner membiarkan DB membuat
  anabul. Bila lebih dari satu (termasuk anabul nonaktif senama), baris **ditahan sebelum RPC**.
- **F3** — Pelanggan yang dibuat jalur impor rekam medis **tidak** diberi `customers.imported_at`. Aturan Q01
  menganggap kartu dengan `imported_at` NULL sebagai calon "pelanggan baru". Jadi kartu hasil migrasi bisa memberi
  kredit quest staf saat struk berbayar pertamanya.
  - Ini efek samping ke insentif staf, bukan transaksi yang dibuat impor.
  - Jalur UI sekarang sudah begitu.
  - Memperbaikinya butuh perubahan RPC (migrasi DB). Keputusan K8.
- **F4** — `identity_scan.sudah_ada` hanya persis dan mengikuti RLS. Runner tidak menganggapnya bukti; statusnya
  diambil dari jawaban simpan massal.
- **F5** — Action hanya mengecek role, bukan `is_active`. DB menegakkan; runner juga mengecek di awal agar gagal cepat.
- **F6** — Jejak berstruktur setara hanya untuk perbedaan penulisan HP. Ganti nama pemilik/file/tab setelah normalisasi
  menghasilkan **jejak baru**, sehingga runner wajib memakai `source_key` **asli** dari Mapping dan tidak pernah
  menyusunnya ulang.
- **F7** — SHA-256 berkas ≠ sidik baris DB. Keduanya dicatat terpisah dan tidak boleh tertukar.

---

## 3. Arsitektur usulan (perubahan minimal)

```
master.xlsx (ditinjau tim) ──► [baca + kenali kontrak v0] ──► [validasi + gabung ID LOKAL + karantina]
        │                                                           │
        │ SHA-256 berkas                                            ▼
        ▼                                                  rencana (dry-run, 100% rekonsiliasi hitungan)
  buku besar lokal ◄────────────── [eksekutor terbatas] ◄── (izin apply terpisah)
  (tanpa PHI)                         │ identity_scan (baca)   │ bulk ≤150/RPC (tulis via RPC yang sama)
                                      ▼                        ▼
                               [readback pemilik→hewan→kunjungan→MR, isi per field]
```

Modul baru di `src/lib/migrasi-kartu-medis/`. Semuanya murni dan dites vitest, dengan import relatif:
- `kontrak.ts`: definisi kontrak v0, pengenalan header, dan versi.
- `baca-master.ts`: ExcelJS ke baris bertipe, ditambah daftar isu (tanpa I/O lain).
- `rencana.ts`: validasi, gabung ID lokal, karantina, payload, dan rekonsiliasi hitungan.
- `identitas.ts`: memakai ulang `identitasPersisRekamMedis` dan `klarifikasiIdentitasRekamMedis` **apa adanya**
  (fungsi murni yang sudah diekspor), ditambah aturan UUID opsional.
- `eksekutor.ts`: batch, kiriman ulang payload identik, status per baris, readback. Klien RPC di-inject dengan antarmuka
  yang sama dengan `PemindaiRpcClient`.
- `buku-besar.ts`: ledger JSONL lokal yang hanya ditambah (append-only).

CLI: `scripts/migrasi-kartu-medis/cli.ts` ditambah `tsconfig` khusus (dikompilasi `tsc`, CommonJS). Mode:
- `dry-run` (bawaan, tanpa jaringan);
- `cek-identitas` (baca-saja, butuh login);
- `jalankan --rencana <hash>`;
- `lanjutkan`;
- `readback`.

`actions.ts` dan UI **tidak diubah** di tahap ini. Alasannya:
- inti semantik ada di RPC DB (resolusi, sidik, jejak, D1/D2) dan di fungsi identitas yang sudah murni, jadi runner
  memakai keduanya tanpa ekstraksi;
- ekstraksi jalur action menjadi layanan bersama berarti mengubah perilaku UI (termasuk F1), jadi itu keputusan terpisah
  (K7).

Runner **tidak**:
- INSERT tabel langsung;
- memakai service-role;
- mengirim ID lokal sebagai UUID;
- menyusun jejak baru;
- menggabungkan pemilik/anabul otomatis;
- mengarang HP.

---

## 4. Kontrak master v0: pembacaan yang diusulkan

### 4.1 Pengenalan kontrak (bukan koordinat rapuh)

- Sheet dicari menurut **nama persis** `Pemilik`, `Hewan`, `RiwayatMedis`, dan `Mapping`. Sheet lain diabaikan dan
  dilaporkan. `Panduan`/`Validasi` **tidak pernah** dibaca sebagai otorisasi.
- Baris header ditemukan dengan memindai baris 1–15 sampai himpunan label wajib cocok persis setelah normalisasi
  (huruf kecil, spasi/underscore disatukan). Baris 5 hanya ekspektasi v0, bukan asumsi. Kolom diambil dari posisi
  label, bukan huruf kolom.
- Label wajib per sheet:

  | Sheet | Label wajib |
  |---|---|
  | Pemilik | `local_owner_id, name, phone, address, customers.id, review status, reviewer decision` |
  | Hewan | `local_pet_id, local_owner_id, name, species, breed, gender, dob, raw partial dob, pets.id, status, decision` |
  | RiwayatMedis | `local_record_id, local_pet_id, record_date, record_no, doctor, note, anamnesis, clinical_findings, diagnosis, therapy, review status, source_sheet, decision` |
  | Mapping/PER-SHEET | `local_record_id, original filename, original sheet, original source_key, tabdate, celldate, change note, dedupe note` |
  | Mapping/FILE | label FILE provenance (dikunci saat review; K2) |

  Label persisnya ditetapkan bersama tim saat review (K2).
- Ketentuan gagal-tertutup:
  - label wajib hilang atau ganda, atau dua blok header di satu sheet → **gagal seluruh file** (kontrak tidak dikenali);
  - kolom tambahan tidak dikenal → peringatan, dan kolomnya tidak dipakai.
- **Versi kontrak:** wajib ada penanda eksplisit, misalnya sel berlabel `contract_version` di `Mapping` bernilai `v0`.
  Tanpa penanda atau versi tidak dikenal → gagal. Perubahan format = kontrak baru + review mapping (K1).

### 4.2 Otorisasi baris

- Baris hanya ikut bila kolom keputusan bernilai **literal yang disepakati** (K3), di semua tingkat: pemilik, hewan, dan
  riwayat.
- Kosong, rumus, atau teks bebas lain → `dikecualikan: belum disetujui`. Persetujuan tidak pernah ditebak dari
  status/formula/freeform.
- Sel rumus dibaca nilainya, tapi sel rumus di kolom keputusan dianggap **bukan** persetujuan.

### 4.3 Gabung ID lokal

- `local_*_id` adalah teks, dipakai hanya di memori untuk join. Tidak pernah dikirim ke DB dan tidak pernah di-cast ke UUID.
- ID lokal ganda, kosong, atau rujukan ke induk yang tidak ada/dikecualikan → **karantina** dengan alasan, termasuk
  semua anaknya. Tidak ada perbaikan otomatis.
- `customers.id` / `pets.id` opsional:
  - wajib UUID valid;
  - `pets.id` hanya boleh bila induknya punya `customers.id`;
  - dipakai **hanya setelah** `cek-identitas` membuktikan: pelanggan termasuk kandidat (nama ATAU HP, predikat sama
    dengan penulis), anabul milik pelanggan itu, dan tidak ada calon lain yang lebih cocok;
  - bila tidak terbukti → ditahan.

### 4.4 Nilai dan batas

- **Tanggal riwayat:** sel tanggal Excel **asli** → `YYYY-MM-DD` (komponen UTC dari `Date` ExcelJS) →
  `YYYY-MM-DDT00:00:00+07:00`.
  - kosong → dikecualikan ("tanggal belum terselesaikan");
  - sel teks atau angka bukan tanggal → karantina, tanpa menebak format;
  - di luar rentang wajar (sebelum 1990 atau setelah hari run) → karantina.
- **dob:** tanggal asli persis atau NULL. `raw partial DOB` tidak pernah dikirim dan tidak pernah dijadikan tanggal
  (bulan/tahun saja → NULL).
- **HP:** sel **teks** apa adanya (trim spasi tepi saja). Sel angka → karantina, karena nol depan hilang.
  08/+62/0062 hanya untuk mencocokkan (`kunciTeleponImporRekamMedis`); teks asli dikirim. Kurang dari 8 digit →
  karantina, sesuai aturan `kontak.ts`.
- **Batas:** tabel §2.3. Lebih panjang → karantina dengan nama field, **tanpa** pemotongan.
- **Jejak sumber:** `original source_key` dari Mapping PER-SHEET, dicocokkan per `local_record_id`.
  - Kosong, lebih dari 500, atau satu riwayat dengan beberapa baris mapping → karantina.
  - Bentuk dicek: berstruktur (`a::digits::c::d`) atau cadangan (`file::sheet`). Bentuk lain → karantina.
  - Bagian HP jejak berstruktur yang tidak setara dengan HP pemilik → karantina "jejak tidak cocok dengan pemilik",
    tanpa menyusun ulang jejak.
  - Jejak sama dipakai lebih dari satu riwayat (termasuk tabrakan cadangan lintas pemilik) → **semua** baris itu
    dihentikan, tanpa merge atau jejak baru.
- **source_file/source_sheet:** dari Mapping (≤255). Hanya untuk laporan lokal, tidak dikirim ke DB.
- **Riwayat tanpa isi klinis** (doctor, note, anamnesis, klinis, diagnosis, terapi semuanya kosong; misalnya hanya
  foto) → dikecualikan "tanpa isi klinis/foto saja".
- **Template:** pasien atau file yang dikenali template (pola `patientFromFile` yang sama) → dikecualikan.

### 4.5 Payload

Bentuk payload persis kontrak `import_legacy_medical_records_bulk`:
- `source_key, record_no, record_date, owner_name, phone, address, patient_name, species, breed, gender, dob, doctor,
  note, anamnesis, clinical_findings, diagnosis, therapy`;
- `customer_id` dan `pet_id` hanya hasil resolusi terbukti, selain itu `null`.

DTO lokal `warning[]` tidak dikirim. Payload tiap baris **dibekukan**: sidik payload SHA-256 atas JSON kanonik
(kunci terurut) dicatat. Sidik ini bukan sidik DB.

---

## 5. Eksekusi, ledger, pemulihan, readback

**Identitas (baca-saja):**
- `import_legacy_identity_scan` per maksimal 1000 kunci.
- Aturan identitas dari pustaka yang ada. Ambigu → ditahan sebagai "perlu keputusan" dan dikeluarkan ke laporan.
  Tidak ada keputusan otomatis.
- Keputusan manusia untuk baris itu masuk lewat master revisi atau **rencana tertinjau baru**, bukan lewat flag CLI.

**Batch:**
- 150 baris per RPC simpan massal, sama dengan ukuran yang sudah dipakai UI, di bawah batas DB 500 dan timeout 30 detik.
- Berurutan dan satu pekerja. Tidak ada klaim throughput.

**Ledger lokal** (folder di luar repo yang dipilih operator):
- `run.json`: run ID (acak), SHA-256 berkas, versi kontrak, sidik rencana, waktu, peran pemanggil (tanpa email).
- `batch.jsonl`, satu entri per batch:
  - nomor batch dan daftar `{local_record_id, sha256(source_key), sidik_payload}`;
  - status `direncanakan → dikirim → diakui | tidak_pasti | gagal`;
  - jawaban per baris (`status`, kode alasan, `visit_id`).
- **Tanpa PHI:** tanpa nama, HP, isi klinis, atau source_key mentah. Konsol dan log hanya berisi hitungan dan ID lokal.

**Pemulihan:**
- Jaringan putus atau jawaban tidak diterima → batch `tidak_pasti`.
- `lanjutkan` mengirim ulang **payload identik**, dengan jejak yang sama dan tanpa ID baru:
  - baris yang ternyata sudah ter-commit kembali sebagai `sudah_ada` (jejak + sidik sama) dengan `visit_id`;
  - yang belum ter-commit akan tersimpan.
- `lanjutkan` menolak bila SHA-256 berkas, versi kontrak, sidik rencana, atau sidik payload berubah. Perubahan harus
  lewat rencana tertinjau baru.

**Status DB → laporan:**
- `tersimpan` / `sudah_ada` → diakui.
- `ditahan` (sidik beda, jejak ganda, terkunci, identitas, DDL) → laporan ditahan per alasan. Tidak dicoba ulang
  dengan payload lain.

**Readback**, setelah semua batch diakui. Memakai OWNER (K5):
- per hewan: `riwayat_bersama_hewan` (RS-2) membuktikan `visit_id ↔ pet_id ↔ customer_id`, tanggal, dokter, keluhan,
  anamnesis, klinis, diagnosis, dan terapi **per field** sama dengan payload;
- `pets` / `customers` (SELECT biasa) membuktikan nama, HP, spesies, ras, kelamin, dob, dan alamat;
- selisih apa pun → laporan readback gagal. Tidak ada perbaikan otomatis.

**Rekonsiliasi hitungan (dry-run 100%):**
- baris master = siap + dikecualikan (per alasan) + karantina (per alasan);
- setelah eksekusi: siap = tersimpan + sudah_ada + ditahan (per alasan) + perlu_keputusan;
- selisih → gagal.

**Auth:**
- Runner memakai `@supabase/supabase-js` dengan URL + anon key publik dan **sesi user OWNER/ADMIN asli**.
- Header `x-kamo-operational-branch`:
  - dikirim persis seperti app bila `--cabang <uuid>`;
  - tanpa header bila `--semua-cabang`, yang hanya untuk pemegang semua cabang dan divalidasi DB.
- Tidak ada service-role. Bila login/peran/aktif/header ditolak → berhenti sebelum batch pertama.

---

## 6. Rencana tes (data sintetis saja)

**Vitest:** parser kontrak, validasi, rencana, identitas, eksekutor dengan klien palsu, dan ledger.

**Harness integrasi Postgres sekali pakai** (PG16/PG17, semua migrasi repo):
- eksekutor dikompilasi lalu memanggil RPC lewat adaptor `psql`;
- adaptor meniru PostgREST: satu panggilan = satu transaksi, `role authenticated`, klaim JWT, dan header cabang.

| Penerimaan | Bukti |
|---|---|
| Roundtrip teks penuh | Readback field demi field sama; panjang maksimal per field lolos tanpa terpotong |
| Replay → 0 baru | Jalankan ulang file yang sama: semuanya `sudah_ada` dengan `visit_id` yang sama |
| Isi berubah → ditahan | Jejak sama, isi beda: `ditahan` (konflik), riwayat lama tidak berubah |
| Tanggal belum terselesaikan / template / foto saja | Dikecualikan dengan alasan, tidak pernah dikirim |
| Rujukan hilang/invalid/ganda | Karantina beserta anak-anaknya |
| ID LOKAL tidak di-cast | Payload hanya berisi UUID terbukti atau `null`; ID lokal berbentuk UUID-like pun tidak dikirim |
| HP setara tanpa tulis ulang jejak | Master `+62…` dengan jejak `08…` → `sudah_ada`; jejak tersimpan tetap aslinya |
| Putus sebelum commit / sesudah commit | Adaptor gagal sebelum kirim, atau commit lalu buang jawaban; `lanjutkan` → hasil benar tanpa duplikat |
| Peran salah / nonaktif | STAFF/DOCTOR/FINANCE/OWNER nonaktif/tanpa JWT ditolak sebelum batch; header cabang tidak sah ditolak |
| Riwayat bersama NULL, D1/D2 tetap | `branch_id` NULL; `authenticated` tetap tidak bisa menulis langsung; katalog tidak berubah |
| Tanggal invalid / di atas batas / teks terlalu panjang | Karantina, tanpa pemotongan; nilai batas tepat lolos |
| Tabrakan jejak | Dua riwayat berjejak sama (termasuk cadangan lintas pemilik) → semuanya dihentikan |
| Nol efek keuangan/stok | Hitungan sales, invoices, prescription_items, stok, dan jurnal sebelum = sesudah |
| Atomisitas | Panggilan ke-2 gagal level panggilan → panggilan ke-1 tetap ter-commit, ke-2 tidak sama sekali; gagal per baris tidak membatalkan baris lain |
| Ambigu | Pemilik/anabul ganda → perlu keputusan, tanpa merge dan tanpa HP palsu |
| Rekonsiliasi | Semua hitungan menutup 100% |

Plus lint, tsc, `npm test` penuh, build, dan regresi harness impor/RLS yang ada.

---

## 7. Keputusan kontrak yang belum selesai (perlu jawaban review)

| # | Pertanyaan | Usulan default |
|---|---|---|
| K1 | Penanda versi kontrak di master: di mana dan seperti apa? | Sel berlabel `contract_version` = `v0` di sheet Mapping; tanpa penanda → tolak |
| K2 | Label header persis per sheet (termasuk blok FILE provenance) | Ditetapkan dari master contoh sintetis yang tim kirim; runner mencocokkan persis setelah normalisasi |
| K3 | Kosakata keputusan yang berarti "boleh masuk" di Pemilik/Hewan/RiwayatMedis | Satu literal per tingkat, disepakati tertulis (mis. `SETUJU`); selain itu dikecualikan |
| K4 | Cara runner login sebagai OWNER/ADMIN asli saat apply nanti | Password diketik interaktif saat run (tidak disimpan/log), sesi di memori saja; atau operator menjalankan dari mesinnya sendiri. Tanpa service-role |
| K5 | Peran runner | OWNER, agar readback RS-2 level ID bisa dipakai. ADMIN hanya mendapat readback RS-1 level nama |
| K6 | Konteks cabang saat apply | `--semua-cabang` (tanpa header) untuk OWNER, sama dengan "Semua cabang" sungguhan |
| K7 | Perbaiki pemotongan diam-diam di UI (F1) dan ekstraksi layanan bersama? | Terpisah, di luar PR ini |
| K8 | Pelanggan hasil impor tanpa `imported_at` → bisa dihitung "pelanggan baru" Q01 (F3) | Perlu keputusan bisnis. Bila harus ditandai, itu perubahan RPC/migrasi dengan review keamanan sendiri, sebelum apply migrasi data |
| K9 | Batas jumlah riwayat per run | Tanpa batas keras di kode; operator memilih subset lewat master. Laporan dry-run wajib ditinjau dulu |
| K10 | Lokasi ledger | Folder lokal operator di luar repo; tidak di-commit |

---

## 8. Di luar cakupan PR ini

- Apply ke produksi atau data nyata.
- Perubahan RPC/DB (F2, F3), UI (F1), dan akses dokter/admin (D3).
- Foto/OCR.
- Audit sampel nyata. Itu tahap offline terpisah (3 kandidat bentuk + 1 tanpa tanggal + 1 karantina) dan bukan data
  siap DB; kandidat tidak dianggap persetujuan.

---

## 9. Koreksi review checkpoint 1 (default teknis; berlaku)

Default di bawah adalah default teknis untuk tujuan pengguna, bukan persetujuan produksi. Basis kode kini `main` b1279f15,
yang memuat afb555e dan rantai migrasi sampai `20261104050000`. Area ranap tidak disentuh.

**K1 Versi kontrak.**
- Master tanpa penanda diterima **hanya** sebagai `legacy-master-v0`, dengan dua syarat: tanda tangan header persis
  dikenali (K2), dan muncul peringatan "tanpa penanda versi".
- Penanda eksplisit (sel `contract_version` + nilai di kanannya, di sheet Mapping) boleh dipakai. Nilai yang dikenal hanya
  `legacy-master-v0`; nilai lain berarti gagal.
- Master tidak pernah ditulis ulang. Versi kontrak dicatat di rencana dan ledger.

**K2 Header aktual, tidak bergantung urutan, dicocokkan persis setelah normalisasi** (huruf kecil, spasi dirapatkan).

| Sheet / blok | Label wajib |
|---|---|
| Pemilik | `local_owner_id (staging)`, `Nama pemilik \| name`, `Nomor telepon \| phone`, `Alamat \| address`, `customers.id (UUID aktual)`, `Status review (staging)`, `Keputusan reviewer (staging)` |
| Hewan | `local_pet_id (staging)`, `local_owner_id (staging)`, `Nama hewan \| name`, `Jenis \| species`, `Ras \| breed`, `Kelamin \| gender`, `Tanggal lahir \| dob`, `DOB mentah (staging)`, `pets.id (UUID aktual)`, `Status review (staging)`, `Keputusan reviewer (staging)` |
| RiwayatMedis | `local_record_id (staging)`, `local_pet_id (staging)`, `Tanggal usulan \| record_date`, `No. rekam \| record_no`, `Dokter \| doctor`, `Catatan / keluhan \| note`, `Anamnesis \| anamnesis`, `Gejala klinis \| clinical_findings`, `Diagnosis \| diagnosis`, `Terapi \| therapy`, `Status review (staging)`, `Sheet sumber (staging)`, `Keputusan reviewer (staging)` |
| Mapping FILE | `sample_id`, `File asli`, `Path components asli (JSON)`, `SHA-256 file`, `Drive file URL`, `Jumlah sheet`, `Foto medis dikecualikan`, `Perubahan asli` |
| Mapping PER-SHEET | `ID lokal / sumber`, `File`, `Sheet asli`, `source_key asli`, `Tanggal tab`, `Tanggal sel`, `Catatan perubahan staging`, `Relasi dedupe` |

Aturan pemindaian dan batas tabel:
- Pemindaian terbatas, baris 1–60 per sheet.
- Baris header adalah baris yang memuat **semua** label sebuah tanda tangan, masing-masing tepat sekali.
- Mapping wajib memuat tepat satu blok FILE dan tepat satu blok PER-SHEET. Dua blok **berbeda** bukan duplikat; blok
  **sama** yang muncul dua kali berarti gagal.
- Baris 5 dan 29/35 hanya petunjuk, tidak di-hardcode.
- Catatan skema di atas header bukan record.
- Data blok dimulai tepat di bawah header dan berakhir di baris pertama yang semua kolom bloknya kosong, atau di header
  blok lain.
- Isi apa pun di kolom blok setelah batas itu (selain header blok lain) menggagalkan **seluruh file** (batas tabel ambigu).
  Header dan catatan di bawahnya tidak pernah terbaca sebagai baris.

**K3 Kelayakan review, bukan otorisasi produksi.**
- Literal `SETUJU` (setelah trim, persis) harus ada di pemilik, hewan, **dan** riwayat. Itu hanya membuat baris layak
  ditinjau untuk apply.
- Kosong, rumus, atau teks bebas lain tidak dihitung persetujuan.
- Dry-run tetap mem-parse dan memvalidasi **semua** baris, sehingga hitungan "kandidat" dan "disetujui" dilaporkan
  terpisah. Persetujuan kosong tidak menutupi galat struktur.
- Karantina dan konflik tanggal tidak bisa dibatalkan oleh `SETUJU`.

**K4** Klien user terautentikasi di-inject untuk kode dan tes. Tidak ada kredensial sekarang. Login/sesi operasional
OWNER nanti masih **terbuka**. Tidak ada pengumpulan password/rahasia di chat, log, atau berkas env.

**K5** Mode end-to-end (tulis + readback RS-2) mewajibkan **OWNER** aktif. ADMIN ditolak sejak awal, supaya tidak ada
verifikasi palsu.

**K6** Mode jaringan mewajibkan konteks eksplisit:
- `cabang` dengan UUID: header selalu dikirim, tidak pernah dijatuhkan;
- `semua-cabang`: hanya bila terbukti berhak (profil OWNER aktif dibaca dulu). Flag saja bukan izin.

Mode offline tidak memakai auth maupun cabang.

**K7** Perbaikan pemotongan UI dan ekstraksi layanan berada di luar PR ini.

**K8** Semantik RPC yang ada dipertahankan; PR ini hanya kode dan tes. Risiko `imported_at`/Q01 (F3) didokumentasikan.
Ada dua jalan, dan **tidak** dipilih diam-diam:
- (A) penandaan historis, yang butuh review DB terpisah;
- (B) menerima kredit quest secara eksplisit, yang butuh keputusan bisnis.

Implementasi sintetis tidak diblokir.

**K9** Satu pekerja.
- Batch bisa diatur, dengan plafon 150. Angka itu ukuran UI yang ada, bukan kapasitas produksi terukur.
- Batas eksplisit (lebih → gagal, tanpa potong):

  | Ukuran | Batas |
  |---|---|
  | berkas | 20 MB |
  | total tak terkompresi zip | 200 MB |
  | jumlah entri zip | 2.000 |
  | baris data per sheet | 20.000 |
  | kolom yang dipindai | 64 |

- Pemilihan run lewat rencana tertinjau. Semua yang dikecualikan atau dikarantina tetap dihitung.

**K10** Ledger lokal operator di luar repo.
- Berkas mode 0600, folder 0700.
- Checkpoint atomik (tulis sementara → fsync → rename) dan kunci run eksklusif (`wx`).
- Tanpa `source_key` mentah atau PHI di log. Hash ID dan `visit_id` adalah **metadata pseudonim sensitif**, bukan anonim.

### Koreksi wajib

1. **F2 (penulis L574–579, anabul tertua `limit 1` tanpa filter status).**
   - Sebelum RPC baris baru, hitung **semua** anabul cocok milik pemilik itu, termasuk nonaktif (scan tidak memfilter
     status). Predikatnya gabungan kunci aplikasi dan `lower(btrim(name))` milik DB.
   - Lebih dari satu → TAHAN. Satu → kirim UUID eksplisit. Nol → `pet_id` null.
   - Pengecekan diulang tepat sebelum eksekusi, dan perubahan kandidat → TAHAN (diuji).
   - **Risiko sisa yang diungkap:** selama fallback pembuatan di DB masih ada, snapshot tidak menjamin bebas balapan antara
     pengecekan dan RPC.
2. **F4 (scan INVOKER/RLS, persis).**
   - Ketiadaan di scan **bukan** bukti baru atau tidak ganda. Otoritasnya ada pada jejak kanonik dan hasil simpan massal
     DB; offline menyatakan "tidak diketahui".
   - Scan yang hilang, rusak, atau tidak lengkap → gagal tertutup.
   - Jejak dipertahankan. Tabrakan jejak 2 bagian lintas pemilik dan jejak setara HP kanonik → TAHAN SEMUA.
   - Tahan identitas tidak dilewati hanya karena jejak tampak sudah ada.
3. **Readback RS-2.**
   - Paginasi dihabiskan, dengan >1000 baris per hewan dianggap gagal tidak lengkap. `visit_id` dicocokkan persis
     (bukan 200 terakhir, nama, atau tanggal).
   - Demografi pemilik/hewan yang sudah ada tidak diubah RPC. Karena itu dibandingkan dengan snapshot identitas
     tertinjau, dan selisih ditandai/TAHAN **sebelum** apply. Tidak menimpa dan tidak mengklaim "sudah dinormalisasi".
   - Kunjungan dan MR dicocokkan persis, termasuk `keluhan = note` (atau anamnesis bila note kosong).
4. **Tanggal.**
   - Batas 1990 hanya kebijakan karantina advisori yang bisa diatur, bukan constraint DB.
   - Tanggal mustahil, tanggal di masa depan (WIB), sistem tanggal 1904, sel rumus (cache bisa basi), dan tanggal yang
     memuat jam → karantina atau tolak.
   - Tanggal tab ≠ tanggal sel → **karantina** sampai ada kolom resolusi tertinjau eksplisit di kontrak berikutnya.
     Tanggal tab tidak dipilih otomatis.
5. **Commit tidak pasti.**
   - Kirim ulang payload, urutan, dan jejak yang **sama**, dengan sidik rencana sama.
   - Seluruh bentuk jawaban RPC divalidasi **sebelum** diakui: tipe, jumlah, urutan kunci, status, dan kesesuaian UUID.
     Jawaban rusak atau parsial → tidak pasti.
   - Penanda "dikirim" ditulis tahan-crash **sebelum** jaringan, di bawah kunci eksklusif. Pemulihan crash dites.
   - `lanjutkan` menolak berkas, rencana, atau konteks yang berubah.
6. **Default baca-saja: NOL panggilan jaringan/mutasi.**
   - Mode identitas baca-saja tidak pernah memanggil simpan massal.
   - Bukti harness `psql` hanya berlaku untuk DB sintetis, bukan bukti PostgREST/auth/jaringan hosted.
   - Foto dikecualikan, tanpa OCR. Teks klinis dipertahankan, tanpa ekstraksi satuan/stok/tagihan.
   - Tiga kandidat bentuk + 2 yang ditahan saat ini **0 yang disetujui/terbukti di DB**.

---

## 10. Implementasi draft (kode + tes sintetis)

**Modul** (`src/lib/migrasi-kartu-medis/`, murni TypeScript, import relatif; `actions.ts`/UI dan RPC/DB **tidak diubah**):

| Berkas | Isi |
|---|---|
| `kontrak.ts` | Tanda tangan header persis (K2), `legacy-master-v0`, penanda versi, batas sumber (K9), literal `SETUJU` (K3) |
| `baca-master.ts` | Cek zip dari direktori pusat (ukuran/entri, tanpa zip64), tolak sistem tanggal 1904, model sel (teks/angka/tanggal/rumus/galat), deteksi header terbatas, dua blok Mapping, batas tabel jelas |
| `rencana.ts` | Validasi per field memakai batas efektif DB (tanpa potong), gabung ID lokal, jejak asli dari Mapping, aturan tanggal (§9 no. 4), karantina > pengecualian > siap, tabrakan jejak/isi ganda (TAHAN SEMUA), payload beku + SHA-256, rekonsiliasi 100% |
| `dry-run.ts` | Dry-run offline bawaan; laporan tanpa PHI, dengan catatan "bukan otorisasi produksi; status DB tidak diketahui" |
| `klien.ts` | Antarmuka klien terautentikasi yang di-inject (K4); prasyarat OWNER aktif + konteks eksplisit (K5/K6) |
| `identitas.ts` | Scan baca-saja tervalidasi (F4), hitung semua anabul cocok termasuk nonaktif (F2), UUID eksplisit hanya bila terbukti, demografi yang sudah ada dibandingkan (TAHAN bila beda) |
| `buku-besar.ts` | Ledger 0700/0600, checkpoint atomik, kunci `wx` (ambil alih hanya untuk kunci basi host sama), tanpa PHI, tolak bila berkas/rencana/konteks/ukuran batch berubah |
| `eksekutor.ts` | Batch ≤150; resolusi identitas **per batch** + cek ulang tepat sebelum kirim; penanda `dikirim` sebelum jaringan; validasi penuh jawaban sebelum diakui; kirim ulang identik; readback RS-2 (detail per `visit_id`, paginasi per hewan sampai habis/>1000 = gagal, demografi) |

Catatan desain dari implementasi:
- Resolusi identitas dijalankan per batch, tidak sekali untuk seluruh run. Pemilik/anabul baru yang dibuat batch
  sebelumnya dikenali sebagai identitas persis di batch berikutnya, jadi tidak salah ditahan sebagai "kandidat berubah".
  Cek ulang tetap dilakukan tepat sebelum tiap kiriman.
- Hitungan `HasilJalan` kumulatif per ledger (semua lanjutan dengan rencana yang sama).
- Galat level panggilan (mis. header cabang tidak sah ditolak DB) diperlakukan sebagai **tidak pasti** (konservatif):
  run berhenti, dan lanjutan mengirim ulang payload identik.

**CLI:** `node scripts/migrasi-kartu-medis.mjs dry-run --berkas <xlsx> [--laporan <json di luar repo>]`.
- Hanya offline. Modul jaringan tidak dimuat (diuji dengan `fetch` yang melempar).
- Tanpa dependensi baru: `typescript` yang sudah ada mentranspilasi modul ke `node_modules/.cache`.
- Tidak ada perintah jalankan/lanjutkan di CLI sampai login operasional OWNER diputuskan.

**Harness integrasi:** `scripts/test-migrasi-kartu-medis-postgres.py` + `scripts/test-migrasi-kartu-medis-node.mjs`.
- Rantai migrasi repo terkini dipasang, sampai `20261104050000`, termasuk ranap 20261104040000.
- Eksekutor asli memanggil RPC lewat adaptor `psql` yang meniru PostgREST: satu panggilan = satu transaksi, `authenticated`,
  klaim JWT, header cabang.
- Ini **hanya** bukti DB sintetis, bukan bukti PostgREST/auth/jaringan hosted.

### Gerbang yang masih terbuka (operasional/bisnis)

1. **Login/sesi OWNER untuk apply** (K4). Belum ada mode jalankan di CLI; tidak ada kredensial dikumpulkan.
2. **F3 / Q01 `imported_at`** (K8). Pilihannya:
   - (A) penandaan historis, butuh review DB terpisah;
   - (B) menerima kredit quest secara eksplisit, butuh keputusan bisnis.
3. **Kolom resolusi tanggal tertinjau** untuk tab ≠ sel. Sampai ada di kontrak berikutnya, baris seperti itu dikarantina.
4. **Selisih demografi pemilik/anabul yang sudah ada.** Baris ditahan; master perlu diselaraskan atau ada keputusan
   tertinjau. RPC tidak memperbarui data yang sudah ada.
5. **Risiko sisa F2.** Fallback pembuatan anabul di DB tetap ada, jadi cek ulang tidak menjamin bebas balapan.
6. **Apply ke produksi, audit sampel nyata, merge, deploy:** masing-masing butuh izin terpisah.
   - 3 kandidat bentuk + 2 yang ditahan = 0 yang disetujui/terbukti di DB.
