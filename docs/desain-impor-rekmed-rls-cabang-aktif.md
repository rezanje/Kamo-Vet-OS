# Desain (revisi 2): impor rekam medis gagal di cabang aktif (RLS `operational_branch_isolation`)

Status: **DESAIN untuk review independen — belum ada implementasi, migrasi, atau perubahan Production.**
Basis: `main` `a561b05`. Semua repro dan pemetaan hanya di Postgres 17.10 sekali-pakai berisi semua migrasi repo
dan data fiktif. Revisi 1 (`a843be4`, opsi A) **diblokir** oleh review keamanan; alasannya ada di §3.

## 1. Gejala (UAT live 29 Okt 17:15 UTC, dilaporkan)
OWNER, cabang aktif VET_CMGG, folder sintetis 1 pemilik / 1 hewan / 2 tab → `0 tersimpan, 0 sudah ada, 2 ditahan`,
alasan `new row violates row-level security policy "operational_branch_isolation" for table "visits"`. Pembacaan
terbatas: 0 pelanggan, 0 riwayat untuk nama/HP uji.

## 2. Diagnosis (dibuktikan sendiri: role `authenticated`, JWT fiktif, `request.headers` seperti server aplikasi)

| Aktor | Header cabang | Simpan massal | Per baris | Pelanggan/anabul tersisa |
|---|---|---|---|---|
| OWNER / ADMIN | tidak ada | 2 tersimpan | tersimpan | 1/1 |
| OWNER / ADMIN | ada | **2 ditahan (RLS visits)** | **ERROR RLS visits** | **0/0** (dibatalkan) |

- Riwayat bersama yang sudah ada, dibaca OWNER: tanpa header 2 kunjungan + 2 rekam medis terlihat; **dengan header 0**.
- `user_can_access_branch(NULL)` untuk OWNER: tanpa header `true`, dengan header `false`
  (`20261017090000`: `v_selected <> NULL` → NULL, `not exists(... id = NULL)` → true → `return false`).
- Kebijakan **restrictive** `operational_branch_isolation` (FOR ALL, `20261014052234`) di-AND dengan permissive
  `visits_write`/`visits_select` (`20260908133000`), sehingga pengecualian lama `legacy_source_key is not null and
  is_admin()` tidak berlaku lagi di cabang aktif.
- DOCTOR tidak pernah melihat riwayat bersama (dengan/tanpa header), walau `can_read_legacy_medical_history()` true.
- Harness lama tidak mengisi `request.headers` → lulus padahal UI gagal.

## 3. Kenapa revisi 1 (opsi A) diblokir — dibuktikan dari katalog kebijakan
### 3a. Terlihatnya induk = izin tulis anak
`operational_parent_isolation` (restrictive, FOR ALL) pada anak hanya mensyaratkan **induk terlihat** oleh pemanggil.
Bila kunjungan bersama dibuat terlihat (SELECT) untuk OWNER/ADMIN di cabang aktif, penulisan anak hanya dibatasi
kebijakan permissive masing-masing:

| Anak (kedalaman dari `visits`) | Permissive yang ada | Hak `authenticated` | Terbuka bila induk bersama terlihat |
|---|---|---|---|
| medical_records (1) | `mr_write` ALL: induk `user_can_access_branch` **atau `legacy_source_key not null and is_admin()`** | S/I/U/D | **INSERT/UPDATE/DELETE** untuk OWNER/ADMIN (+ ubah `visit_id`) |
| prescription_items (2) | `pi_all` ALL `true` | S/I/U/D | **I/U/D** |
| compounding_recipes (2), compounding_ingredients (3) | `cr_all`/`ci_all` ALL `true` | S/I/U/D | **I/U/D** |
| consents (1) | `cs_all` ALL `true` | S/I/U/D | **I/U/D** |
| inpatient_records (1) | `ir_all` ALL `user_can_access_branch(branch_id)` (cabang baris sendiri) | S/I | **INSERT** (rawat inap menempel ke kunjungan bersama) |
| inpatient_medications (2), inpatient_daily_logs (2), inpatient_status_log (2), inpatient_med_doses (3) | `true` / insert `true` | S/I/U/D | **I/U(/D)** lewat rawat inap di atas |
| visit_operational_events (1), visit_referrals (1) | insert: cabang baris sendiri + `exists(visits v ... v.branch_id = v.branch_id)` (tautologi) | S/I | **INSERT** menempel ke kunjungan bersama |
| invoices (1), invoice_items (2), invoice_payments (2), invoice_edit_log (2), clinic_demo_* (2) | induk `user_can_access_branch(v.branch_id)` | S (tanpa I/U/D) | tertutup (NULL → false di cabang aktif) |

