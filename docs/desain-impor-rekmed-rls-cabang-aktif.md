# Desain (revisi 3): impor rekam medis gagal di cabang aktif (RLS `operational_branch_isolation`)

Status: **IMPLEMENTASI DRAFT (D1 + D2 + RS-1) untuk review independen — belum ada perubahan Production.**
Kode & tes: lihat §8–§10 (catatan implementasi revisi 4). Bagian §1–§7 adalah desain revisi 3 yang disetujui.
Basis: `main` `a561b05`. Semua repro, pemetaan, dan probe hanya di Postgres 17.10 sekali-pakai (semua migrasi repo,
data fiktif). Riwayat: revisi 1 `a843be4` (opsi A) diblokir; revisi 2 `0ddded9` diminta direvisi (D2 tidak cukup,
schema privat bukan batas keamanan, read-side belum selesai).

## 1. Gejala & diagnosis (ringkas; bukti lengkap di revisi 1/2)
- UAT live: OWNER, cabang aktif → impor 0 tersimpan, 2 ditahan, `operational_branch_isolation` pada `visits`.
- Repro authenticated + `request.headers` seperti server aplikasi: OWNER/ADMIN dengan header → ditolak, pelanggan/
  anabul ikut batal (0/0); tanpa header → tersimpan. `user_can_access_branch(NULL)`: tanpa header `true` untuk
  pemegang `all_branches` (OWNER/ADMIN/FINANCE), dengan header `false`; untuk peran tanpa `all_branches` selalu `false`.
- Riwayat bersama (`visits.branch_id IS NULL`) tidak terlihat di cabang aktif; DOCTOR tidak pernah melihatnya.
- Harness lama tidak mengisi header.

## 2. Peta lengkap tabel anak kunjungan (dari katalog FK + kebijakan + hak `authenticated`)
Semua FK yang berujung ke `visits` (kedalaman ≤ 4). "Iso" = punya restrictive `operational_parent_isolation`.

**A. Bisa ditulis `authenticated` (butuh guard D2):**

| Tabel | FK ke kunjungan (jalur) | Hak tulis `authenticated` | Iso | Permissive tulis hari ini |
|---|---|---|---|---|
| visits (self) | `continued_from_visit_id` | I/U/D | — | `visits_write` (cabang **atau** legacy+`is_admin`); trigger `protect_inpatient_continuation_link` menolak set tautan oleh `authenticated` |
| medical_records | `visit_id`; `continued_from_record_id` | I/U/D | ya | `mr_write` (induk cabang **atau** legacy+`is_admin`) |
| prescription_items | `medical_record_id` | I/U/D | ya | `true` |
| compounding_recipes | `medical_record_id` | I/U/D | ya | `true` |
| compounding_ingredients | `recipe_id`→recipes→mr | I/U/D | ya | `true` |
| consents | `visit_id` | I/U/D | ya | `true` |
| inpatient_records | `visit_id`, `medical_record_id`, `consent_id` | I | ya | cabang baris sendiri |
| inpatient_medications / daily_logs / status_log | `inpatient_record_id` | I/U/D | ya | `true` |
| inpatient_med_doses | `medication_id`→… | I/U/D | ya | insert/update `true` |
| visit_operational_events | `visit_id`, `booking_id` | I | ya | cabang baris sendiri + tautologi `v.branch_id = v.branch_id` |
| visit_referrals | `visit_id` | I | ya | cabang baris sendiri + tautologi |
| **bookings** | `visit_id` | I/U/D | **tidak** | kebijakan booking sendiri |
| **follow_ups** | `visit_id`, `medical_record_id` | I/U/D | **tidak** | kebijakan follow-up sendiri |
| **clinic_record_addenda** | `visit_id`, `medical_record_id`, `invoice_id` | I | **tidak** | kebijakan addenda sendiri |
| **clinic_record_corrections** | `medical_record_id` | I | **tidak** | kebijakan koreksi sendiri |
| invoice_edit_log | `invoice_id`→invoices | U/D | ya | `iel_ins` insert `true` |

Baris tebal: FK ke kunjungan/rekam medis **tanpa** pemeriksaan induk sama sekali — bisa menempel ke riwayat bersama
hari ini juga, terlepas dari visibilitas.

**B. Tanpa hak tulis `authenticated` (ditutup oleh GRANT; hanya ditulis RPC definer):** invoices, invoice_items,
invoice_payments, clinic_demo_*, clinic_compound_sales, clinic_customer_advances, clinic_payment_receipts(+parts),
clinic_refunds(+items, requests), clinic_dp_overrides, clinic_invoice_operations, clinic_advance_applications,
inpatient_rx_evidence, inpatient_daily_log_edits, compound_adjustments/issues/official_usage. Risiko sisa: RPC definer
milik `postgres` yang menulis tabel ini berdasar `visit_id` tidak dinilai RLS — **di luar scope**, dicatat; dites
negatif hanya pada jalur yang terjangkau impor.

