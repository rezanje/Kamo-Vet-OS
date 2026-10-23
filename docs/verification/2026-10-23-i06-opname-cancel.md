# I06 — pembatalan draf stok opname yang dapat ditelusuri

Feedback: “SO yang belum selesai harus dapat dihapus agar draft yang tidak akan dilanjutkan tidak menumpuk.” Candidate dibuat pada main `4a14ca914db85ac49ba32f04eabe774066d33815`, setelah PR93. PR83/88/90/93 dipertahankan; tidak ada perubahan konversi SKU, DP atau PO short-close dalam batch ini.

## Perilaku dan cakupan

- Menu detail `/pos/opname/[id]` dan `/kasir/opname/[id]` menawarkan **Batalkan draf** dengan alasan wajib 3–500 karakter. Daftar utama menyembunyikan status Batal; filter riwayat tetap membuka dokumen dan bukti pembatalan.
- Satu RPC `cancel_opname_draft` mengunci header, memeriksa status Terbuka tanpa hitungan terkunci, hasil, efek stok/lapisan/jurnal atau bukti koreksi yang terhubung. Selesai dan posting parsial ditolak dengan alasan jelas; tidak ada pembalikan yang diciptakan.
- Status terminal Batal, alasan, waktu server, ID dan snapshot nama pelaku server tersimpan pada header. Pembatalan tidak menghapus header/lingkup atau mengubah stock/jurnal/faktur. Retry mempertahankan bukti pertama dan satu peristiwa A01; kegagalan audit menggagalkan transaksi pembatalan.
- Memakai pemeriksaan profil aktif, cabang, modul `pos` yang sudah ada atau shift petshop milik kasir yang masih terbuka. Query metadata backoffice mengikuti `allowedBranchIds` dan gudang yang terlihat; kasir tetap terikat gudang shift. Tidak menambah pembaca audit, role, policy atau grant tabel. RPC baru hanya untuk authenticated; helper internal dicabut dari role aplikasi.
- Status A01 yang sudah ada menyimpan transisi aman dengan pelaku/waktu. Alasan bebas dan nama snapshot tidak disalin ke payload audit umum. Tautan audit mengikuti pembaca OWNER/ADMIN existing; tidak membuka log ke kasir.
- Trigger aplikasi menolak delete header langsung, pemalsuan bukti dan pembukaan/edit setelah Batal. Guard anak dan efek memakai lock header untuk menolak hitungan/posting terlambat. Hasil parsial dengan efek mempertahankan identitas OPR dan hubungan order; rename/reparent/delete tidak dapat menghilangkan asal efek.
- Perubahan FIFO yang murni mengurangi `qty_left` tanpa mengubah field lain dikecualikan dari lock parent, sesuai guard koreksi existing, sehingga urutan lock penjualan tidak berbalik terhadap koreksi. Insert efek baru harus punya hubungan order/result yang eksplisit; data orphan lama tidak dicocokkan dengan nama/deskripsi.
- Pembuatan lingkup yang gagal meminta pembatalan tercatat, menggantikan kompensasi delete. Jika pembatalan belum terkonfirmasi, error menyebut dokumen dan meminta pemeriksaan admin, tanpa mengklaim berhasil.

## Bukti pengujian

Lihat [checks.json](../evidence/2026-10-23-i06/checks.json), [SQL](../evidence/2026-10-23-i06/sql.log), [aplikasi](../evidence/2026-10-23-i06/full-tests.log), [build](../evidence/2026-10-23-i06/build.log), [typecheck](../evidence/2026-10-23-i06/typecheck.log), [lint](../evidence/2026-10-23-i06/lint.log).