Akibatnya: walau UPDATE/DELETE `visits` ditolak, isi klinis anak bisa diubah sehingga `legacy_source_hash`
(sidik isi di `visits`) **basi** dan dedup salah. **Kondisi yang sama sudah ada hari ini** untuk OWNER/ADMIN/FINANCE
di konteks "Semua cabang" (tanpa header, `user_can_access_branch(NULL)` = true) — paparan lama, bukan dari PR ini.

### 3b. `legacy_source_key IS NOT NULL` bukan bukti asal
Kunci boleh kosong/palsu; INSERT langsung ke `visits` oleh OWNER/ADMIN lewat Data API melewati kunci identitas,
sidik, dan dedup di RPC. Format kunci, sidik yang dikirim pemanggil, atau GUC yang bisa diset pemanggil bukan bukti asal.

## 4. Inti masalah desain (dinyatakan terus terang)
Di bawah RPC **SECURITY INVOKER**, sisipan dari RPC dan sisipan langsung oleh pemanggil yang sama dinilai RLS dengan
konteks identik. **Tidak ada kebijakan RLS untuk `authenticated` yang bisa mengizinkan yang pertama tanpa mengizinkan
yang kedua**, kecuali dengan sinyal asal yang tidak bisa dipalsukan pemanggil. Dengan batasan "tanpa definer
bypass, tanpa service-role, tanpa GUC dari pemanggil", **asal-tulis lewat RPC tidak bisa dijamin** tanpa keputusan
kebijakan tambahan (D1 di §6). Desain di bawah tidak mengklaim aman sebelum keputusan itu.

## 5. Alternatif revisi

| Opsi | Inti | Menjaga asal-tulis RPC? | Catatan / risiko |
|---|---|---|---|
| **R1 (disarankan, butuh D1)** | Penulis sempit: fungsi `SECURITY DEFINER` di skema tidak terekspos (mis. `kamo_import`), **dimiliki role khusus `NOLOGIN NOBYPASSRLS`** (bukan pemilik tabel, bukan `postgres`). RLS tetap berlaku untuk role itu; ia hanya diberi hak + kebijakan SELECT/INSERT pada baris kunjungan bersama dan rekam medisnya. RPC impor publik tetap INVOKER dan memanggil penulis ini untuk dedup + sisip. **Tidak ada kebijakan baru untuk `authenticated`** → anak tidak terbuka. | Ya, untuk jalur cabang aktif. INSERT langsung `authenticated` di cabang aktif tetap ditolak. | Menambah satu role DB (tanpa login, tanpa bypass RLS). Butuh verifikasi Production: skema terekspos Data API, kemampuan `postgres` membuat/menjadi pemilik role, trigger `visits`/`medical_records` berjalan dengan role ini (audit `a01_*`, `protect_*`). |
| R1-ketat (butuh D1 + D2) | R1 + tutup tulis langsung `authenticated` ke baris bersama di semua konteks: hapus disjungsi `legacy... and is_admin()` dari `visits_write`/`mr_write`, dan tambahkan guard restrictive INSERT/UPDATE/DELETE "induk bukan kunjungan bersama" pada anak di §3a. | Ya, di semua konteks. | Mengubah perilaku "Semua cabang" hari ini: OWNER/ADMIN tidak bisa lagi mengedit riwayat bersama/anaknya langsung. Perlu cek apakah ada alur UI yang memakainya. |
| R2 | Pengecualian restrictive berdasar `request.path` = `/rpc/import_legacy_…` (diset PostgREST). | Bergantung semantik PostgREST/Data API. | Tidak disarankan: GUC berasal dari permintaan; reviewer menolak sinyal yang dikendalikan pemanggil; rapuh bila ada jalur selain PostgREST. |
| R3 | Tanpa perubahan; SOP "Semua cabang" sebelum impor. | Tidak (paparan lama tetap). | Tanpa risiko baru; impor jalan; masalah asal-tulis & anak tetap seperti hari ini. |
| Ditolak | Definer milik `postgres`/service-role (bypass), mengosongkan header, `branch_id` lokal, `user_can_access_branch(NULL)` → true, carve-out SELECT/INSERT untuk `authenticated` (revisi 1). | — | Melanggar batas atau membuka anak (§3a). |