## 3. Pilar desain dan keputusan
### 3.1 D1 — penulis sempit milik role khusus (WAJIB untuk impor di cabang aktif dengan asal-tulis RPC)
Di bawah RPC SECURITY INVOKER, RLS tidak bisa membedakan sisipan RPC dari sisipan langsung pemanggil yang sama (§4
rev. 2). Satu-satunya cara tanpa bypass RLS: penulis `SECURITY DEFINER` **dimiliki role `NOLOGIN NOINHERIT
NOBYPASSRLS`** yang hanya punya kebijakan RLS + hak kolom untuk baris bersama.

**Skema privat bukan batas keamanan.** Penulis dianggap bisa dipanggil langsung oleh `authenticated` dengan argumen
apa pun; semua validasi ada di dalam penulis:
1. `auth.uid()` adalah profil **aktif** OWNER/ADMIN (dibaca lewat kebijakan `profiles` TO role: `id = auth.uid()`).
2. Header cabang: bila ada, `user_can_access_branch(header)` harus true (cabang ada, aktif, berhak); tidak dihapus/diubah.
3. Kunci sumber: tidak kosong, ≤ 500 karakter. **Sidik dihitung ulang di server**; argumen sidik tidak ada.
4. Ambil `customer_identity_lock(hp)` (re-entrant). Dedup persis/setara mengikuti `20261101100000` (identik → sudah
   ada, beda → bentrok, tanpa sidik → belum terbukti, >1 → gagal tertutup).
5. Identitas — **flag "pilihan manusia" bukan bukti**: `customer_id` wajib ada dan termasuk kandidat menurut
   predikat yang sama dengan pemindaian identitas (kunci HP pelanggan = kunci HP baris **atau** kunci nama pelanggan
   = kunci nama pemilik baris); `pet_id` wajib milik pelanggan itu. Selain itu ditolak. Pembuatan pelanggan/anabul
   tetap di RPC publik (INVOKER, RLS pemanggil), tidak di penulis.
6. INSERT `visits` (`branch_id NULL`, kolom terbatas) + `medical_records` (kolom terbatas). Tidak ada UPDATE/DELETE.

**Hak minimal role `kamo_legacy_import_writer`** (bukan pemilik tabel; bukan anggota/peran yang bisa di-SET oleh
siapa pun setelah migrasi):
- Skema: USAGE `public` (lewat PUBLIC bawaan), USAGE `kamo_import`. **Tanpa CREATE** di skema mana pun (CREATE
  sementara di `kamo_import` hanya untuk ALTER OWNER, dicabut di transaksi yang sama).
- Tabel (hak kolom): `visits` SELECT(id, branch_id, legacy_source_key, legacy_source_hash, customer_id, pet_id),
  INSERT(customer_id, pet_id, poli, dokter, keluhan, status, created_at, legacy_source_key, legacy_record_no,
  legacy_source_hash) — **tanpa** `branch_id` (default NULL) dan **tanpa** `continued_from_*`;
  `medical_records` INSERT(visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep);
  `customers` SELECT(id, name, phone); `pets` SELECT(id, customer_id, name); `profiles` SELECT(id, role, is_active).
  Tanpa UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
- Kebijakan TO role: `visits` SELECT `branch_id is null`; `visits` INSERT `branch_id is null and legacy_source_key
  is not null and length(btrim(legacy_source_key)) between 1 and 500 and legacy_source_hash is not null`;
  `medical_records` INSERT `exists(induk dengan branch_id is null)`; `customers`/`pets` SELECT `true`;
  `profiles` SELECT `id = auth.uid()`.
- EXECUTE: `user_can_access_branch`, `indonesian_phone_key`, `import_legacy_text_key`, `import_legacy_phone_key`,
  `import_legacy_row_hash`, `import_legacy_source_key_canonical`, `customer_identity_lock`, fungsi alasan.
- Fungsi penulis & helper: `revoke all ... from public, anon, authenticated, service_role`, lalu `grant execute ...
  to authenticated` **sebelum** ALTER OWNER (setelah pemilik pindah, admin migrasi tidak bisa memberi hak lagi —
  terbukti probe). Semua dalam **satu transaksi** migrasi.
- Urutan kepemilikan (terbukti probe): `grant <role> to <admin migrasi> with set true, inherit false` → ALTER OWNER →
  `revoke <role> from <admin migrasi> granted by <admin migrasi>` → `revoke create on schema kamo_import from <role>`.
