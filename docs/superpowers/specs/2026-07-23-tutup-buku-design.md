# Fase Akuntansi 1 — Tutup Buku & Kunci Periode (Design / Spec)

**Tanggal:** 2026-07-23
**Konteks:** Gap akuntansi vs Accurate (pilihan boss). Sebelumnya jurnal periode lama bisa
diubah kapan saja; tidak ada proses pemindahan laba ke Laba Ditahan.

## 1. Kunci Periode
- Singleton `accounting_locks(id bool pk, closed_until date, updated_by, updated_at)`.
- **DB trigger** di `journal_entries` + `journal_lines`: tolak INSERT/UPDATE/DELETE bila
  tanggal entri <= `closed_until` → semua jalur kode (postJournal, aksi manual, SQL) kejaga.
- postJournal best-effort: transaksi operasional di periode terkunci tetap jalan, jurnalnya
  saja yang tertolak diam-diam (by design — akuntansi tidak boleh blokir operasi; sinkron
  ulang via keuangan/sinkron bila perlu).

## 2. Tutup Buku
- `buildClosingLines(balances)` (lib murni, dites): Dr semua PENDAPATAN, Cr semua BEBAN,
  selisih → 3201 Laba Ditahan (Cr laba / Dr rugi). Saldo negatif dibalik arah. Selalu seimbang.
- Action `tutupBuku`: saldo P&L s/d cutoff (semua cabang) → posting jurnal `source=closing`
  (insert langsung, BUKAN postJournal — wajib tahu sukses/gagal) → set `closed_until` = cutoff.
- Idempoten: jurnal penutup ikut kehitung di saldo berikutnya → tutup ulang hanya menangkap
  aktivitas baru; P&L nol → ditolak "tidak ada saldo".
- Salah tutup: lepas kunci → hapus jurnal penutup → ulang.

## 3. UI
`/keuangan/tutup-buku` (tile "Tutup buku"): status kunci + form set/lepas kunci; preview
laba berjalan + form tutup buku.

## Out of scope
Tutup buku per cabang (jurnal penutup global, branch_id null); periode fiskal non-kalender.
