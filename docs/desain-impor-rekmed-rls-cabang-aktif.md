# Desain (revisi 3): impor rekam medis gagal di cabang aktif (RLS `operational_branch_isolation`)

Status: **DESAIN untuk review independen — belum ada implementasi, migrasi, atau perubahan Production.**
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