- Pasca-cek gagal tertutup: pemilik fungsi = role; role tidak BYPASSRLS; tidak ada `pg_auth_members` dengan
  `set_option` atau `inherit_option` untuk role; `authenticator`/`authenticated`/`anon`/`service_role` bukan anggota;
  tanpa CREATE skema; tanpa UPDATE/DELETE/TRUNCATE; ACL fungsi hanya pemilik + `authenticated`.
  **Probe juga menunjukkan ALTER OWNER bisa gagal diam-diam bila prasyarat kurang** → tanpa pasca-cek, fungsi tetap
  milik admin migrasi (bypass RLS). Pasca-cek ini wajib.

**Trigger (dibaca dari katalog):** di `visits`/`medical_records` semua trigger `SECURITY DEFINER` kecuali
`protect_inpatient_continuation_link` (invoker) yang **melewati pemeriksaan bila `current_user <> 'authenticated'`**.
Role penulis akan dianggap "sistem" oleh trigger itu dan oleh pola serupa di 42 berkas migrasi lain. Mitigasi: role
hanya menulis `visits` & `medical_records`, tanpa hak kolom `continued_from_*` (tidak bisa diisi). Audit
`capture_activity_log` memakai `auth.uid()` → aktor tercatat = importir (JWT), bukan role. Trigger baru di kedua tabel
kelak wajib memperhitungkan role ini (dicatat di komentar migrasi).

**Bukti probe (lokal, admin migrasi ditiru non-superuser `CREATEROLE BYPASSRLS`, PostgREST ditiru `authenticator` →
`authenticated`):** pemilik berpindah; `current_user` di penulis = role; baris non-bersama ditolak RLS; sisipan
langsung `authenticated` ditolak; `SET ROLE` ke role ditolak untuk `authenticator`, `authenticated`, dan admin
migrasi sesudah pencabutan; role tanpa CREATE/UPDATE/DELETE/TRUNCATE; hak kolom di luar daftar ditolak.
Sisa: admin migrasi tetap memegang **ADMIN option** bawaan pembuat role (tanpa SET/INHERIT) — perlu untuk DROP kelak;
keputusan reviewer apakah diterima. **Belum terbukti di Supabase hosted:** atribut nyata peran `postgres`,
pembatasan `supautils` atas CREATE ROLE/ALTER OWNER, identitas runner migrasi, default privileges Supabase, dan
skema yang diekspos Data API. Wajib diverifikasi read-only sebelum rilis; bila salah satu gagal, D1 tidak bisa dipakai
dan desain kembali ke keputusan.

### 3.2 D2 — tutup tulis langsung ke kunjungan tanpa cabang di SEMUA konteks (disarankan; prasyarat RS-2)
Menghapus disjungsi legacy dari `visits_write`/`mr_write` **tidak cukup** karena `user_can_access_branch(NULL)` = true
tanpa header untuk OWNER/ADMIN/FINANCE (dan peran lain yang diberi `all_branches` lewat `role_capabilities`).
Maka D2 memakai restrictive eksplisit, **tidak bergantung peran/kapabilitas/header**, untuk `authenticated`:

`visits`:
- INSERT `with check (branch_id is not null)`
- UPDATE `using (branch_id is not null) with check (branch_id is not null)`
- DELETE `using (branch_id is not null)`

Anak (§2A), predikat "induk bukan kunjungan tanpa cabang", per perintah INSERT / UPDATE (USING **dan** WITH CHECK —
menutup pemindahan FK ke/dari riwayat bersama) / DELETE. Predikat harus benar walau induk **tidak terlihat** oleh
pemanggil (di bawah RLS pemanggil, `not exists(...)` terhadap induk tak terlihat bernilai true = lolos, jadi salah).
Dua pilihan implementasi predikat:
- **P-a (disarankan): helper boolean milik role penulis** (`kamo_import.kunjungan_tanpa_cabang(visit_id)`,
  `kamo_import.rekam_tanpa_cabang(mr_id)`, dst.), yang membaca lewat kebijakan SELECT role (hanya baris tanpa cabang
  dan rantai anaknya). Tanpa bypass RLS; konsekuensi: role mendapat SELECT kolom FK pada tabel rantai (medical_records,
  compounding_recipes, inpatient_records, inpatient_medications, inpatient_daily_logs, invoices) terbatas kebijakan.
- P-b: helper boolean `SECURITY DEFINER` milik `postgres` (pola `user_can_access_branch` yang ada). Lebih sederhana,
  tetapi membaca melewati RLS (hanya boolean); ditolak bila reviewer mengharuskan tanpa bypass sama sekali.

Kolom FK nullable (`bookings.visit_id`, `follow_ups.*`, `visit_operational_events.visit_id`,
`clinic_record_addenda.*`) memakai `fk is null or <predikat>`.

