# HRIS — cabang utama & akhir penugasan (temuan audit T1, T2, R1)

Tanggal: 29 Oktober 2026 · Branch: `hermes/hris-cabang` ·
Migrasi: `supabase/migrations/20261031180000_hris_cabang_penugasan.sql`

Catatan teknis pendamping laporan audit `kamo-audit-hris-report.md`. Semua angka di
dokumen ini adalah hitungan; tidak ada nama, NIK, atau nomor HP siapa pun.

---

## 1. Keputusan desain: riwayat penugasan pada tabel ber-PK gabungan

`employee_branch_assignments` memakai primary key `(employee_id, branch_id)`. Artinya
satu pasangan orang+cabang hanya boleh punya **satu** baris, sehingga beberapa periode
penugasan untuk pasangan yang sama tidak bisa disimpan sebagai baris terpisah tanpa
membongkar PK itu beserta seluruh pembacanya (RPC klinik, trigger penjual, RLS, dan
lima layar aplikasi).

**Yang dipilih — buka kembali baris yang sama, simpan periodenya di tabel jejak.**

- Mengakhiri penugasan mengisi `end_date`, `ended_at`, `ended_by`, `ended_reason`
  pada baris yang sudah ada.
- Menugaskan ulang orang yang sama ke cabang yang sama mengosongkan keempat kolom itu
  dan mengisi `effective_date` dengan tanggal mulai yang baru
  (`assign_employee_secondary_branches`, bagian `on conflict ... do update`).
- Setiap peristiwa dicatat di `employee_branch_change_log`
  (`primary_branch` / `assignment_ended` / `assignment_reopened`) dengan pelaku,
  waktu, cabang lama → cabang baru, tanggal, dan alasan. Tabel itu hanya bisa
  **dibaca** OWNER/ADMIN; penulisannya khusus lewat RPC `SECURITY DEFINER`.

**Yang tidak dipilih dan alasannya**

| Alternatif | Alasan ditolak |
|---|---|
| Ganti PK jadi `id` surrogate + beberapa baris per pasangan | Menyentuh 11 fungsi database berjalan, 1 RLS privat, dan 5 layar sekaligus. Risiko rilisnya jauh di atas manfaat untuk 204 baris penugasan. |
| Hapus baris saat penugasan selesai | Riwayat hilang; komisi dan jadwal lama tidak bisa dijelaskan ulang. |
| Tambah kolom `periode` ke PK | Pembaca klinik harus memilih periode yang benar di setiap query; salah pilih = petugas hilang dari kasir tanpa peringatan. |

Konsekuensi yang disadari: **riwayat rinci per periode ada di tabel jejak, bukan di
tabel penugasan.** Layar HRIS menampilkan periode yang sedang berlaku; periode lama
dibaca dari jejak. Bila kelak dibutuhkan laporan "siapa pernah ditugaskan di cabang X
antara bulan A dan B", sumbernya adalah `employee_branch_change_log`.

---

## 2. Satu definisi "penugasan sedang berlaku"

```
public.employee_assignment_current(p_effective date, p_end date)
  = p_effective <= hari ini (WIB) AND (p_end IS NULL OR p_end >= hari ini (WIB))
```

Fungsi ini menggantikan perbandingan `effective_date <= today` yang sebelumnya
disalin-tempel di delapan fungsi database. Tambalannya memakai jangkar eksak di atas
definisi berjalan (`pg_get_functiondef` + `replace`), gagal tertutup bila definisinya
sudah berubah, dan dilewati bila sudah terpasang.

Fungsi yang ditambal:

| Fungsi | Dipakai untuk |
|---|---|
| `clinic_demo_care_staff` | daftar petugas kunjungan (DEMO) |
| `clinic_save_initial_record` | dokter penanggung jawab rekam medis awal |
| `set_visit_service_state` | pelaksana kunjungan |
| `clinic_staff_name` | petugas rawat inap |
| `normalize_service_performers` | dokter/non-dokter per baris jasa & barang |
| `guard_clinic_line_salesperson` | penjual SKU di invoice klinik |
| `guard_clinic_record_seller` | penjual resep |
| `change_master_data_lifecycle` | penugasan yang sudah berakhir tidak lagi mengunci Nonaktifkan/Sampah |

Pembaca di aplikasi yang ikut disaring: `loadServiceStaff` (kasir & klinik),
`daftarDokter` (pendaftaran), `daftarPenjual` + `penjualValid` (penjual SKU),
papan Jadwal HRIS, dan papan Jadwal Dokter klinik.

**Sengaja TIDAK disaring:** `private.can_manage_hris_employee`. Fungsi itu menentukan
siapa yang boleh *mengelola* seorang karyawan, bukan siapa yang boleh dipilih sebagai
petugas. Kalau penugasan yang berakhir ikut dibuang dari sana, seorang ADMIN cabang
yang baru saja mengakhiri penugasan langsung kehilangan akses ke orang itu dan tidak
bisa membatalkan tindakannya sendiri. Sisa risikonya kecil dan hanya menyangkut hak
ubah data HR, bukan transaksi.

---

## 3. Keluhan "penugasan lintas cabang loading-nya lama"

Pengukuran 29 Okt (Production, hanya baca): RPC `assign_employee_secondary_branches`
~0,14 detik, query karyawan/penugasan ~3 milidetik masing-masing. Jadi waktunya bukan
di database.

Penyebabnya ada di jalur aplikasi: form penugasan menempel di halaman daftar Karyawan,
dan aksinya diakhiri `redirect("/hris/karyawan?success=assignment")`. Setiap simpan
karena itu memaksa **render ulang seluruh halaman daftar** — semua karyawan, semua
penugasan, gaji pokok per batch, plus tabel ratusan baris — hanya untuk menampilkan
satu baris pesan sukses.

Perubahannya:

1. Form penugasan pindah ke halaman kecil `/hris/karyawan/penugasan`.
2. Aksinya mengembalikan pesan (`useActionState`), bukan `redirect`.
3. Pemeriksaan peran di `master-guard` dimemo per permintaan (`cache` dari React).
   Satu halaman tadinya memanggil tiga guard yang masing-masing melakukan
   `auth.getUser()` + satu baca `profiles`.
4. Pembacaan master di halaman daftar digabung jadi satu `Promise.all`.

Hitungan perjalanan ke server (dihitung dari jalur kodenya, bukan instrumentasi live):

| Peristiwa | Sebelum | Sesudah |
|---|---|---|
| Simpan satu penugasan | 13 (3 aksi + 10 render ulang daftar lengkap) | ≤ 8 (3 aksi + ≤ 5 render halaman kecil) |
| Buka daftar Karyawan | 10 | 6 |
| Halaman yang dirender setelah simpan | daftar penuh (113 karyawan, 204 penugasan, 113 gaji pokok) | halaman penugasan (tanpa gaji pokok, tanpa tabel direktori) |

Tidak ada perubahan database untuk bagian ini.

---

## 4. Angka Production per 29 Okt 2026 (hitungan saja)

- 113 karyawan aktif; 88 tanpa cabang utama; 56 tanpa cabang utama sekaligus tanpa
  penugasan apa pun.
- 204 baris penugasan: 26 PRIMARY, 178 SECONDARY, 0 berakhir (kolomnya memang baru).
