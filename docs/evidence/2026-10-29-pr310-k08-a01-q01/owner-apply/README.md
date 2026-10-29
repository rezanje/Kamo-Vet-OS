# PR #310 (K08 + A01 + Q01) — paket langkah database untuk pemegang akses production

**Belum ada yang dijalankan ke production.** Jalankan dengan akses owner Supabase (`postgres`), berhenti di langkah
mana pun yang hasilnya tidak sesuai. Repo ini bisa terbaca pihak lain: **jangan menulis ID project, jumlah data,
atau keluaran query production ke repo/PR** — catat di catatan rilis privat.

## Urutan rilis

Disarankan: **01 → 02 → 03 → merge PR #310 → cek layar.** Aplikasi baru tetap aman bila terdeploy lebih dulu
(fungsi pemulihan quest yang belum ada hanya dicatat di log server dan dilewati), tapi perbaikan K08/A01/Q01 baru
aktif setelah langkah database.

## File

| Urutan | File | Menulis? | sha256 |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | `dc33c3bfc751596a59dacef1e5c8853eae49c79f57bb1e87a5a7a455272637d5` |
| 2 | `apply.sql` | **ya** — satu transaksi | `8dc926ec209fbf4ca923d33496173359d6eb3a736408ec9b13464ae5c0609476` |
| 3 | `readback.sql` | tidak | `1ff1d0343ac3e3f94ba7795853ef16b7e009da610124a75f97b2277fa82eaa45` |
| — | `rollback.sql` | **ya** — hanya bila diputuskan mundur | `d4185110bc1ddde2b3338f6931bb50413b6c4dcb97a8f4cfc602d1a7ed84439a` |

`apply.sql` dihasilkan `build-and-rehearse.py` dari tiga migrasi berikut (jangan diedit tangan):

| Migrasi | sha256 |
|---|---|
| `20261030110000_k08_inpatient_redischarge_days.sql` | `d37c6ca56ad46cf6d2d5dbdcd704709f9b682756273e0f126b2892c1ad04df3e` |
| `20261030111000_a01_activity_audit_new_sources.sql` | `0c952e8060a1a9b22f5828fbeb2ac11bb243fdf10b8a727ceab9b1e57457b0d8` |
| `20261030112000_q01_staff_effects_recovery.sql` | `1c30c39adc94d69584f3076afcee73cb6b6f5dd71789ac72d9ad6e23df92f1f6` |

## Dampak

- **K08:** `clinic_change_inpatient_condition` diganti (signature, SECURITY DEFINER, search_path, hak akses sama).
  Pemulangan ulang menagih semua periode rawat inap; buka ulang ranap ditolak bila ada invoice aktif. Pembaca peran
  sesi memakai `auth.role()` — sama dengan perbaikan PR #315, jadi aman baik #315 sudah maupun belum terpasang
  (baris `info` di preflight menunjukkan mana).
- **A01:** 16 tabel masuk daftar log aktivitas + trigger ubah/hapus; 3 tabel refund/riwayat mendapat trigger hapus.
  Tidak ada baris data yang diubah.
- **Q01:** `apply_sale_staff_effects` ditambal di dua titik (periode = hari bayar WIB, streak tidak mundur); fungsi
  baru `apply_pending_sale_staff_effects()` + index parsial di `sales` (dibuat tanpa `concurrently`, mengunci tulis
  `sales` sebentar selama index dibangun).
- **Cadangan untuk rollback:** sebelum mengubah apa pun, `apply.sql` menyimpan definisi dua fungsi yang ditambal,
  definisi trigger `a01_*` yang sudah ada, dan daftar sumber log yang sudah ada ke `vetos_release.pr310_backup`
  (skema privat, tidak bisa dibaca pengguna aplikasi).
- `lock_timeout 5s`, `statement_timeout 120s`; gagal kunci = semua batal, bisa diulang nanti.

## Langkah

Jalankan dengan `psql -X -v ON_ERROR_STOP=1 -f <file>`. Di SQL editor Supabase: `apply.sql`/`rollback.sql` dijalankan
utuh; untuk `preflight.sql`/`readback.sql` pilih dan jalankan hanya statement `with … select …`.

1. **`preflight.sql`** — semua baris ber-nilai harapan `ok = true`, baris terakhir `SUMMARY | 0 failed`. Bila ada yang
   gagal: **berhenti**, belum ada yang berubah.
2. **`apply.sql`** sekali. Sukses = tanpa error. `PR310_ALREADY_APPLIED` = sudah terpasang → lanjut ke langkah 3.
   Error lain = tidak ada yang terpasang.
3. **`readback.sql`** — `SUMMARY | 0 failed`.
4. Merge PR #310, tunggu deploy, lalu cek (OWNER): dashboard tampil normal; Kas & Bank → Refund tampil; laporan
   Transaksi per Cabang tampil; ubah kondisi pasien rawat inap berhasil (bukan "akses cabang").

**Rollback** (hanya atas keputusan mundur): jalankan `rollback.sql` utuh. Dua fungsi kembali persis seperti sebelum
apply, trigger `a01_*` kembali ke keadaan semula, fungsi/index Q01 dan baris riwayat dihapus. Log aktivitas yang
sudah tercatat tetap ada.

## Gladi bersih

`rehearsal-pg16.log` (PostgreSQL 16 lokal, data fiktif): semua migrasi lain (termasuk yang lebih baru di main) →
preflight → apply → readback → apply ulang ditolak tanpa perubahan → rollback (fungsi identik byte-per-byte, trigger,
sumber, riwayat, index, skema kembali seperti sebelum apply) → preflight → apply → readback → 7 suite SQL K08/A01/Q01
lulus. Ulangi dengan:

```
LC_ALL=C.UTF-8 python3 -B docs/evidence/2026-10-29-pr310-k08-a01-q01/owner-apply/build-and-rehearse.py [pg bin dir]
```