Konsekuensi D2 yang harus diterima pemilik:
- OWNER/ADMIN/FINANCE **tidak bisa lagi** membuat/mengubah/menghapus kunjungan tanpa cabang (dan anaknya) lewat
  aplikasi di konteks "Semua cabang". Riwayat bersama hanya bertambah lewat penulis impor; koreksi isi riwayat
  bersama tidak lagi bisa lewat UI biasa.
- Preflight read-only (butuh izin terpisah): jumlah kunjungan `branch_id NULL` non-legacy dan anak yang menempel ke
  kunjungan tanpa cabang di Production; plus cek kode aplikasi bahwa tidak ada alur yang menulis kunjungan tanpa
  cabang selain impor.

### 3.3 Read-side OWNER/ADMIN di cabang aktif (untuk UAT melihat hasil)
| Opsi | Inti | Butuh | Konsekuensi |
|---|---|---|---|
| **RS-1 (minimum, disarankan sekarang)** | RPC baca-saja `kamo_import.hasil_impor(p_kunci text[])` milik role penulis (memakai kebijakan SELECT role): mengembalikan per jejak — status, `visit_id`, tanggal, pelanggan/anabul, dan ringkasan isi klinis — hanya untuk OWNER/ADMIN aktif dengan validasi header yang sama. Layar impor memakainya. | D1 | **Tidak ada perubahan SELECT tabel** → tidak ada anak yang terbuka. Halaman riwayat pasien di cabang aktif tetap tidak menampilkan riwayat bersama (lihat lewat "Semua cabang"). |
| RS-2 | Restrictive SELECT `visits` (dan rantai anak yang ditampilkan) ditambah `branch_id is null and <OWNER/ADMIN aktif>`. | D1 + **D2 wajib lebih dulu** (guard tulis semua anak) | Riwayat bersama tampil di halaman pasien untuk OWNER/ADMIN di cabang aktif; tulis anak tetap ketat karena D2. |
| RS-3 | Tanpa perubahan; lihat via "Semua cabang". | — | Tidak membantu UAT di cabang aktif. |

DOCTOR read (D3) tetap keputusan terpisah = RS-2 diperluas ke `can_read_legacy_medical_history()` setelah D2.

## 4. Keputusan minimum & rekomendasi
| Tujuan | Keputusan minimum | Catatan |
|---|---|---|
| Impor jalan di cabang aktif, asal-tulis lewat penulis | **D1** | Tanpa D1 tidak mungkin di bawah batasan yang ada. |
| UAT melihat hasil impor di cabang aktif | **D1 + RS-1** | Tanpa D2. |
| Tutup paparan lama (tulis langsung tanpa cabang oleh OWNER/ADMIN/FINANCE, sidik basi) | **D2** | Mengubah perilaku "Semua cabang". |
| Riwayat bersama tampil di halaman pasien (OWNER/ADMIN) | D1 + D2 + RS-2 | Nanti. |
| Dokter melihat riwayat bersama | D1 + D2 + RS-2 + D3 | Nanti, keputusan kebijakan. |

Rekomendasi: **D1 + D2 + RS-1** dalam satu PR draft; RS-2/D3 menyusul. Bila D2 ditolak: D1 + RS-1 saja, dengan
paparan lama terdokumentasi.

## 5. Rancangan tes (test-first; `request.headers` diisi seperti server aplikasi kecuali disebut)
Positif (gagal di `main`, lulus sesudah): OWNER & ADMIN aktif, cabang aktif — massal & per baris tersimpan; kirim ulang
`sudah_ada`; 08↔62 `sudah_ada`; bentrok ditahan; >1 kecocokan historis gagal tertutup; balapan C1–C15 dengan header;
`hasil_impor` mengembalikan hasil yang sama.

Negatif penulis (dipanggil **langsung** dengan argumen bebas): STAFF/DOCTOR/FINANCE; OWNER/ADMIN `is_active=false`;
header ke cabang nonaktif atau tidak berhak; kunci kosong / >500; sidik dari pemanggil tidak ada (hasil sidik =
hitungan server); `customer_id` bukan kandidat (HP & nama beda); `pet_id` milik pelanggan lain; `anon` tidak bisa
EXECUTE.

Negatif RLS `authenticated` (dengan **dan** tanpa header; OWNER, ADMIN, FINANCE; `all_branches` ADMIN on/off via
`role_capabilities`):
- `visits`: INSERT tanpa cabang (legacy & non-legacy; kunci kosong/palsu; sidik palsu); UPDATE/DELETE baris tanpa
  cabang; UPDATE baris bercabang → `branch_id NULL`.
- Setiap anak §2A: INSERT menempel ke kunjungan/rekam tanpa cabang; UPDATE yang memindahkan FK ke/dari baris tanpa
  cabang; UPDATE/DELETE anak yang sudah menempel; INSERT tambahan rekam medis pada kunjungan bersama.
