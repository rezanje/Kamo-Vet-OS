# Marketing: Follow up pelanggan (15 Nov 2026)

Halaman `/crm/follow-up` (CRM > "Follow up pelanggan") + kartu dashboard "Perlu follow up". Hanya baca + catatan "Sudah dihubungi".
Tidak ada pengiriman WhatsApp otomatis; `whatsapp_message_log` / `wa_engine` tidak disentuh.

## Empat daftar
| Tab | Siapa yang masuk |
|---|---|
| Lama tidak balik | Transaksi terakhir (penjualan petshop tidak batal, kunjungan klinik tidak diarsipkan) >= 60/90/180 hari lalu, paling lama 730 hari. Urut total belanja, jumlah kunjungan, lalu yang paling baru lewat. Cabang = cabang transaksi TERAKHIR. |
| Grooming | Hewan yang grooming terakhirnya + 21/30/45 hari (bawaan 30) sudah lewat, atau jadwal follow up Grooming dari dokter (Menunggu). Layanan grooming = baris Jasa (tagihan klinik `jenis='jasa'`, kasir petshop item Jasa/Grup) yang kategorinya `Grooming` ATAU namanya memuat "grooming" (bukan "konsultasi"/"registrasi"; shampoo/sisir = Persediaan tidak dihitung). Sinyal tambahan "riwayat kunjungan": poli Grooming / keluhan menyebut grooming. Maks. 365 hari ke belakang. |
| Hari ini | `follow_ups` status Menunggu yang tanggalnya <= hari ini (+0/1/3/7 hari), satu pemilik satu kartu. Tautan ke "Follow up klinik" (halaman lama tetap tempat menandai Selesai/Batal). |
| Pelanggan baru | Datang tepat satu kali, pertama 30-60 hari lalu. |

Dikecualikan: pelanggan disembunyikan (`hidden_at`), nama persis tes/test/testing/dummy/coba/uji, nomor HP tidak sah (dihitung "tanpa nomor"),
pemilik yang semua hewannya Mati/Meninggal/Pindah/Nonaktif/Hilang, pelanggan dengan kunjungan klinik belum selesai (daftar lama tidak balik/grooming/baru).

## Sudah dihubungi
`marketing_followup_log` (hanya bisa ditambah; RPC `marketing_log_contact`, kunci anti-dobel). Hasil: Tertarik / Tidak diangkat / Nanti / Tidak berminat / Nomor salah.
Masa tunggu 14 hari (bisa 7/14/30); Tidak berminat dan Nomor salah 90 hari. Dalam masa tunggu = "Sudah dihubungi" (tersembunyi dari "Belum dihubungi").

## Akses
Sub-menu Akses Grup `crm.follow-up-pelanggan` (modul CRM). Bawaan MATI untuk selain OWNER (nomor HP = data pribadi). OWNER selalu boleh, tanpa membaca tabel kebijakan.
Peran lain: dicentang di Akses Grup > peran > CRM. Fungsi database `marketing_followup_allowed()` memeriksa hal yang sama (bukan hanya menu).
Unduh Excel: OWNER dan ADMIN saja.

## Batas data
- Rincian belanja/tagihan hanya ada sejak 1 Nov 2026; kunjungan klinik impor (2022+) tidak punya cabang dan tidak punya rupiah.
  Maka pelanggan lama hampir semua "Tanpa cabang (riwayat impor)" dengan total belanja Rp0; urutan memakai jumlah kunjungan.
- Pengingat grooming akurat mulai ~1 Des 2026 (30 hari setelah rincian mulai) dan makin baik seiring waktu.

## Teknis
Migrasi `20261121100000_marketing_follow_up.sql`: fungsi baca SECURITY DEFINER (supaya "terakhir datang" melihat semua cabang), output dibatasi
cabang terakhir yang boleh diakses pemanggil (`user_can_access_branch`). Uji native PG17: `scripts/test-marketing-follow-up-postgres.py`.
