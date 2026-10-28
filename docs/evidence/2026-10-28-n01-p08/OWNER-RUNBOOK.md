# N01/P08 — paket DB untuk owner

Belum ada yang dijalankan ke production. Jalankan hanya setelah keputusan rilis, dengan akses owner yang
sudah ada, di SQL editor Supabase production (sebagai `postgres`), berurutan; berhenti bila ada langkah
yang tidak sesuai. Jangan menulis ID project, waktu backup, jumlah data, atau keluaran query production ke
repo/PR.

Isi:
- **N01** — faktur pembelian dari PO menyimpan penerimaan (surat terima barang) yang ditagihnya. Satu
  penerimaan hanya boleh ditagih satu faktur aktif (dijaga database). Pembatalan penerimaan hanya ditahan
  oleh faktur aktif yang menagih penerimaan itu; faktur lama (tanpa catatan) tetap menahan seluruh PO seperti
  sebelumnya. Tidak ada pengisian mundur untuk faktur lama.
- **P08** — Super Admin bisa membatalkan uang muka yang sudah terpakai dalam satu langkah (pembayaran yang
  memakainya dibalik dulu, terlama lebih dulu; pembayaran dalam perintah bayar dibalik satu grup seperti
  sekarang; lalu uang mukanya), dengan pratinjau. Penerimaan yang sudah dibatalkan tidak lagi mengunci PO
  (DP baru, koreksi PO, koreksi harga PO).

## Urutan: migrasi dulu, baru merge kode

Form faktur versi baru memanggil fungsi database baru. Kalau kode live sebelum migrasi, simpan faktur dari PO
gagal. Jadi: **preflight → apply → readback → baru merge PR → tunggu deploy → cek layar.**
Migrasi aman untuk kode lama (fungsi lama tetap ada dan tidak berubah; hanya 4 fungsi yang disesuaikan).

| Langkah | File | Menulis? | sha256 |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | `730b52e47c2ab0d4ee1f8312796ff8142f53a50fe92a07b7e95f20ac090ff2fe` |
| 2 | `apply.sql` (= migrasi `20261029110000` + `20261029111000` persis + baris riwayat, satu transaksi, aman diulang) | **ya** | `1b3c69a67d8b43890e4d7409972a7d5b3504e55ab298dc9f46618c920ae20dc0` |
| 3 | `readback.sql` | tidak | `b63be55c91361866d6f60dddf5d921a8919203e2926f23114805c05347077d5f` |
| — | `rollback.sql` (hanya bila diputuskan mundur, **setelah** kode dikembalikan) | ya | `330dcf87a31666a0ba18cdc4e9c2cf94f1b9c1c0372cb99dde84ec914fb99884` |

Migrasi: `20261029110000_n01_purchase_invoice_receipts.sql` sha256 `cf36a578a587560b96f3c8f7321e058b1fff17a97428365ded1810221a03fd69`,
`20261029111000_p08_advance_cancel_cascade.sql` sha256 `79364ceb4bc37705b876922fb784e05e7b0482081746572c0670028bca278868`.

Sidik isi fungsi (md5 `pg_get_functiondef`) — sama di production (PostgreSQL 17.6, dicek baca-saja 28 Okt)
dan di PG16/PG17 lokal:

| Fungsi | main (sebelum) | sesudah apply |
|---|---|---|
| `cancel_goods_receipt` | `03b31359e9f7b0764993761c9074a411` | `665ae8b79fd6051032c827d984c8d641` |
| `guard_purchase_advance_receipt` | `e99841e188e4470563456bfdf89e162b` | `f1db6d1f5b115eb978de21b79c2cdd92` |
| `revise_purchase_order` | `1abc1231704fb392e3634065a1a4fa93` | `7b10b6e7265dab80c707c2aa4789cc96` |
| `revise_purchase_order_prices` | `2cd59070532a340c4e769deb243e9830` | `d09a46cf61d03bd584fced36f6c73386` |

Dipanggil tanpa diubah (preflight memastikan persis main): `create_purchase_invoice_from_po` (13 argumen)
`3d6acbcaefde9f9a62d4b789d504c2be`, `cancel_purchase_payment` `a74d7a1099b5fcb5d88c25ac47c06943`,
`cancel_purchase_advance_atomic` `dd593619e0b8798eb17baa3001e55dea`.

1. `preflight.sql`: semua baris query pertama `ok = true`. Baris informasi terakhir hanya dicatat.
   (Dicek baca-saja di production 28 Okt: 11/11 `true`, objek baru belum ada.)
2. `apply.sql`: satu transaksi. Gagal = database tetap seperti sebelumnya. Migrasi menolak bila sidik fungsi
   bukan main/hasilnya sendiri, dan memeriksa sidik hasil patch.
3. `readback.sql`: semua baris `ok = true`.
4. Merge PR, tunggu deploy Production, lalu cek: buat faktur dari PO → bagian "Penerimaan yang ditagih" muncul;
   halaman uang muka yang sudah terpakai menampilkan tautan "Batalkan + pembayaran" (pratinjau hanya untuk
   Super Admin).

## Rollback

Kembalikan kode dulu. `rollback.sql` mengembalikan 4 fungsi persis main (dicek md5), menghapus tabel/fungsi
baru dan baris riwayatnya. **Menolak** bila sudah ada faktur yang mencatat penerimaan atau pembatalan uang muka
beruntun — itu catatan bisnis; perbaiki maju dengan migrasi baru.

## Gladi

`python3 docs/evidence/2026-10-28-n01-p08/build-and-rehearse.py /opt/homebrew/opt/postgresql@16/bin`
(native, tanpa Docker; `--write` membuat ulang `apply.sql`). Hasil: `rehearsal-pg16.log`, `rehearsal-pg17.log` —
suite N01 gagal di basis (mendeteksi perubahan belum ada) → fungsi yang diubah satu karakter ditolak preflight
& apply → preflight → apply → readback → apply ulang → suite N01 + P08 + pembatalan penerimaan → rollback (isi
fungsi kembali persis) → preflight → apply → satu tautan fiktif → rollback ditolak, data utuh.
