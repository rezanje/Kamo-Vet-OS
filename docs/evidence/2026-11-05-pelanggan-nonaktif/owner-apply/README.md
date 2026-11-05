# Pelanggan nonaktif — paket langkah database untuk owner

Belum ada yang dijalankan ke Production. Jalankan dengan akses owner Supabase (SQL editor),
**SEBELUM** merge/deploy aplikasi, dan berhenti bila ada baris yang hasilnya `false`.

> **Urutan wajib: database dulu, baru aplikasi.** Halaman CRM → Pelanggan versi baru membaca kolom
> `customers.is_active`; kalau aplikasi terdeploy sebelum database diterapkan, halaman itu gagal dimuat.
> Pencarian pelanggan kasir/POS/faktur tetap jalan (filter dilewati otomatis bila kolom belum ada).

| Urutan | File | Menulis? | Isi |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | 5 cek (tabel & kolom pengecualian ada, belum/sudah terpasang dengan bentuk sama, nama trigger tidak bentrok) + angka baris 7 tabel + daftar kandidat akun "CS pusat" dengan jumlah struk/kunjungan 30 hari |
| 2 | `apply.sql` | ya | isi persis migrasi `supabase/migrations/20261107100000_pelanggan_nonaktif.sql` dalam satu transaksi; aman diulang |
| 3 | `readback.sql` | tidak | 6 cek (kolom, semua pelanggan lama tetap aktif, trigger di customers + 6 tabel transaksi, hak akses fungsi) + angka baris 7 tabel — harus sama persis dengan preflight |
| — | `rollback.sql` | ya | hanya bila diputuskan mundur, bersama rollback aplikasi. Penjaga dicabut; kolom status **disimpan** bila masih ada pelanggan nonaktif. Hapus permanen hanya bila owner menjalankan dulu `select set_config('vetos.rollback_drop_data', 'yes', false);` di sesi yang sama. Salinan identik: `docs/rollback/2026-11-05-pelanggan-nonaktif.sql` |

`apply.sql` sha256 tercatat di akhir `rehearsal-pg16.log`.

Gladi bersih (PostgreSQL 16 lokal, data fiktif, `rehearsal-pg16.log`): semua migrasi lama → preflight →
apply → readback → apply ulang (readback identik) → satu pelanggan dinonaktifkan (struk baru ditolak) →
rollback tanpa flag (penjaga dicabut, kolom disimpan, struk diterima) → apply lagi (ditolak lagi) →
rollback dengan flag owner (kolom & fungsi bersih) → preflight → apply → readback. Ulangi dengan:

```
python3 -I docs/evidence/2026-11-05-pelanggan-nonaktif/owner-apply/build-and-rehearse.py --pg-bin /usr/lib/postgresql/16/bin
```

## Setelah apply + deploy

1. Owner/Admin buka **CRM → Pelanggan**, cari akun "CS pusat" (centang **Tampilkan nonaktif** kalau sudah
   dinonaktifkan), klik barisnya → **Nonaktifkan pelanggan** → isi alasan (opsional) → **Ya, nonaktifkan**.
2. Cek live: di kasir cabang, ketik "CS pusat" di kolom pelanggan → tidak muncul lagi.
3. Data lama tidak berubah: angka di `readback.sql` sama dengan `preflight.sql`.
