# K08 — tagihan rawat inap saat pulang ulang (bagian "tutup/perpanjang rawat inap")

Base: `origin/main` @ `3453183`. Temuan audit 29 Okt: (a) pemulangan ulang hanya menagih periode terakhir;
(b) tes SQL pemulangan rawat inap tidak lulus (celah fixture); (c) kunjungan lama lunas-tapi-belum-selesai
hanya diberi peringatan. Batch ini: (a) dan (b) diperbaiki, (c) tidak disentuh (lihat "Sisa").
Status ID K08: **sebagian** — bagian tagihan pulang ulang selesai di kode; keputusan bisnis untuk
"buka lagi setelah invoice terbit" dan data lama masih terbuka.

## Model tagihan yang berlaku (dibaca dari kode)

- Satu invoice aktif per kunjungan (`invoices_visit_active_key`). Void hanya lewat terbit ulang
  (`clinic_void_reissue_invoice*`), yang langsung membuat invoice aktif pengganti dengan baris yang sama.
- Biaya rawat inap dibuat otomatis oleh `clinic_change_inpatient_condition` saat status menjadi
  `sembuh`/`rip`/`pulang_paksa`: satu baris resep jasa kategori `Rawat Inap`, qty = hari dibulatkan ke atas
  per 24 jam (keputusan Aldi 19 Agustus), tarif = jasa aktif kategori Rawat Inap pertama menurut nama.
- Pulang ditolak bila kunjungan sudah punya invoice aktif (`INVOICE_EXISTS`). Invoice tidak bisa terbit
  selama ada rawat inap terbuka di kunjungan itu (`guard_open_inpatient_invoice`).
- Perpanjang = ubah kondisi dari `sembuh` kembali ke `stabil`/`kritis` (halaman detail rawat inap): stay yang
  sama dibuka lagi (`discharged_at` dikosongkan). Masuk rawat inap kedua di kunjungan yang sama juga diterima
  RPC (`clinic_admit_inpatient` hanya menolak bila ada stay aktif atau kunjungan sudah Selesai); layar rekam
  medis saat ini menyembunyikan tombolnya, tetapi RPC dan data lama tetap bisa memilikinya.
- K06: kunjungan yang sudah lunas/selesai dilanjutkan lewat kunjungan lanjutan dengan invoice sendiri.

## Akar masalah (a)

Saat pulang, fungsi menghitung hari **hanya dari stay yang sedang dipulangkan**
(`v_discharged_at - v_record.admitted_at`), lalu **menghapus** baris biaya rawat inap kunjungan itu dan
menulis baris baru. Bila kunjungan punya stay kedua (masuk lagi setelah pulang, sebelum invoice), baris
periode pertama terhapus dan diganti hari periode kedua saja → hanya periode terakhir yang tertagih.
Penghapusan juga hanya mencocokkan item tarif yang berlaku saat itu, sehingga bila tarif rawat inap berganti
di antara dua pemulangan, baris otomatis lama tertinggal di samping yang baru → hari tertagih dobel.

## Definisi "benar" yang dikunci tes

Karena pulang selalu ditolak saat kunjungan punya invoice aktif, pada saat pulang belum ada satu hari pun
dari kunjungan itu yang tertagih di invoice. Jadi baris biaya rawat inap otomatis kunjungan harus =
**jumlah hari semua stay yang sudah pulang di kunjungan itu**, tiap stay dibulatkan ke atas per 24 jam,
**satu baris**, tarif yang berlaku. Stay yang dibuka lagi lalu dipulangkan tetap satu periode dari jam
masuk sampai pulang terakhir (perilaku lama, tidak diubah). Periode yang sudah masuk invoice tidak pernah
ditagih dua kali: pulang ulang tetap ditolak (`INVOICE_EXISTS`) dan baris yang sudah ditagih tidak disentuh.
Kunjungan lanjutan K06 hanya menagih stay miliknya.

## Perubahan

