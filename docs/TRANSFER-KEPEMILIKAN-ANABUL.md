# Transfer kepemilikan anabul

Disepakati: pindah penuh ke pelanggan terdaftar; identitas anabul dan seluruh
rekam medis tetap utuh. Tagihan, transaksi, dan poin pelanggan asal tidak diubah.

## Penggunaan

CRM → Pelanggan → pilih pelanggan → data anabul → Transfer pemilik.
Owner/admin memilih pelanggan tujuan melalui nama/telepon, memeriksa ringkasan,
kemudian mencentang konfirmasi dan menyimpan. Riwayat menampilkan pemilik asal,
pemilik tujuan, waktu WIB, dan petugas. Hak lihat rekam medis tetap mengikuti
pembatasan cabang yang sudah ada; transfer tidak membuka akses cabang baru.

## Implementasi dan verifikasi

- Migration: `20260914131111_pet_ownership_transfer.sql`.
- RPC memakai hak pemanggil dan mengunci kartu anabul untuk menolak halaman basi.
- Trigger mencatat pergantian owner dalam transaksi yang sama, termasuk direct
  update. Catatan tidak dapat ditulis/diubah/dihapus lewat akun aplikasi.
- Hanya OWNER/ADMIN; anabul harus aktif; nama kembar pada tujuan ditolak.
- PostgreSQL 16 lokal, database kosong terpisah: jalankan
  `psql -v ON_ERROR_STOP=1 -f supabase/tests/pet_ownership_transfer.sql`.
  Fixture ini khusus database uji kosong, jangan jalankan di produksi.
- Uji berhasil: owner berubah, 10 kunjungan tetap, pelanggan penanggung tagihan
  tetap, nilai invoice/poin tetap, audit benar, halaman basi ditolak, owner sama
  ditolak, staf ditolak lewat RPC maupun update langsung, audit tidak bisa dihapus,
  dan kegagalan nama kembar membatalkan perpindahan serta audit.
- TypeScript dan lint fitur lolos. Pengujian browser login belum dilakukan.

## Aktivasi

Kode dan migration disiapkan lokal. Terapkan migration lalu rilis kode sebelum
dipakai di produksi; jika migration belum ada, formulir diblok dengan pesan.
Uji browser menggunakan data uji yang disetujui, bukan memindahkan hewan pelanggan
nyata. Tindakan ini belum mengaktifkan portal login untuk pemilik hewan.

Referensi implementasi: https://supabase.com/docs/guides/database/functions
dan https://nextjs.org/docs/app/api-reference/directives/use-server.