- Setelah tiap percobaan: `visits.legacy_source_hash` dan isi `medical_records` riwayat bersama **tidak berubah**, dan
  sidik hitung ulang dari isi = sidik tersimpan.

Regresi non-legacy / baris bercabang (harus TETAP diizinkan sesuai aturan lama): STAFF/DOCTOR di cabangnya
INSERT/UPDATE kunjungan, rekam medis, resep, racikan, persetujuan, rawat inap, rujukan, kejadian, booking, follow-up,
addenda, koreksi; lintas cabang tetap ditolak.

Role & trigger:
- Pasca-cek kepemilikan/keanggotaan/hak (§3.1) dites sebagai kasus harness, termasuk varian "prasyarat kurang" yang
  harus membuat migrasi gagal (bukan diam-diam).
- `authenticator`/`authenticated`/`anon`/`service_role`: `SET ROLE kamo_legacy_import_writer` ditolak.
- Sisipan penulis: `capture_activity_log` mencatat aktor = `auth.uid()` importir; `protect_inpatient_continuation_link`
  dilewati untuk role, tetapi `continued_from_*` tetap NULL (tidak ada hak kolom); trigger definer lain berjalan normal.
- Regresi: seluruh harness impor lama (tanpa header) + `scripts/test-employee-account-context-postgres.py`.

## 6. Di luar scope
Namespace fixture XLSX; RS-2/D3; RPC definer milik `postgres` yang menulis tabel §2B berdasar `visit_id`; hak
TRUNCATE `authenticated` pada beberapa tabel (tidak terjangkau Data API).

## 7. Batas
Tidak ada service-role, bypass/disable RLS untuk pemanggil, penghapusan header, perluasan peran pengguna, perubahan
riwayat bersama menjadi lokal, migrasi/penulisan Production, impor pasien nyata, atau pembersihan data. Implementasi
menunggu review independen revisi ini dan keputusan D1/D2/read-side.

---

## 8. Catatan implementasi (revisi 4) — penyimpangan kecil dari desain dan alasannya
Migrasi: `supabase/migrations/20261101120000_impor_penulis_riwayat_bersama.sql`. Semua di satu transaksi; pasca-cek
gagal = seluruh migrasi batal (terbukti tes, §9).

| Butir | Desain rev. 3 | Implementasi | Alasan |
|---|---|---|---|
| SELECT `visits` untuk role | `branch_id is null` | `branch_id is null or legacy_source_key is not null` (kolom terbatas) **+ otorisasi per baris di keluaran** (§8.1) | Impor paling awal (`20260907160000`) menyimpan kunjungan berjejak **dengan** cabang. Penulis harus tetap melihatnya, kalau tidak kiriman ulang kartu lama jadi duplikat (kasus K3/S lama). Yang keluar ke pemanggil dibatasi per cabang (§8.1). RS-1 tetap hanya mengembalikan baris tanpa cabang. |
| INSERT `medical_records` role | + "belum ada rekam medis di kunjungan itu" | dibuang | Kebijakan yang membaca tabelnya sendiri = rekursi RLS. Satu rekam medis per kunjungan dijamin kode penulis (INSERT berpasangan), bukan kebijakan. |
| `kamo_import.pastikan_pengimpor()` | internal | EXECUTE untuk `authenticated` | RPC publik (INVOKER) memanggilnya di depan, sebelum membuat pelanggan/anabul, supaya konteks salah ditolak utuh. Fungsi hanya memvalidasi, tidak membaca/menulis data lain. |
| Tautan `continued_from_*` di D2 | predikat anak umum | hanya di WITH CHECK (baris baru) | Baris itu sendiri bercabang; trigger lama sudah menolak `authenticated` mengubah tautan. USING pada tautan lama akan mengunci kunjungan cabang yang sah. |
| Helper D2 | `kunjungan_tanpa_cabang` dst. | `kamo_import.tanpa_cabang_{kunjungan,rekam,racikan,persetujuan,ranap,obat_ranap,booking,tagihan}` | Satu helper per induk; `helper(NULL)` = false; dipakai sebagai `helper(fk) is false` (galat/NULL = tolak). |

Validasi penulis (`simpan_riwayat_bersama`, dipanggil langsung pun aman): OWNER/ADMIN **aktif**; header cabang bila
ada harus `user_can_access_branch` (JSON/uuid rusak = tolak); jejak 1–500 karakter; sidik dihitung ulang server (kunci
`legacy_source_hash` kiriman diabaikan); kunci identitas diambil sebelum mencari; >1 kecocokan = gagal tertutup;
pelanggan wajib kandidat (kunci HP sama **atau** kunci nama sama, predikat yang sama dengan klarifikasi aplikasi);
anabul wajib milik pelanggan itu. RS-1 `baca_hasil_impor`: validasi sama, 1–500 jejak, jejak ≤500 karakter, maks. 500
baris, hanya `branch_id is null`, pencocokan memakai bentuk kanonik jejak (08/62 setara).

