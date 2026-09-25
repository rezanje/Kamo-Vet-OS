# BUG-07 — Pembelian Aset Tetap, Tahap 1

## Temuan repo

Di `main` pada `58d9e6f`, halaman aset sudah ada. Form lama mencampur pembelian baru dan saldo awal, memakai saldo awal sebagai pilihan awal, lalu memanggil `postJournal` best-effort setelah aset disimpan. Kegagalan jurnal dapat meninggalkan aset tanpa jurnal.

Branch `codex/p0-p2-stabilization` menambahkan form terpisah dan pembelian aset sebagai baris faktur langsung. Branch itu divergen dari `main`; perubahan faktur langsung menyentuh jalur yang juga sedang berubah di BUG-04. Perubahan lama tidak disalin wholesale.

## Batas tahap ini

- Pisahkan pembelian baru dari saldo awal pada halaman aset.
- Pembelian baru hanya memakai Kas atau Bank, mengikuti peta rekening aktif yang sudah ada.
- RPC `SECURITY INVOKER` menyimpan aset dan jurnal berimbang dalam satu transaksi; kegagalan jurnal membatalkan aset.
- Validasi kategori aktif, akun aset/rekening aktif, akses cabang, nominal, dan periode tutup buku.
- Saldo awal tetap tidak membuat jurnal historis.

## Belum termasuk

Aset sebagai baris faktur pembelian langsung, sumber Hutang Usaha, edit/void/reissue pembelian aset, serta alur pending/idempotensi lintas formulir. Item tersebut perlu tahap dan review terpisah. Tidak ada perubahan data produksi atau backfill.

## Validasi lokal

- Unit test validasi dan baris jurnal.
- PGlite dengan role `authenticated`: transaksi sukses, akun sumber tidak valid ditolak, dan periode terkunci membatalkan aset+jurnal.
- `npm test`, `npx tsc --noEmit`, lint, dan build lulus. Lint/build masih menampilkan warning lama di area lain.
- Belum diuji pada Supabase lokal penuh atau dengan dua sesi konkuren.