| File | Isi |
| --- | --- |
| `supabase/migrations/20261029152000_k08_inpatient_rebill_periods.sql` | Patch berjangkar pada definisi live `clinic_change_inpatient_condition` (pola `pg_get_functiondef` + ganti tepat satu jangkar; gagal bila definisi bergeser atau sudah terpasang). Hari = jumlah semua stay pulang di kunjungan; hapus baris otomatis lama kunjungan (penanda `Otomatis dari lama rawat inap:`, semua rekam medis kunjungan, tarif apa pun) + aturan hapus lama; satu baris baru; teks `(N periode)` bila > 1. Owner, SECURITY DEFINER, search_path, ACL tetap. Fungsi ini sebelumnya hanya diganti utuh oleh `20261025180000`; tidak ada patch K02/salesperson/H05/C05 di fungsi ini, dan patch tersebut di fungsi lain tidak tersentuh. |
| `supabase/tests/k08_inpatient_rebill_periods.sql` (baru) | 4 skenario, semua lewat RPC asli sebagai `authenticated`: (1) pulang → masuk lagi di kunjungan sama → pulang: harus 1 baris, 5 hari (3+2), Rp500.000; (2) stay dibuka lagi lalu pulang: 1 baris, 5 hari; (3) periode pertama sudah di-invoice lalu dibuka lagi: pulang ulang ditolak `INVOICE_EXISTS`, baris tetap 1×3 hari; (4) tarif berganti di antara dua pemulangan: 1 baris, 5 hari. |
| `supabase/tests/clinic_inpatient_discharge.sql` | Celah fixture (b): setup memasukkan rawat inap tanpa klaim pengguna dan tanpa dokter PJ, sehingga guard `protect_inpatient_care_staff` menolak sebelum assertion mana pun jalan. Ditambah karyawan dokter + `doctor_id` kunjungan + klaim JWT pengguna OWNER sebelum insert fixture. Guard dan semua assertion tidak diubah; baris PASS ditambahkan. |
| `scripts/test-clinic-billing-consistency-postgres.py` | Runner K08 22 Okt sebelumnya *mengharuskan* tes pemulangan gagal di celah fixture tersebut; kini mengharuskan lulus di definisi lama dan kandidat. |
| `scripts/test-k08-inpatient-rebill-postgres.py` (baru) | Runner disposable: GREEN kandidat, RED setelah rollback paket owner, apply ulang = identitas fungsi identik, apply kedua ditolak, 11 suite SQL terkait. |
| `docs/evidence/2026-10-29-k08-rebill/` | Paket owner, wrapper PG native, gladi, log. |

## Hasil tes (PostgreSQL 16.15 native, C.UTF-8, tanpa Docker)

- RED di main (`sql-red-main-pg16.log`, 303 migrasi main, migrasi K08 belum ada):
  - tes pemulangan asli main: `ERROR: ACCESS_DENIED: pengguna tidak terautentikasi` di `protect_inpatient_care_staff()` (b);
  - tes baru: `ERROR: K08 re-discharge billed 1 line(s) / 2 day(s) / 200000.00; expected 1 line, 5 days (3+2), 500000` (a);
  - probe salinan (assertion skenario 1 saja dijadikan notice): skenario 2 dan 3 lulus di main, skenario 4
    `ERROR: K08 tariff change double-billed: 2 line(s) / 8 day(s); expected 1 line, 5 days`.
  - tes pemulangan yang fixture-nya sudah diperbaiki: PASS (perbaikan fixture tidak bergantung migrasi).
- GREEN (`sql-acceptance-pg16.log`, 304 migrasi): tes baru PASS; RED terbukti lagi setelah rollback; roundtrip
  identik; apply kedua ditolak; 11 suite PASS: k08_inpatient_rebill_periods, clinic_inpatient_discharge,
  inpatient_continuation_pet_hotel, inpatient_consent, clinic_inpatient_action_category, clinic_invoice_post,
  clinic_billing_lifecycle, clinic_procedure_bmhp, clinic_demo_financial_policy, clinic_manual_invoice_units,
  clinic_compound_issue.
- Regresi runner yang ada, semua exit 0: billing-consistency K08 22 Okt (5 suite + roundtrip),
  K06/K14 (termasuk balapan dua sesi), K07 rx-evidence, K02 BMHP (FIFO + moving average).
- Gladi paket owner (`rehearsal-pg16.log`): semua migrasi kecuali K08 → preflight 0 failed, daftar kosong →
  data fiktif bug di-commit dengan definisi lama → Query A menampilkan kunjungan itu (5 hari seharusnya,
  2 tertagih) → apply → readback 0 failed → baris lama tidak diubah → apply kedua ditolak → tes GREEN →
  rollback → preflight bersih lagi, tes RED lagi → rollback kedua ditolak → data pasca-fix: Query A/B kosong,
  Query C menampilkan stay yang dibuka lagi setelah invoice.