Aplikasi: `prosesPotonganImporRekamMedis` mengembalikan `kunci_tersimpan` (tersimpan + sudah ada); layar impor
menyimpan ≤500 jejak terakhir dan menampilkan panel **Periksa hasil impor** (server action
`periksaHasilImporRekamMedis` → `hasil_impor_rekam_medis`). Halaman pasien dan akses dokter tidak berubah.

### 8.1 Perbaikan BLOCKER review (head `3000626`): metadata jejak cabang lain
Temuan: `kamo_import.cari_jejak` memvalidasi pemanggil/header tetapi tidak cabang **baris** yang cocok. ADMIN yang hanya
ditugaskan ke cabang A (`all_branches=false`, header A) bisa mendapat UUID + sidik kunjungan berjejak cabang B, dan RPC
publik mengembalikan UUID B sebagai `sudah_ada`.

Perilaku sekarang (kebijakan SELECT role tetap melihat jejak bercabang supaya kecocokan tidak pernah dianggap kosong):
- `cari_jejak` menilai setiap kecocokan (persis **dan** setara 08/62) dengan `user_can_access_branch(branch_id)` di
  konteks pemanggil (JWT + header cabang aktif). Riwayat bersama (cabang NULL) selalu terjangkau.
- Semua kecocokan terjangkau → keluaran seperti sebelumnya (`visit_id`, `existing_hash`, `terkunci=false`).
- **Ada satu saja kecocokan tidak terjangkau** → tepat satu baris `(NULL, NULL, terkunci=true)`: tanpa UUID, sidik,
  cabang, atau jumlah kecocokan. Tidak membedakan isi sama/berbeda/tanpa sidik.
- Semua pemakai menahannya **sebelum** menulis: penulis `simpan_riwayat_bersama` (memakai `cari_jejak` yang sama,
  bukan pencarian mentah) dan RPC per baris menolak dengan pesan generik `kamo_import.alasan_jejak_tidak_terjangkau()`;
  RPC massal (jalur utama dan jalur pengecualian/balapan) memberi `ditahan` + pesan generik + `visit_id` NULL. Tidak ada
  INSERT kunjungan ganda dan tidak ada penimpaan.
- Pemanggil yang berhak atas cabang itu (mis. OWNER dengan header B atau tanpa header; ADMIN `all_branches=true` tanpa
  header) tetap mendapat dedup historis: `sudah_ada` dengan kunjungan B, isi berbeda → `bentrok`.
- Catatan: OWNER dengan header A juga mendapat tahanan generik untuk jejak milik cabang B (header membatasi permintaan,
  sama seperti RLS biasa). Pesan generik memberi tahu bahwa jejak sudah tercatat di tempat yang tidak terjangkau; itu
  disengaja (gagal tertutup tanpa menyimpan ganda), tanpa detail apa pun.
- Gerbang pasca-cek menambah: `cari_jejak` memuat otorisasi per cabang dan penanda generik; penulis memakai
  `cari_jejak` dan memeriksa `v_terkunci` sebelum INSERT.

Hasil tes (PG 17.10 & PG 16, harness **376/376**): di head lama 10 kasus baru gagal (UUID/sidik B bocor di `cari_jejak`;
penulis, per baris, massal mengembalikan B; OWNER header A dapat `sudah_ada` B). Sesudah perbaikan: ADMIN_A
`all_branches=false` header A — `cari_jejak` hanya `{visit_id:null, existing_hash:null, terkunci:true}` (persis & +62);
penulis langsung, RPC per baris, RPC massal ditolak/ditahan generik tanpa UUID/sidik, jumlah kunjungan jejak itu tetap 1;
isi berbeda → pesan generik yang sama; OWNER header A → ditahan generik. Berhak (OWNER header B, OWNER tanpa header,
ADMIN_A `all_branches=true` tanpa header) → massal `sudah_ada` kunjungan B (persis & +62), per baris kunjungan B, isi
berbeda `bentrok`, tidak menulis. Riwayat bersama NULL: semua kasus D1 sebelumnya tetap lulus. Mutasi: mematikan cek
cabang → 10 kasus gagal (tertangkap). Mematikan cek penanda di jalur utama RPC massal saja = mutan setara (RPC per baris
yang dipanggilnya menolak generik dan jalur pengecualian menahan dengan pesan yang sama; tidak ada tulisan yang tersisa).

