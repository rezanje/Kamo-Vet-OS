# Ranap: "klik Pulangkan tapi pasien masih ada" (11 Nov 2026)

## Laporan
Staf klinik: di daftar Rawat Inap, tombol **Pulangkan** sudah diklik tapi pasien masih tampil di
"Sedang Dirawat".

## Penyebab (bukan kerusakan data)
1. Tombol **Pulangkan** di daftar (muncul untuk pasien "Lunas, belum dipulangkan") sengaja hanya
   pintasan ke kartu *Ubah Kondisi* di halaman detail. Tidak memulangkan apa pun.
2. Di kartu *Ubah Kondisi*, pilihan bawaan = kondisi saat ini. Kalau staf langsung menekan
   **Simpan Kondisi** tanpa mengganti pilihan, aksi `changeCondition` kembali ke halaman
   **tanpa pesan apa pun** — terlihat seperti berhasil.
3. Warna gelap pada pilihan kondisi selalu menandai kondisi *tersimpan*, bukan yang sedang
   dicentang. Mengklik "Sembuh / Boleh Pulang" hanya memindah titik radio kecil; pil "Stabil"
   tetap menyala, jadi pilihan baru terlihat belum terpilih.

Pemulangan yang sebenarnya (kolom `discharged_at`) hanya ditulis oleh RPC
`clinic_change_inpatient_condition` saat kondisi baru = sembuh / rip / pulang_paksa. Jalur DB
tidak diubah.

## Perbaikan
- Daftar: tombol Pulangkan → `/klinik/rawat-inap/{id}?pulang=1#ubah-kondisi`.
- Detail: dengan `pulang=1` (pasien aktif, kondisi bukan terminal) pilihan "Sembuh / Boleh
  Pulang" dicentang otomatis + banner "Pasien **belum** dipulangkan … tekan Simpan Kondisi".
  Tidak ada penulisan saat halaman dibuka.
- Detail: pil kondisi menyala mengikuti radio yang dicentang (`.kondisi-opsi:has(input:checked)`
  di `globals.css`); kondisi tersimpan ditandai "(saat ini)".
- Detail: keterangan tetap "Pasien keluar dari daftar Sedang Dirawat setelah kondisi Sembuh /
  Pulang Paksa / RIP disimpan".
- Detail: pesan sukses setelah pulang → "Pasien sudah dipulangkan … tidak tampil lagi di daftar
  Sedang Dirawat".
- Aksi: simpan tanpa mengganti kondisi → pesan error "Kondisi belum diganti — pilih kondisi baru
  …", RPC tidak dipanggil.

## Tes
- Baru: `src/components/__tests__/inpatient-change-condition-action.test.ts` (kondisi sama →
  pesan + tanpa RPC; Sembuh → RPC pemulangan).
- Tambahan: `inpatient-handoff-page.test.tsx` (pulang=1 mencentang Sembuh + banner; tanpa
  pulang=1 tetap kondisi saat ini; penanda "(saat ini)").
- Diubah: `rawat-inap/page.test.tsx` (href pintasan).
- Seluruh vitest: 887 file lulus (4 skip), 8256 tes lulus. eslint 0 error. `tsc --noEmit` lulus.
  `next build` lulus.

## Sisa / belum diuji
- Belum dicek di data Production (akses database tidak tersedia di sesi ini) apakah ada pasien
  lama berkondisi "Sembuh" tapi `discharged_at` kosong. Kalau ada, pasien itu tidak bisa
  dipulangkan lewat "Sembuh" lagi (kondisi sama); jalan pintas sementara: ubah ke Stabil lalu ke
  Sembuh. Query cek:
  `select id, visit_id from inpatient_records where discharged_at is null and condition_status in ('sembuh','rip','pulang_paksa');`
- Belum ada uji langsung oleh staf klinik (UAT).