- App: `npx vitest run` 557 file lulus / 1 skip, 4110 tes lulus / 1 skip. `tsc --noEmit` exit 0.
  Tidak ada file TS/JS yang berubah, jadi ESLint tidak punya target.
- Belum: PostgreSQL 17, `npm run build`, `Technical checks` CI, uji klik browser, UAT klinik.

## Paket owner (`owner-apply/`)

1. `preflight.sql` — baca saja. Query 1 harus `SUMMARY: 0 failed`. Query A/B/C = daftar data produksi yang
   kena (informasi, bukan penghalang):
   - **A** kunjungan dengan > 1 stay yang baris biaya rawat inap otomatisnya kurang dari total hari semua stay
     (bug ini), lengkap dengan periode, invoice aktif dan status bayarnya;
   - **B** kunjungan dengan > 1 baris biaya rawat inap otomatis (risiko dobel);
   - **C** stay terbuka di kunjungan yang sudah punya invoice aktif (tidak bisa dipulangkan).
2. `apply.sql` — satu transaksi, isi migrasi persis (sha256 dicatat di header) + baris riwayat migrasi.
   Wajib role postgres; lock_timeout 5 dtk. Tidak bisa diulang (ditolak, tanpa perubahan).
3. `readback.sql` — baca saja, harus `SUMMARY: 0 failed`.
4. `rollback.sql` — hanya bila diputuskan mundur: mengembalikan blok lama persis dan menghapus baris riwayat.
   Baris tagihan yang sudah dibuat selama K08 aktif tidak diubah.

Apply tidak mengubah data apa pun; hanya perilaku pemulangan berikutnya.

## Sisa / keputusan yang dibutuhkan

1. **Buka lagi setelah invoice terbit (keputusan bisnis).** Hari ini stay boleh dibuka lagi walau invoice
   kunjungan sudah terbit, tetapi pulang berikutnya ditolak `INVOICE_EXISTS` dan invoice tidak bisa diterbitkan
   ulang selama stay terbuka → stay macet terbuka (Query C). Tagihan tidak dobel, tetapi hari tambahan tidak
   bisa ditagih. Pilihan:
   - A (saran): tolak "buka lagi" bila kunjungan punya invoice aktif, dan arahkan perpanjangan ke kunjungan
     lanjutan K06 (invoice terpisah untuk hari tambahan). Layar rekam medis perlu menawarkan "Lanjutkan ke
     Rawat Inap" walau kunjungan pernah dirawat inap.
   - B: izinkan pulang ulang dan tambahkan hari ekstra ke invoice yang belum lunas (koreksi invoice otomatis);
     invoice lunas tetap lewat K06. Lebih rumit, menyentuh alur kasir.
   - C: biarkan; stay macet diselesaikan manual oleh admin database.
2. **Data lama (Query A/B).** Patch tidak memperbaiki baris lama. Membuka lagi lalu memulangkan stay terakhir
   bukan perbaikan yang aman (jam pulang ikut bergeser ke saat itu). Perlu keputusan per kunjungan: koreksi
   invoice oleh kasir/finance atau skrip perbaikan terjaga terpisah setelah daftar produksi dilihat.
3. **(c) kunjungan lunas tapi belum selesai** — tidak disentuh. Saat ini halaman pembayaran hanya memberi
   peringatan; perbaikan historis butuh keputusan rekonsiliasi terpisah (lihat verifikasi K08 22 Okt).
4. `supabase/tests/atomic_inpatient_daily_log.sql` punya celah fixture yang sama (`ACCESS_DENIED` di
   `protect_inpatient_care_staff` saat setup); tidak termasuk batch ini.
5. Tarif pet hotel tetap memakai tarif Rawat Inap yang sama (catatan K14). Hari dihitung per stay; jeda
   antara pulang dan masuk lagi tidak ditagih, sedangkan stay yang dibuka lagi ditagih dari jam masuk awal
   sampai pulang terakhir (perilaku lama).
6. Query B belum diuji dengan baris positif di gladi (A dan C sudah).
7. Produksi tidak disentuh: tidak ada apply, tidak ada baca data produksi, tidak ada push/PR. Belum ada UAT.
