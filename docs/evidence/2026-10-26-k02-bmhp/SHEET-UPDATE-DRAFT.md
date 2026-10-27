# Sheet update K02 + U08 — draf siap tulis (27 Okt 2026)

Sheet: https://docs.google.com/spreadsheets/d/1opWVBMSQ3RHdtwrDefsSBM4Quc9H5zJg1RUNkr0zTFQ/edit (tab `Checklist`).
Aturan: teks baru DITAMBAHKAN di bawah isi sel lama (baris kosong pemisah), jangan menimpa. Hanya sel yang
disebut di bawah yang boleh berubah. Baca ulang setelah tulis; bandingkan dengan sebelum.
Instruksi Reza 27 Okt 2026: centang masuk main sesuai bukti, simulasi tetap FALSE (layar staf belum diuji);
jangan merge branch Codex lama atau lanjut HRIS; U08 simpan perubahan nama + bukti instruksi, tandai brand belum
final, jangan lanjut perubahan nama lain; laporkan total checklist terbaru.

K02 row 19: F=Live, G=TRUE, H=FALSE
J19 += Update 27 Okt 2026 (Claude Code, sesi cloud): PR243 https://github.com/rezanje/Kamo-Vet-OS/pull/243 merged main 09b549dd38bf8d7d2e43ff477084bc3335ce2000 (head teruji 7e87a5be, Technical checks SUCCESS). Vercel Production READY untuk SHA tepat https://vercel.com/kamo-group/kamo-vet-os/DQbfsqt9igZgBGasz9Z5rFgFN28B; URL production https://kamo-vet-os.vercel.app. Backup Supabase harian COMPLETED 26 Okt 2026 22:20:57 WIB (PITR off) sebelum apply. Migrasi 20261026100000_k02_procedure_bmhp diterapkan 27 Okt 2026 00:16:58 WIB, satu transaksi, paket owner-apply (sha256 cocok). Preflight 41 baris 0 failed; readback 54 baris 0 failed, diulang setelah deploy 0 failed; baris BMHP = 0. Bukti: docs/evidence/2026-10-26-k02-bmhp/owner-apply/production-apply-2026-10-26.md
O19 += 27 Okt 2026: live di production (main 09b549dd); BMHP per baris tindakan di rekam medis dan rawat inap aktif sesuai scope PR243.
P19 += 27 Okt 2026: tidak lagi terhalang migrasi. Sisa: simulasi layar staf (rekam medis → tindakan Jasa → pilihan "BMHP dipakai" → posting tagihan) belum dijalankan, H tetap FALSE; UAT lapangan.
U08 row 69: F/G/H unchanged (Live/TRUE/FALSE)
J69 += Update 27 Okt 2026 00:17 WIB (Claude Code): migrasi 20260916221928_normalize_clinic_branch_names (di main sejak 17 Sep 2026, asal branch codex/grup-barang-accurate-import-24kse3) diterapkan ke production atas instruksi eksplisit Reza di sesi Claude Code 26 Okt 2026 ("3 perubahan database baru ... normalisasi nama cabang") dan dikonfirmasi lagi 27 Okt 2026 ("simpan perubahan nama ... tandai keputusan brand belum final"). Label VET_*: CMGG Kamo Klinik Cimanggu→Kamo Pets Clinic Cimanggu; CMS Pets Klinik Ciomas→Kamo Pets Clinic Ciomas; GRDA HPY Garuda→Kamo Pets Clinic Garuda; GRLG HPY Pets Clinic Gerlong→Kamo Pets Clinic Gerlong; PDRY Klinik Panduraya→Kamo Pets Clinic Panduraya; SRKN Pet Clinic Surken→Kamo Pets Clinic Surken; TKI Kamo Klinik TKI→Kamo Pets Clinic TKI; CIAW tetap; VET_RE tidak disentuh. Kode, ID, akses dan histori tidak berubah. Nilai lama untuk rollback: docs/evidence/2026-10-26-k02-bmhp/owner-apply/production-apply-2026-10-26.md
L69 += 27 Okt 2026: KEPUTUSAN BRAND BELUM FINAL. Nama master VET_* kini "Kamo Pets Clinic [cabang]" karena instruksi eksplisit Reza, bukan persetujuan final brand (termasuk eks-HPY Garuda/Gerlong). Jangan lanjut perubahan nama lain sampai brand disetujui.
P69 += 27 Okt 2026: konfirmasi final nama/brand klinik (terutama eks-HPY) masih dibutuhkan; perubahan nama lain dihentikan.
Expected after: Total 85; G TRUE 46→47; H TRUE 3; F Live 46→47, Terhalang 11→10.

Kondisi sebelum (unduhan 27 Okt 2026 ~00:35 WIB): K02 baris 19 F=Terhalang G=FALSE H=FALSE; U08 baris 69 F=Live
G=TRUE H=FALSE. Ringkasan memakai rumus COUNTIF atas Checklist A2:A86/G/H/E: total 85, G 46, H 3.
