# Peran Admin Umum (ADMIN_UMUM)

Permintaan Andri, 26 Nov 2026: "ROLE admin umum khusus", akses tetap lengkap, diatur Owner, terutama di Jurnal Umum.

## Apa ini
- Nilai baru `user_role = 'ADMIN_UMUM'`, label **Admin Umum**. Hanya OWNER yang bisa menetapkannya ke akun (Pengaturan → Pengguna → Tambah/Edit pengguna → Peran).
- Bawaan: SAMA seperti ADMIN tanpa pengaturan Akses Grup tersimpan (semua menu, semua cabang, tindakan "bawaan-boleh"). Berbeda dengan akun ADMIN di hosted yang sudah dikustomisasi: Admin Umum **tidak** menyalin kustomisasi itu.
- Diatur terpisah di Pengaturan → Akses Grup → pilih "Admin Umum" (menu, sub-menu, tindakan, kemampuan, cabang). Hanya OWNER yang dapat menyimpan.
- Tidak setara OWNER: setiap daftar "OWNER + ADMIN" tetap memuat OWNER; Admin Umum hanya ditambahkan di sebelah ADMIN. Peran istimewa (OWNER/ADMIN/ADMIN_UMUM) hanya bisa dibuat/diubah/dibuka oleh OWNER.
- BUKAN Admin Online: pagar Admin Online tetap menolak `ADMIN_ONLINE`.

## Tombol Jurnal Umum (Akses Grup → Tindakan → "Jurnal Umum"; hanya tampil untuk Admin Umum)
- `jurnal.lihat` — membuka halaman Jurnal Umum. Dicabut: halaman menampilkan pesan terkunci. (Penegakan di layar; data jurnal tetap terbaca lewat modul/laporan lain sesuai Akses Grup.)
- `jurnal.buat_manual` — membuat jurnal manual. Dicabut: ditolak DI DATABASE (`create_manual_journal_atomic`).
- `jurnal.koreksi_manual` — koreksi/batalkan jurnal manual. **Izin khusus, bawaan MATI** (sama seperti ADMIN hari ini: hanya OWNER). Harus dicentang eksplisit. Ditegakkan di database (`revise_manual_journal`).
- `jurnal.lihat_semua_sumber` — bila dimatikan, layar Jurnal Umum hanya menampilkan jurnal manual (manual, koreksi, pembalik), bukan yang otomatis dari kasir/klinik/pembelian. Penegakan di layar.

## Cara kerja di database
Migrasi `20261214100000_admin_umum_enum.sql` (hanya nilai enum) lalu `20261214100100_admin_umum_role.sql`.
`admin_umum_private.terapkan_semua()` menulis ulang DEFINISI HIDUP semua fungsi dan kebijakan RLS yang menyebut `'ADMIN'` agar memuat ADMIN_UMUM di sebelahnya (gagal tertutup untuk bentuk tak dikenal); `kembalikan_semua()` kebalikannya (dipakai ROLLBACK.sql).

### Wajib untuk migrasi berikutnya
Migrasi baru yang menambah fungsi/kebijakan yang menyebut `'ADMIN'` dan dipasang SESUDAH migrasi ini TIDAK otomatis memuat ADMIN_UMUM. Cara termudah: tulis `ADMIN_UMUM` di sebelah `ADMIN` di migrasi itu, atau jalankan sebagai pemilik: `select * from admin_umum_private.terapkan_semua(true);` (lihat apa yang kurang) lalu `select * from admin_umum_private.terapkan_semua(false);` (idempotent). Jalankan juga `select admin_online_private.fence_all(); select admin_online_private.guard_all();` bila ada tabel/fungsi baru. Tes pemindai `peran-admin-sebaran.test.ts` menggagalkan build bila ada daftar peran di aplikasi yang menyebut "ADMIN" tanpa "ADMIN_UMUM".

## Sengaja tidak diubah
- CHECK `approval_rules_penyetuju_role_check` (penyetuju tetap OWNER/ADMIN/FINANCE); Admin Umum memakai antrean ADMIN lewat `peranPenyetujuEfektif()`.
- DEFAULT `reader_roles` log aktivitas (dipetakan di pembaca `activity_log_reader_guard`).
- Skema platform Supabase (auth, storage, realtime, dst.).
- Migrasi tidak memberi peran ini ke akun mana pun.