### Batas janji D2 (residual, sengaja tidak diklaim)
D2 hanya menutup tulis **langsung** oleh `authenticated` (Data API / RPC INVOKER). RPC `SECURITY DEFINER` lama milik
pemilik tabel melewati RLS dan **tidak** dinilai/diubah di PR ini. Yang menulis tabel rantai kunjungan (dari katalog,
setelah semua migrasi; "auth" = bisa dipanggil `authenticated`):
`clinic_adjust_compound` (auth), `clinic_admit_inpatient` (auth), `clinic_admit_inpatient_typed` (auth),
`clinic_change_inpatient_condition` (auth), `clinic_continue_visit_to_inpatient` (auth), `clinic_receive_invoice_payment`
(auth), `clinic_receive_visit_payment` (auth), `clinic_return_compound` (auth), `clinic_update_inpatient_log` (auth),
`clinic_void_compound` (auth), `clinic_void_payment_receipt` (auth), `clinic_edit_invoice_core`,
`clinic_void_reissue_invoice_core`, ditambah fungsi trigger definer (mis. `apply_clinic_record_correction`). Apakah
masing-masing menolak kunjungan tanpa cabang bergantung pada pemeriksaan di dalam fungsi itu sendiri. Maka **tidak ada
klaim "riwayat bersama tidak bisa berubah lewat jalur mana pun"**; yang diklaim: tidak bisa lewat tulis langsung.

## 9. Bukti tes (lokal, Postgres sekali-pakai, data fiktif; tanpa Production)
- `scripts/test-impor-rekam-medis-rls-postgres.py` — PG 17.10 dan PG 16: **376/376 lulus** (363 + 13 kasus kolisi cabang, §8.1). Di basis tanpa migrasi
  baru (TDD merah): 100 gagal (D2 terbuka untuk OWNER/ADMIN/FINANCE tanpa header, anak & pindah induk terbuka, penulis
  belum ada).
  - D2 `visits`: INSERT tanpa cabang (jejak palsu/kosong/NULL), UPDATE/DELETE riwayat bersama, UPDATE bercabang → NULL;
    OWNER/ADMIN dengan & tanpa header, FINANCE, ADMIN `all_branches` on/off.
  - D2 setiap jalur FK anak (§2A, termasuk multi-FK dan `continued_from_*`): INSERT ke riwayat bersama (dengan trigger,
    **dan** tanpa trigger sehingga hanya RLS yang menahan), kontrol payload yang sama ke rantai cabang sendiri **boleh**,
    UPDATE/DELETE anak yang menempel, pindah induk cabang→bersama dan bersama→cabang; induk tersembunyi; lintas cabang.
  - Sidik isi riwayat bersama (kunjungan, rekam medis, semua anak) sama sebelum/sesudah semua percobaan.
  - Regresi cabang biasa tetap boleh (INSERT/UPDATE kunjungan & rekam medis, racikan, booking, follow-up, obat ranap,
    DELETE anak).
  - D1 lewat RPC publik dengan header: OWNER & ADMIN massal tersimpan → kirim ulang sudah_ada, `branch_id` NULL, sidik
    hitungan server; per baris idempoten; 08↔62 sudah_ada; isi berubah ditahan bentrok; STAFF/DOCTOR/FINANCE, OWNER
    nonaktif, header cabang nonaktif, header cabang tak berhak (`all_branches` off), header bukan uuid → ditolak tanpa
    sisa; ADMIN ditugaskan cabang A, `all_branches` on/off, header A → tersimpan.
  - Penulis dipanggil langsung: jejak kosong/>500, pelanggan bukan kandidat, anabul milik orang lain, pelanggan kosong,
    peran salah → ditolak; sidik palsu diabaikan; `anon` tidak bisa EXECUTE.
  - Trigger: log aktivitas mencatat aktor = importir; `continued_from_visit_id` tetap NULL.
  - RS-1: baca isi klinis; tolak >500 jejak, jejak >500 karakter, array kosong, STAFF, DOCTOR, OWNER nonaktif, header
    cabang nonaktif; tepat 500 diterima; kunjungan bercabang berjejak tidak dikembalikan; RPC publik tetap INVOKER.
  - Helper gagal: tanpa EXECUTE (galat) → tulis anak ditolak; helper mengembalikan NULL → ditolak; dipulihkan → boleh.
  - Gerbang: pemilik, tanpa BYPASSRLS/LOGIN, tanpa keanggotaan SET/INHERIT, tidak terjangkau SET ROLE dari
    `authenticator`/`authenticated`/`anon`/`service_role`, tanpa CREATE skema, tanpa UPDATE/DELETE/TRUNCATE, ACL kolom
    & fungsi.
  - Balapan dengan header (barrier deterministik): jejak sama; 08 dan +62 bersamaan → satu kunjungan.
  - Rollback gerbang (klaster baru): role sudah ada dengan BYPASSRLS; PUBLIC punya CREATE di `public`; trigger invoker
    baru di `visits` → migrasi gagal, tanpa skema/kebijakan sisa, RPC lama utuh.
  - Emulasi hosted: runner **non-superuser** `CREATEROLE BYPASSRLS` yang memiliki tabel → migrasi lulus pasca-cek,
    pemilik pindah, runner hanya tersisa ADMIN tanpa SET/INHERIT, runner tidak bisa SET ROLE ke role penulis.