- RED baseline: delete aplikasi masih berhasil, tombol/bukti pembatalan tidak tersedia; [SQL RED](../evidence/2026-10-23-i06/sql-red.log), [UI RED](../evidence/2026-10-23-i06/ui-red.log). RED tambahan menemukan private helper invoker tidak dapat diakses; [identity RED](../evidence/2026-10-23-i06/identity-red.log). Dipisahkan menjadi fence identitas definer internal dengan fence bukti tetap invoker untuk mencegah spoof context.
- SQL memakai PostgreSQL16 disposable `--network none`, auth/storage shim dan fixture fiktif milik runner, bukan kredensial/URL target. Seluruh migration repository diterapkan lokal secara transactional per file. Membuktikan status/reason/actor/time, akses anonymous/inactive/cross-branch/no module/no shift, fallback shift kasir, spoof konteks tepat, immutable bukti/header, penolakan locked/posted/partial/effect, retensi lingkup, audit atomik+idempotent, rollback audit, dan konsumsi FIFO.
- Dua sesi deterministik: hitungan memegang lock dulu → pembatalan menunggu lalu ditolak; pembatalan memegang lock dulu → insert efek stok menunggu lalu ditolak. Ini pemeriksaan race terbatas, bukan kampanye simulasi/UAT baru.
- Tes aplikasi memanggil action dan render server detail nyata: alasan/route, error parsial, respons transport tidak pasti, tanpa actor dari klien, revalidation empat menu, bukti Batal, pembatasan query cabang dan warehouse. Build/type/lint/suite proyek dicatat sesuai hasil aktual. SSR tidak menggantikan UAT browser desktop/mobile.

## Migrasi dan rilis (dikoordinasikan parent)

Satu file baru: `supabase/migrations/20261023021400_opname_draft_cancellation.sql`, dibuat dengan CLI `supabase migration new`. Menambah enum Batal, empat kolom bukti, constraint, RPC dan trigger/fungsi internal. Tidak ada backfill, penghapusan data, atau rekonstruksi sejarah.

1. Verifikasi parity/backup dan SHA candidate terhadap target melalui release executor. Target sebelumnya history217 dengan latest `20261023013902`; jangan mengulang sembilan migrasi PR92 atau migration I07 yang sudah diterapkan.
2. Terapkan hanya migration I06 yang belum tercatat setelah review. Enum baru tidak digunakan sebagai nilai enum dalam DDL transaction yang sama: constraint membandingkan text, assignment RPC baru dieksekusi sesudah commit migration.
3. Deploy aplikasi yang sesuai setelah migration, lalu UAT draf kosong vs terkunci/parsial serta cabang/shift menggunakan fixture yang disepakati. Periksa history Batal dan audit OWNER/ADMIN.
4. Batch ini hanya menyiapkan kandidat. Tidak merge, deploy, atau menerapkan migration ke target.

## Rollback

Utamakan rollback aplikasi sambil mempertahankan migration dan bukti Batal. Versi aplikasi lama belum mengenal Batal, sehingga rollback aplikasi bukan jalan untuk menghidupkan kembali atau menghapus dokumen batal; operator perlu memakai kandidat yang kompatibel untuk membaca bukti. Jangan rollback schema dengan menghapus bukti yang sudah terisi.

Jika benar-benar diperlukan sebelum ada pembatalan: dalam maintenance transaction, verifikasi `count(*)=0` untuk status Batal dan semua kolom bukti; hentikan bila ada bukti. Release executor dapat menghapus hanya trigger/fungsi baru yang disebut file migration, lalu constraint dan empat kolom. Biarkan enum Batal tidak terpakai (PostgreSQL tidak menyediakan DROP VALUE yang aman); jangan mengganti tipe/menulis ulang tabel. Target rollback membutuhkan keputusan terpisah. Owner database maintenance existing tidak disamakan dengan role aplikasi yang immutable.

## Batas dan keputusan yang tersisa

- Hanya draf genuine yang dapat dibatalkan. Hitungan terkunci harus diperiksa/dibuka melalui alur existing sebelum draf kembali eligible; hasil/efek persisten tetap ditolak. Tidak mengubah kebijakan reversal/koreksi, stock check, atau posting lama menjadi transaksi atomik.
- Efek legacy yang sudah kehilangan hubungan result/order sebelum migration tidak dapat direkonstruksi secara andal dari nomor/deskripsi. Perlu rekonsiliasi eksplisit; bukan klaim bahwa semua orphan lama terdeteksi oleh migration ini.
- Hasil existing yang tersimpan sebagian dilindungi, bukan otomatis diperbaiki. Pembuatan order+lingkup existing masih dua request; kegagalan kompensasi diberitahukan untuk pemeriksaan admin, tidak diberi bukti palsu bahwa rollback berhasil.
- Pembaca audit umum tetap OWNER/ADMIN. Bukti pembatalan berada pada dokumen yang diakses lewat cabang/shift existing. UI history mengikuti batas daftar existing (backoffice200/kasir50); tidak ada ekspor/retensi baru.
- Code-complete, pushed, migration-applied, deployed dan UAT harus dilacak terpisah oleh parent. Checkbox rilis tidak berarti UAT telah dijalankan.
