# Struk WA otomatis setelah bayar di klinik — hasil cek 14 Nov 2026

Pemicu: komplain owner pelanggan (grup Kamo ERP Dev, Aldi, 14 Nov 06.42) — bayar debit hanya dapat
struk EDC BCA, rincian harga tidak diberikan. Permintaan: struk otomatis terkirim ke WA setelah pembayaran klinik.

## Temuan (Production, project `koaglxcyjqfmgfzxszkj`)

| Cek | Hasil |
| --- | --- |
| `wa_engine_settings.is_enabled` | **false** (terakhir diubah 14 Sep 2026) |
| `whatsapp_message_log` (semua trigger) | **0 baris** — belum pernah ada satu pun WA terkirim/tercatat |
| Invoice klinik `Lunas` 7 hari terakhir | 593, semuanya punya nomor HP pelanggan |
| `FONNTE_TOKEN` di Vercel Production | belum bisa dipastikan dari sesi ini (halaman Pengaturan → WA Engine menampilkan statusnya) |

Kesimpulan: masalah **masih ada**. Kode pengiriman struk ada (`kirimStrukWa` di `src/lib/wa-engine.ts`,
dipanggil dari `klinik/pembayaran/[visitId]/actions.ts` jalur create Lunas), tetapi berhenti di
"Pengiriman WA belum diaktifkan" karena saklar utama mati.

## Celah kode yang tetap ada walau saklar dinyalakan

1. **Saklar tergabung** — `is_enabled` yang sama juga menyalakan pengingat retensi harian (vaksin,
   ulang tahun, lama tidak datang, pasca grooming/treatment). Menyalakan struk = ikut menyalakan semua itu.
2. **Bayar rombongan** (`bayarRombongan`, beberapa hewan satu pemilik) — tidak memanggil `kirimStrukWa` sama sekali.
3. **Pelunasan belakangan** (DP/Belum Lunas → Lunas lewat piutang) dan jalur koreksi — tidak mengirim struk.
4. **Isi struk WA tidak akurat untuk rincian harga** — baris dihitung `qty × harga` tanpa `diskon_persen`;
   diskon nota, voucher, poin tidak ditampilkan, sehingga jumlah baris bisa ≠ Total. Ini persis yang dikeluhkan owner.
5. Tidak ada tombol "Kirim ulang struk WA" manual di halaman pembayaran.

## Usulan perbaikan

- Saklar terpisah `receipt_enabled` (struk transaksi) yang tidak menyalakan pengingat retensi.
- Kirim struk dari semua jalur yang menghasilkan Lunas (tunggal, rombongan, pelunasan piutang).
- Isi struk: harga per baris setelah diskon, baris diskon/voucher/poin, metode bayar, cabang, total = jumlah.
- Tombol kirim ulang manual (tetap idempoten per nomor invoice, kirim ulang dicatat terpisah).
- Uji kirim ke nomor internal yang disetujui sebelum dinyalakan untuk semua cabang.
