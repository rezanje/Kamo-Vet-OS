<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Laporan rilis KAMO (wajib untuk setiap pekerjaan)

Berlaku untuk semua agen (Claude, Codex, dll.) yang mengerjakan ID checklist KAMO.

1. **Sebelum merge** — laporan ringkas ada di **PR yang sama dengan kodenya** (deskripsi PR), bukan di branch
   atau PR terpisah tanpa alasan. Isi:
   - ID checklist (dan apakah selesai penuh atau sebagian);
   - perubahan;
   - hasil tes (acceptance, regresi, lint, typecheck, build, `Technical checks` di head final);
   - sisa kendala / kebutuhan yang belum dikerjakan.
2. **Setelah merge dan deploy** — tambahkan **satu komentar di PR tersebut** berisi: SHA main hasil merge,
   URL deployment, environment (Production), hasil pemeriksaan live, dan hal yang belum diuji.
   Jangan membuat commit atau deploy tambahan hanya untuk memperbarui laporan.
3. **Ke pemilik (Reza)** — satu ringkasan per batch: link PR, SHA, bukti deploy, untuk dipakai Wowo meng-update
   Google Sheet. Bedakan **batch yang berhasil dirilis** dari **ID yang selesai seluruhnya**.
   Jangan mengklaim simulasi/UAT pengguna lulus bila belum dilakukan.
4. Google Sheet dipegang Wowo — agen tidak mengubahnya.
