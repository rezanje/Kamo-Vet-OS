# Rekap Setoran (Andri, 26 Nov 2026)

Migrasi `20261213200000_rekap_setoran.sql` (satu transaksi), layar `/kas-bank/setoran` (back office) dan `/kasir/setoran` (kasir/staf), sub-menu Akses Grup `kas-bank.setoran`.

## Cara pakai
- Petugas toko: **Setoran** (menu kasir) → **Buat periode** (cabang, periode Jumat–Minggu, jadwal Senin, batas jam) → dashboard menampilkan kewajiban, pengeluaran, sudah ditransfer, sisa, progres. Di bawahnya: input **pengeluaran dari dana setoran** (tanggal sendiri, kategori, jumlah, foto nota) dan **setoran ke perusahaan** (cicilan boleh; Transfer wajib foto bukti; Serah tunai tanpa foto). Setelah semua disetor: **Selesai disetor — ajukan penutupan**.
- Finance/Owner/Admin: kotak **Menunggu persetujuan** → buka setoran → **Uang sudah masuk** pada tiap setoran → panel **Penutupan periode** (hanya penyetuju) → **Setujui & tutup periode** atau **Kembalikan ke petugas** (dengan alasan, tanpa nominal).

## Akuntansi (semua jurnal HANYA saat setuju)
- Pengeluaran dari dana setoran: `post_expense_atomic` per baris, beban pada tanggal barisnya, kas laci berkurang, tepat satu kali (kunci `setoran:<id baris>`).
- Selisih = uang masuk terkonfirmasi − (kewajiban − pengeluaran).
- Kurang: Dr 182001 Cashbon Karyawan / Cr Kas laci; satu `cash_advances` berstatus `Dicatat` per karyawan (tanpa potong gaji otomatis), dibagi rata ke kasir shift, bisa ditimpa Finance, atau beban perusahaan 760002 dengan alasan.
- Lebih: Dr Kas / Cr 810004 Pendapatan Diluar Operasional Lain (sama dengan netto SO). Tidak ada offset otomatis ke stok.
- Pas: tanpa jurnal. Void (Owner/Finance): jurnal pembalik, pengeluaran dibalik, kasbon dibatalkan, shift dilepas.
- Selisih tutup shift sudah dijurnal oleh tutup shift → tidak dihitung dua kali (kewajiban memakai `closing_balance − opening_balance`).

## Privasi
Staf melihat kewajiban dan sisa yang harus disetor (sisa dipatok ≥ 0), TIDAK melihat selisih, jenis, lebih, kasbon, jurnal, catatan penyetuju, rekap. Semua tabel dicabut dari klien (RLS tanpa kebijakan, ACL kosong); hasil dibentuk fungsi `SECURITY DEFINER` menurut peran. Admin Online ditolak di setiap fungsi dan tabel (guard_all/fence_all).

## Pengujian
`scripts/test-rekap-setoran-postgres.py` (`--baseline`, default hijau, `--conc`, `--digest`, `--mutations` 60 mutan) + `supabase/tests/rekap_setoran.sql` (350+ pernyataan) + vitest `src/lib/__tests__/setoran.test.ts`, `src/components/setoran/__tests__`.
