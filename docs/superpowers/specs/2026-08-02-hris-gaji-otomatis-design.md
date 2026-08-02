# HRIS — jadwal shift, absen berlokasi, pengajuan staf, gaji otomatis

Tanggal: 2026-08-02 · Status: disetujui boss (2026-08-02)

## Masalah

HRIS yang ada sekarang: data karyawan, absensi masuk/pulang, pengajuan cuti + approval, KPI,
slip gaji, 3 laporan. Yang bikin rapuh:

1. **Slip gaji seluruhnya diketik manual** — `payrolls` cuma punya `gaji_pokok`, `tunjangan`,
   `potongan`, `total`. Tiap bulan diketik ulang per karyawan, rawan salah, tidak ada jejak
   angka itu dari mana.
2. **Absensi tidak nyambung ke gaji.** Telat, bolos, lembur tercatat tapi tidak berpengaruh
   sepeser pun.
3. **Tidak ada jadwal shift.** Telat diukur dari satu jam kantor global
   (`company_settings.jam_masuk_standar`), padahal cabang buka sampai malam.
4. **Absen bisa dari mana saja** — tidak ada pengecekan lokasi.
5. **Tidak ada kasbon & reimburse** sama sekali.
6. Jurnal gaji selalu keluar dari **Kas tunai (1101)** yang di-hardcode, padahal gaji ditransfer.

## Keputusan yang dikunci boss

- Lembur **harus diajukan & di-approve**, bukan otomatis dari jam pulang.
- Kasbon **boleh dicicil** beberapa bulan; tenor ditentukan saat approve.
- Jadwal pakai **master shift + tempel ke tanggal**; telat diukur dari shift orang itu.
- Semua nominal (potongan telat, tarif lembur, radius meter) **diatur boss di aplikasi**,
  tidak dikunci di kode.
- **PPh21, BPJS, dan verifikasi wajah tidak termasuk.**

## Rancangan

### Fase 1 — Master & pengaturan

| Tabel baru | Isi |
|---|---|
| `work_shifts` | nama, jam_masuk, jam_pulang, is_libur, warna, branch_id (null = semua cabang) |
| `employee_schedules` | employee_id, tanggal, shift_id — unik per (employee, tanggal) |
| `salary_components` | nama, tipe (`tunjangan`/`potongan`), nominal default, is_active |
| `employee_salary_components` | employee_id, component_id, nominal (override per orang) |
| `payroll_settings` | singleton: potongan telat (blok menit, nominal per blok, mulai menit ke-, batas maksimal), potongan bolos per hari, tarif lembur per jam |

`branches` dapat `lat`, `lng`, `radius_m`.

Layar: `/hris/shift` (master shift), `/hris/jadwal` (papan bulanan per cabang),
`/hris/komponen-gaji`, `/pengaturan/gaji`, koordinat di layar cabang yang sudah ada.

### Fase 2 — Absen berlokasi

Absen di `/me` mengirim koordinat dari browser. Server menolak kalau jarak > radius cabang,
dengan pesan jelas (berapa meter meleset). **Kalau koordinat cabang belum diisi, absen jalan
seperti sekarang** — fitur baru tidak boleh melumpuhkan absensi harian.

Jarak dihitung dengan haversine di `src/lib/lokasi.ts` (murni, teruji).

### Fase 3 — Pengajuan staf

| Tabel baru | Isi |
|---|---|
| `overtime_requests` | employee_id, tanggal, jam, alasan, status, approved_by |
| `cash_advances` | employee_id, tanggal, jumlah, tenor_bulan, status, disbursed_at |
| `cash_advance_installments` | advance_id, periode, jumlah, payroll_id — jejak cicilan yang sudah kepotong |
| `reimbursements` | employee_id, tanggal, kategori, jumlah, keterangan, lampiran, status |

Pengajuan dari `/me`, approval di `/hris/pengajuan`. Kasbon cair → jurnal Dr Piutang Karyawan /
Cr rekening kas; cicilan mengurangi piutang itu lewat slip gaji. Reimburse disetujui →
dibayar bersama gaji, dijurnal ke beban terkait.

### Fase 4 — Slip gaji otomatis

`src/lib/payroll.ts` (murni, teruji) menghitung per karyawan per periode:

```
gaji pokok
+ tunjangan tetap (komponen)
+ lembur disetujui × tarif per jam
+ reimburse disetujui
− potongan telat  (menit telat vs jam shift hari itu → aturan berblok)
− potongan bolos  (hari kerja terjadwal tanpa absen & tanpa cuti disetujui)
− cicilan kasbon periode ini
− potongan tetap (komponen)
= gaji bersih
```

Layar penggajian: tombol **Hitung** menampilkan rincian per karyawan (bisa dibuka untuk lihat
asal angkanya), **masih bisa dikoreksi manual**, baru disahkan. Setelah disahkan: jurnal
otomatis + slip per karyawan bisa dicetak.

`payrolls` ditambah kolom rincian (lembur, potongan telat, potongan bolos, cicilan kasbon,
reimburse) supaya slip bisa dicetak ulang kapan saja tanpa menghitung ulang.

Jurnal gaji memakai **peta rekening** (migrasi 0085), bukan `1101` mati.

## Yang sengaja tidak dikerjakan

- PPh21, BPJS, THR, pesangon.
- Verifikasi wajah / foto absen.
- Approval berjenjang (satu approver saja, sesuai pola cuti yang sudah ada).

## Uji

- Vitest: hitungan potongan telat berblok (batas bawah, batas atas, tepat di kelipatan),
  jarak haversine, cicilan kasbon (pembulatan sisa di cicilan terakhir), gaji bersih.
- Manual di browser tiap fase: buat shift → tempel jadwal → absen telat → hitung gaji →
  angka potongannya cocok dengan aturan.