- Mutasi (harness harus gagal): 8 mutasi logika (tanpa guard booking, NULL lolos, tanpa cek kandidat, sidik dari
  pemanggil, pembaca tanpa validasi, UPDATE tanpa USING, tanpa cek header, tanpa pindah pemilik) **semua tertangkap**;
  18 mutasi "guard tabel X = true": 16 tertangkap. Dua yang lolos adalah mutan setara di skema saat ini:
  `visit_referrals` (kebijakan INSERT lama `v.branch_id = v.branch_id` bernilai NULL untuk induk tanpa cabang) dan
  `invoice_edit_log` (`authenticated` tanpa hak INSERT dan tanpa kebijakan permissive UPDATE/DELETE). Guard tetap
  dipasang sebagai pertahanan berlapis.
- Regresi: harness impor lama `scripts/test-impor-rekam-medis-postgres.py` 61/61 (tanpa header). Uji SQL rangkaian
  karyawan (`employee_account_operational_context`, `inpatient_consent`, `clinic_*`, dll.) hasilnya **identik** dengan dan
  tanpa migrasi baru (4 berkas sudah gagal di `main` sebelum PR ini — `ACCESS_DENIED` cabang pelaksana, `DP_MINIMAL`,
  status master — bukan akibat PR ini).
- Aplikasi: `npm test` 4893 lulus; lint 0 error; `tsc --noEmit` bersih; `npm run build` sukses.

## 10. Gerbang operasional hosted (WAJIB sebelum apply; butuh izin terpisah; read-only)
Kelayakan di Supabase hosted **belum terbukti**. Emulasi lokal tidak membuktikan `supautils`, hak `postgres` atas skema
`auth`, default privileges Supabase, atau skema yang diekspos Data API. Migrasi sendiri gagal tertutup bila salah satu
prasyarat kurang (GRANT tanpa hak hanya WARNING — pasca-cek memeriksa hak secara positif). Sebelum meminta izin apply,
jalankan read-only (izin terpisah) dan lampirkan hasilnya:
1. `select rolname, rolsuper, rolcreaterole, rolbypassrls, rolinherit from pg_roles where rolname in (current_user,'postgres','authenticator','authenticated','anon','service_role','kamo_legacy_import_writer');` — role penulis belum ada; runner punya CREATEROLE.
2. `select current_setting('server_version_num'), current_setting('createrole_self_grant', true);` — ≥160000; nilai self-grant dicatat (bila `set`/`inherit`, pasca-cek akan menolak → perlu keputusan).
3. `select has_schema_privilege(current_user,'auth','USAGE'), has_function_privilege(current_user,'auth.uid()','EXECUTE'), exists(select 1 from aclexplode((select proacl from pg_proc where oid='auth.uid()'::regprocedure)) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_exec, exists(select 1 from aclexplode((select nspacl from pg_namespace where nspname='auth')) a where a.grantee=0) as public_usage;` — role penulis harus bisa memakai `auth.uid()` (lewat PUBLIC atau GRANT dengan grant option).
4. `select n.nspname from pg_namespace n where has_schema_privilege('public', n.oid, 'CREATE');` — harus kosong (bila ada, pasca-cek menolak).
5. `select pg_get_userbyid(relowner), relname from pg_class where oid in ('public.visits'::regclass,'public.medical_records'::regclass,'public.customers'::regclass,'public.pets'::regclass,'public.profiles'::regclass);` — dimiliki runner migrasi (kebijakan & GRANT kolom butuh pemilik).
6. `select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl;` — default privileges dicatat; migrasi mencabut eksplisit dari PUBLIC/anon/authenticated/service_role lalu memberi ulang.
7. Pengaturan Data API: skema yang diekspos (diharapkan `public`, `graphql_public`; `kamo_import` tidak perlu diekspos).
8. Daftar trigger `visits`/`medical_records` di Production sama dengan lokal (pasca-cek menolak trigger invoker baru).
Bila salah satu butir tidak sesuai: **jangan apply**; laporkan dan kembali ke keputusan desain. Apply tetap butuh
persetujuan eksplisit atas teks persis migrasi ini, cadangan segar, dan jendela rilis — PR ini tidak memberi izin itu.