## 6. Keputusan yang dibutuhkan sebelum implementasi
- **D1 — boleh menambah role DB `NOLOGIN NOBYPASSRLS` khusus sebagai pemilik satu fungsi penulis?** Tanpa ini,
  syarat "asal-tulis RPC + INVOKER + tanpa bypass + tanpa GUC" tidak bisa dipenuhi bersamaan (§4).
- **D2 — tutup juga tulis langsung OWNER/ADMIN ke riwayat bersama di konteks "Semua cabang" (R1-ketat)?** Kalau
  tidak, paparan lama (§3a baris terakhir, sidik bisa basi lewat edit anak) tetap ada di konteks tanpa header.
- **D3 — visibilitas baca riwayat bersama** (DOCTOR/cabang aktif). Tidak termasuk R1. Bila diinginkan nanti, harus
  didahului pemisahan `operational_parent_isolation` per perintah pada semua anak di §3a (baca boleh ikut induk,
  tulis tidak), supaya membuka baca tidak membuka tulis.

## 7. Batas persis R1 (rancangan; belum ditulis sebagai migrasi)
- Role: `kamo_legacy_import_writer` NOLOGIN NOINHERIT NOBYPASSRLS; tidak diberikan ke pengguna mana pun.
- Skema `kamo_import` (tidak ada di skema terekspos Data API; diverifikasi read-only di Production sebelum rilis).
- Fungsi `kamo_import.simpan_kunjungan_bersama(<isi baris>, p_customer_id, p_pet_id)` SECURITY DEFINER,
  `search_path=''`, pemilik role di atas, EXECUTE hanya untuk `authenticated` (dipanggil RPC publik). Di dalamnya:
  1. `auth.uid()` = profil **aktif** OWNER/ADMIN; selain itu tolak.
  2. Header cabang: bila ada, wajib `user_can_access_branch(header)` true (cabang aktif & berhak); konteks tidak
     dipalsukan dan tidak dihapus.
  3. Kunci sumber: tidak kosong, panjang dibatasi; **sidik dihitung ulang di server** dari isi (bukan dari pemanggil).
  4. Ambil `customer_identity_lock` (re-entrant dengan RPC), cari jejak persis/setara dengan aturan `20261101100000`
     (identik → sudah ada; beda → bentrok; tanpa sidik → belum terbukti; >1 → gagal tertutup).
  5. Validasi identitas: anabul milik pelanggan; pelanggan ada; kunci HP pelanggan = kunci HP baris kecuali pilihan
     manusia eksplisit (aturan pilihan sama seperti sekarang).
  6. INSERT `visits` (`branch_id NULL`, kunci, sidik) + `medical_records`. Tidak ada UPDATE/DELETE.
