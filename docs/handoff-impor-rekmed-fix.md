# Serah-terima: tiga perbaikan impor rekam medis (temuan harness PR #328) → Claude Code

Status: **WIP, dihentikan di titik aman oleh Hermes.** Belum ada PR fix, belum merge/deploy, migrasi belum dipasang di DB mana pun selain Postgres sekali-pakai.

## Dasar & batas (dari Reza, via Wowo)
- Disetujui: implementasi perbaikan K1b, K3 (0/+62), C3b lalu uji ulang fiktif sebelum Andri memeriksa sampel. PR #328 tetap baseline bukti.
- Dilarang: merge/deploy, pasang migrasi produksi, backfill/gabung pelanggan lama, impor pasien produksi, akses Google baru, memutuskan aturan bisnis (minimum digit HP, tanggal, klinis kosong, folder ambigu), koneksi/kredensial Production. Semua tes data fiktif + DB sekali-pakai.

## Branch
- `hermes/impor-rekmed-fix`, dasar `main` `48d97b2e` (merge PR #327). Worktree Hermes: `/opt/data/kamo-wt-imporfix` (silakan pakai worktree sendiri).

## Yang sudah dikerjakan
1. **K1b (key sama, isi beda):** migrasi `supabase/migrations/20261101090000_impor_identitas_atomik.sql` menambah `visits.legacy_source_hash` + `import_legacy_row_hash()`; RPC bulk/resolved hanya mengembalikan `sudah_ada` bila hash identik; beda isi / tanpa hash (tidak terbukti) → `ditahan` + alasan, tanpa overwrite/insert. App: `pilahRiwayatTersimpan` sekarang mengembalikan `{baru, tercatat}` dan baris `tercatat` dikirim ke DB untuk dibuktikan (tidak dihitung sudah_ada di app). Checkpoint: `folderSelesaiTercatat()` tidak menandai folder selesai bila ada baris ditahan/perlu keputusan.
2. **K3 (0/+62):** `kunciHpIndonesia()` di `src/lib/kontak.ts` ≡ `public.indonesian_phone_key()` di DB, divalidasi vektor bersama `src/lib/__tests__/fixtures/kunci-hp-indonesia.json`. `import_legacy_phone_key` memakai kunci kanonik. Data pelanggan lama tidak diubah.
3. **C3b (registrasi vs impor bersamaan):** `customer_identity_lock(kunci HP)` dipakai kedua jalur; RPC baru `registrasi_pelanggan_atomik` dan `customer_pick_by_phone` (HP dipakai >1 pelanggan → ditolak/ambiguous, tidak dipilih/digabung otomatis). `klinik/registrasi/actions.ts` (`daftar` & `lookupPetsByPhone`) memakai RPC ini.
4. **Harness diperkuat:** `scripts/test-impor-rekam-medis-postgres.py` ditulis ulang: barrier deterministik (gate row lock + pg_stat_activity, bukan sleep), BLOCKED bila sinkronisasi timeout, kasus P/R/U/K/N/A/C1–C7/Z.

## Hasil tes (di commit serah-terima)
- Vitest terarah 10 berkas: **146/146 lulus**.
- Probe Postgres 17.11 sekali-pakai: 319 migrasi (termasuk yang baru) teraplikasi, fungsi baru terbentuk, kunci HP DB benar untuk sampel.
- **Harness Postgres baru: BELUM PERNAH DIJALANKAN** (hanya lolos `py_compile`). Kemungkinan perlu perbaikan.
- Belum: vitest penuh, `tsc` (butuh `--max-old-space-size=3072`), lint, build, `Technical checks`.

## Sisa pekerjaan / risiko yang perlu direview
- Jalankan harness: `python3 scripts/test-impor-rekam-medis-postgres.py --pg-bin <dir PG17>` (di VPS Hermes: `/opt/data/kamo-pg-harness/bin`; Docker tidak tersedia).
- Review migrasi baris per baris: hash canonicalization vs app (R2 kosmetik), urutan kunci (deadlock C7), RLS/grant RPC baru, dan bahwa jalur exception/race bulk juga lewat cek hash.
- Jalur pembuat pelanggan lain (`kasir/actions.ts tambahCustomerKasir`, `crm/pelanggan/baru/actions.ts`) BELUM memakai kunci atomik — putuskan apakah masuk scope.
- Buat PR fix (draft) dengan laporan rilis sesuai AGENTS.md; jangan merge, jangan pasang migrasi.
