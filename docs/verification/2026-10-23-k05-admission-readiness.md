# K05 — kesiapan admission dan pesan kegagalan baca (cakupan UX)

Sumber: checklist 70 butir, K05 baris 65 dan U07 baris 66; [Sheet canonical](https://docs.google.com/spreadsheets/d/1opWVBMSQ3RHdtwrDefsSBM4Quc9H5zJg1RUNkr0zTFQ/edit#gid=831947777). Parent mengelola Sheet. Tidak mengedit Sheet atau menerapkan migration/target data.

## Defek yang direproduksi

1. Halaman mengabaikan error pembacaan consent, template, aturan, rekam medis dan admission existing. Consent/error menjadi array kosong lalu dianggap belum TTD, atau consent valid membuat tombol aktif walau data lain belum terbukti. Panel consent asli juga menampilkan “belum ada form/template” dari hasil baca yang gagal, mendorong pembuatan ulang.
2. Kunjungan status Selesai/check-out atau tanpa dokter tetap ditawari tombol aktif jika consent bertanda tangan ada. RPC `clinic_admit_inpatient` existing sudah menolak kondisi ini; tombol hanya mengarahkan pengguna ke kegagalan yang dapat dijelaskan sebelumnya.
3. Pesan consent yang belum memenuhi prasyarat tidak memiliki tautan langsung ke bagian yang harus diperiksa.

RED halaman: 8 dari 10 tes awal gagal pada kondisi baru, dua regresi normal sudah lulus. Review independen menemukan panel consent asli masih memberi klaim kosong, tertutup oleh mock pada tes awal. Mock dihapus, komponen asli dirender; dua tes regresi tambahan gagal sebelum guard wrapper ditambahkan. [RED awal](../evidence/2026-10-23-k05/page-red.log), [RED panel asli](../evidence/2026-10-23-k05/consent-panel-red.log).

## Perubahan

- Helper readiness UX membedakan data belum terverifikasi, kunjungan selesai/check-out, dokter/MR belum lengkap, consent khusus belum sah, dan kondisi siap. Ini mencerminkan guard RPC existing, bukan mengganti otorisasi atau menjamin server menerima snapshot halaman yang mungkin sudah berubah.
- Ketika data prasyarat gagal dibaca, tombol disabled dan pesan meminta memuat ulang; tidak meminta membuat TTD baru sebelum data terbaca. Jika consent/template gagal dibaca, `ConsentSection` tidak dirender dengan array kosong; wrapper menampilkan pesan unavailable + reload, tanpa tombol pembuatan baru.
- Kunjungan selesai/check-out dan dokter/MR belum lengkap menjelaskan alasan dan disabled sesuai penolakan server yang sudah ada. Tidak membuka paid/closed visit ke admission dan tidak membuat kunjungan baru otomatis; K06 tetap membutuhkan keputusan bisnis.
- Consent kategori Umum yang hanya diberi nama rawat inap tidak dianggap sah. Kategori Rawat Inap dan template yang dikonfigurasi memakai helper existing. Rule wajib=false tetap mengikuti perilaku server. Link ke anchor persetujuan memudahkan pengguna memeriksa bagian yang tepat. Rencana tindakan max 4000 mengikuti batas server existing.
- Admission yang sudah ada tetap membuka detail existing, tanpa formulir duplikasi. Request key, pending button, RPC atomic, audit, actor, branch/RLS, role dan efek stok/tagihan tidak diubah.

## Verifikasi dan batas

[Checks](../evidence/2026-10-23-k05/checks.json), [fokus](../evidence/2026-10-23-k05/focused.log), [suite proyek](../evidence/2026-10-23-k05/full-tests.log), [typecheck](../evidence/2026-10-23-k05/typecheck.log), [lint](../evidence/2026-10-23-k05/lint.log), [build](../evidence/2026-10-23-k05/build.log).

- 36 tes fokus/4 file: 12 tes SSR halaman (termasuk panel consent asli), helper consent, action tanda tangan, dan regresi hasil simpan form existing. Valid signed consent eligible; generic signed document tidak; lima sumber baca error, status selesai/check-out, dokter hilang, tautan anchor dan admission existing diperiksa.
- Review independen Sol6.1 high: P2 panel consent diperbaiki; review akhir tidak menemukan P1/P2, 15 tes fokus dijalankan independen.
- Seluruh source akhir disinkronkan normal ke main `ccd886ba5edebf083ef84c5e28d3e563c6e76d57` (K07 sudah diintegrasikan lane rilis), lalu suite/type/lint/build proyek dijalankan. Tidak ada simulasi workflow lengkap, browser/UAT baru atau target read/write.
- K05 tetap parsial pada pembuktian workflow target: tidak mengklaim seluruh kasus admission live sudah diuji. RPC `clinic_admit_inpatient` dan test SQL existing `supabase/tests/inpatient_consent.sql` dibaca sebagai bukti guard/idempotency, tidak diklaim dijalankan ulang pada batch ini.
- U07 hanya diinspeksi: `SubmitButton` existing sudah pending + disabled; simpan/admission menggunakan RPC dan request key existing. Tidak ada pengukuran latensi frontend/network/backend atau target SLA; U07 tidak ditandai selesai dan tidak diklaim performanya membaik.

## Rilis dan kelanjutan

Tidak ada schema/migration/RPC baru. Lane rilis/parent mengelola merge/deploy; rollback cukup revert commit aplikasi ini. Tidak ada data yang harus dihapus atau dipulihkan.

Scope yang memerlukan keputusan tetap: K06 eligibility kunjungan selesai/lunas; K07 durasi inap dibayar dan provenance pemberian obat; K02/K03 timing/mandatory BMHP serta scope premixed. Berikutnya yang actionable di lane CRM: C01 edit promo dengan validasi/histori existing, tanpa mengubah transaksi historis. Jangan menandai seluruh 70 item selesai dari dua batch klinik ini.