- Hak role: SELECT, INSERT pada `visits`, `medical_records`; SELECT pada `customers`, `pets`; EXECUTE fungsi
  pembantu yang diperlukan. Kebijakan TO role itu:
  - `visits` SELECT `using (branch_id is null and legacy_source_key is not null)`;
    INSERT `with check (branch_id is null and legacy_source_key is not null and legacy_source_hash is not null)`.
  - `medical_records` INSERT `with check (exists(induk bersama))`; tanpa SELECT/UPDATE/DELETE.
  - `customers`/`pets` SELECT seperlunya untuk validasi.
- RPC publik (`import_legacy_medical_records_bulk`, `import_legacy_medical_record_resolved`) tetap SECURITY INVOKER,
  tetap membuat/memakai pelanggan & anabul di bawah RLS pemanggil, tetap memegang kunci identitas, lalu memanggil
  penulis. **Tidak ada kebijakan baru untuk `authenticated`** pada `visits` maupun anak.

## 8. Rancangan tes (test-first; semua dengan `request.headers` diisi seperti server aplikasi kecuali disebut)
Positif (gagal di `main`, lulus sesudah): OWNER & ADMIN aktif, cabang aktif — massal & per baris tersimpan; kirim
ulang `sudah_ada`; 08↔62 `sudah_ada`; >1 kecocokan historis gagal tertutup; bentrok isi ditahan; balapan C1–C15
(dengan header) tetap 1 kunjungan / 1 pelanggan.

Negatif (harus DITOLAK atau 0 baris; sidik `visits.legacy_source_hash` & isi rekam medis tetap sama setelah percobaan):
- Anak langsung oleh OWNER/ADMIN di cabang aktif: UPDATE/DELETE `medical_records` riwayat bersama; ubah `visit_id`
  rekam medis ke/dari kunjungan bersama; INSERT tambahan `medical_records`, `prescription_items`, `compounding_*`,
  `consents`, `inpatient_records`, `visit_operational_events`, `visit_referrals` yang menempel ke kunjungan bersama.
- `visits` langsung oleh OWNER/ADMIN di cabang aktif: INSERT baris bersama (kunci kosong, palsu, sidik palsu);
  UPDATE/DELETE baris bersama.
- Lewat fungsi penulis/RPC: kunci kosong; kunci terlalu panjang; sidik dari pemanggil diabaikan (sidik tersimpan =
  sidik hitungan server); identitas tidak cocok (anabul bukan milik pelanggan; HP pelanggan ≠ HP baris tanpa pilihan).
- Peran tidak berhak: STAFF, DOCTOR, FINANCE (dengan & tanpa header); profil OWNER/ADMIN `is_active=false`.
- Konteks: header ke cabang nonaktif; header ke cabang yang tidak diizinkan; kapabilitas `all_branches` ADMIN
  diaktifkan/dinonaktifkan lewat `role_capabilities` (hasil impor tidak bergantung padanya; negatif tetap negatif).
- Pemanggilan langsung fungsi penulis oleh `anon` ditolak; skema `kamo_import` tidak bisa dicapai lewat Data API
  (diverifikasi konfigurasi, bukan diasumsikan).
- Regresi: seluruh harness impor lama (tanpa header) + `scripts/test-employee-account-context-postgres.py`.
- Bila D2 disetujui: kasus anak/visits langsung di atas diulang **tanpa header** dan harus ditolak.

## 9. Di luar scope
Namespace fixture XLSX; visibilitas baca (D3); paparan lama FINANCE menulis baris `branch_id NULL` tanpa header
(`user_can_access_branch(NULL)` true untuk `all_branches`) — dicatat untuk tindak lanjut terpisah; hak TRUNCATE
`authenticated` pada beberapa tabel klinis (tidak terjangkau Data API, dicatat saja).

## 10. Batas
Tidak ada service-role, bypass/disable RLS, penghapusan header, perluasan peran pengguna, perubahan riwayat bersama
menjadi lokal, migrasi/penulisan Production, impor pasien nyata, atau pembersihan data. Implementasi menunggu review
independen revisi ini dan keputusan D1/D2.
