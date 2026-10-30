#!/usr/bin/env node
/**
 * Migrasi kartu medis — runner JARINGAN (login OWNER biasa, RLS penuh). Terpisah dari CLI offline supaya dry-run tetap
 * tanpa modul jaringan.
 *
 *   node scripts/migrasi-kartu-medis-produksi.mjs validasi-db --berkas master.xlsx --setujui-berkas <sha256>
 *        --hari-ini YYYY-MM-DD --konfirmasi-proyek <ref> --laporan /di/luar/repo/laporan.json
 *   node scripts/migrasi-kartu-medis-produksi.mjs terapkan   (opsi sama) --ledger /di/luar/repo/ledger
 *   node scripts/migrasi-kartu-medis-produksi.mjs readback   (opsi sama) --ledger /di/luar/repo/ledger
 *
 * - `validasi-db`: NOL tulis (pembaca jejak, pemindai identitas, SELECT demografi).
 * - `terapkan`: validasi-db -> jalankan/lanjutkan dari ledger (kartu pemilik baru bertanda impor, simpan massal per batch)
 *   -> readback. Putus koneksi = berhenti tidak pasti; menjalankan ulang perintah yang SAMA melanjutkan dengan aman.
 * - Kredensial dari environment saja (lihat klien-supabase.ts); tidak pernah dicetak. Konsol hanya hitungan. Kunci publik
 *   anon boleh diambil otomatis lewat Management API bila SUPABASE_ACCESS_TOKEN tersedia (hanya kunci publik dipakai).
 * - Laporan & ledger wajib di luar repo (berisi ID lokal + UUID; tanpa nama/HP/isi klinis).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const MODUL = [
  "src/lib/kontak.ts",
  "src/lib/impor-rekam-medis.ts",
  "src/lib/migrasi-kartu-medis/kontrak.ts",
  "src/lib/migrasi-kartu-medis/baca-xlsx.ts",
  "src/lib/migrasi-kartu-medis/baca-master.ts",
  "src/lib/migrasi-kartu-medis/rencana.ts",
  "src/lib/migrasi-kartu-medis/klien.ts",
  "src/lib/migrasi-kartu-medis/identitas.ts",
  "src/lib/migrasi-kartu-medis/buku-besar.ts",
  "src/lib/migrasi-kartu-medis/eksekutor.ts",
  "src/lib/migrasi-kartu-medis/klien-supabase.ts",
];

function muat() {
  const ts = require("typescript");
  const out = join(ROOT, "node_modules/.cache/migrasi-kartu-medis-produksi");
  for (const rel of MODUL) {
    const hasil = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: rel,
    });
    const tujuan = join(out, rel.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(tujuan), { recursive: true });
    writeFileSync(tujuan, hasil.outputText);
  }
  const m = (rel) => require(join(out, rel));
  return {
    baca: m("src/lib/migrasi-kartu-medis/baca-master.js"),
    rencana: m("src/lib/migrasi-kartu-medis/rencana.js"),
    buku: m("src/lib/migrasi-kartu-medis/buku-besar.js"),
    eksekutor: m("src/lib/migrasi-kartu-medis/eksekutor.js"),
    supabase: m("src/lib/migrasi-kartu-medis/klien-supabase.js"),
  };
}

function argumen(argv) {
  const [perintah, ...sisa] = argv;
  const opsi = {};
  for (let i = 0; i < sisa.length; i += 2) {
    const k = sisa[i];
    if (!k?.startsWith("--") || sisa[i + 1] === undefined) throw new Error(`Argumen tidak dikenal: ${k ?? ""}`);
    opsi[k.slice(2)] = sisa[i + 1];
  }
  return { perintah, opsi };
}

const diDalamRepo = (path) => {
  const rel = relative(ROOT, resolve(path));
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Kunci PUBLIK anon (yang sama dengan yang dikirim ke browser aplikasi) bila belum ada di environment: diambil lewat
 * Management API proyek yang dikonfirmasi. Hanya kunci `anon`/publishable yang dipakai; kunci lain dibuang tanpa disimpan.
 */
async function kunciAnon(proyek) {
  if (process.env.KAMO_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_ACCESS_TOKEN) return {};
  const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(proyek)}/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error("Kunci publik proyek tidak terbaca.");
  const daftar = await res.json();
  const anon = Array.isArray(daftar) ? (daftar.find((k) => k?.name === "anon" && k?.type === "legacy") ?? daftar.find((k) => k?.type === "publishable")) : null;
  if (!anon || typeof anon.api_key !== "string") throw new Error("Kunci publik proyek tidak ditemukan.");
  return { KAMO_SUPABASE_ANON_KEY: anon.api_key };
}

const tulis = (path, isi) => writeFileSync(path, `${JSON.stringify(isi, null, 1)}\n`, { mode: 0o600 });

async function main() {
  const { perintah, opsi } = argumen(process.argv.slice(2));
  if (!["validasi-db", "terapkan", "readback"].includes(perintah)) throw new Error("Perintah: validasi-db | terapkan | readback.");
  const izin = new Set(["berkas", "setujui-berkas", "hari-ini", "tanggal-minimum", "konfirmasi-proyek", "laporan", "ledger", "ukuran-batch"]);
  for (const k of Object.keys(opsi)) if (!izin.has(k)) throw new Error(`Opsi tidak dikenal: --${k}`);
  for (const wajib of ["berkas", "setujui-berkas", "hari-ini", "konfirmasi-proyek", "laporan"]) if (!opsi[wajib]) throw new Error(`--${wajib} wajib.`);
  if (perintah !== "validasi-db" && !opsi.ledger) throw new Error("--ledger wajib.");
  for (const k of ["laporan", "ledger"]) if (opsi[k] && diDalamRepo(opsi[k])) throw new Error(`--${k} harus di luar repo.`);

  const { baca, rencana: modRencana, buku: modBuku, eksekutor, supabase } = muat();
  const bytes = new Uint8Array(readFileSync(opsi.berkas));
  const master = await baca.bacaMaster(bytes);
  if (!master.ok) throw new Error(`Master ditolak: ${master.galat.join(" | ")}`);
  if (opsi["setujui-berkas"] !== master.sha256) throw new Error("SHA-256 berkas berbeda dengan yang disetujui; berhenti.");
  const rencana = modRencana.buatRencana(master.versi, master.sha256, master.blok, {
    hariIni: opsi["hari-ini"], tanggalMinimum: opsi["tanggal-minimum"] ?? modRencana.OPSI_BAWAAN_TANGGAL_MINIMUM,
    persetujuanBerkas: opsi["setujui-berkas"],
  }, master.peringatan);

  const konteks = { mode: "semua-cabang" };
  const env = { ...process.env };
  if (env.KAMO_OWNER_EMAIL && env.KAMO_OWNER_PASSWORD) Object.assign(env, await kunciAnon(opsi["konfirmasi-proyek"]));
  const klien = await supabase.masukOwner(supabase.opsiDariEnv(env, konteks, opsi["konfirmasi-proyek"]));
  const laporan = {
    perintah, proyek: opsi["konfirmasi-proyek"], sha256Berkas: rencana.sha256Berkas, sidikRencana: rencana.sidikRencana,
    hitunganRencana: rencana.hitungan, rencana: rencana.baris.map((r) => ({ local_record_id: r.local_record_id, status: r.status, alasan: r.alasan })),
  };
  try {
    laporan.validasiDb = await eksekutor.validasiDb(klien, rencana);
    const ringkasValidasi = { siapMasuk: laporan.validasiDb.siapMasuk, sudahAda: laporan.validasiDb.sudahAda, ditahan: laporan.validasiDb.ditahan, pemilikBaru: laporan.validasiDb.pemilikBaru, perAlasanTahan: laporan.validasiDb.perAlasanTahan, kandidatPerluDilengkapi: rencana.hitungan.tertunda };
    process.stdout.write(`${JSON.stringify({ rencana: rencana.hitungan, validasiDb: ringkasValidasi }, null, 1)}\n`);
    if (perintah === "validasi-db") { tulis(opsi.laporan, laporan); return; }

    const ukuranBatch = Number(opsi["ukuran-batch"] ?? 150);
    const meta = { runId: `run-${rencana.sidikRencana.slice(0, 12)}`, versiKontrak: rencana.versi, sha256Berkas: rencana.sha256Berkas, sidikRencana: rencana.sidikRencana, konteks, ukuranBatch };
    const { buku } = modBuku.BukuBesar.buka(opsi.ledger, meta, { akarRepo: ROOT });
    try {
      if (perintah === "terapkan") {
        laporan.jalan = await eksekutor.jalankanMigrasi(klien, rencana, buku, { ukuranBatch });
        process.stdout.write(`${JSON.stringify({ jalan: laporan.jalan }, null, 1)}\n`);
        if (laporan.jalan.status !== "selesai") { tulis(opsi.laporan, laporan); process.exitCode = 3; return; }
      }
      laporan.readback = await eksekutor.readbackMigrasi(klien, rencana, buku);
      const state = buku.baca();
      laporan.perBaris = [
        ...state.batches.flatMap((b) => b.baris.map((lr, i) => ({ ...b.hasil?.[i], customer_id: lr.customer_id, pet_id: lr.pet_id, catatan: lr.catatan ?? [] }))),
        ...state.ditahanIdentitas.map((d) => ({ local_record_id: d.local_record_id, status: "ditahan", alasan: d.alasan })),
      ];
      laporan.pemilikBaru = state.pemilikBaru ?? [];
      if (perintah === "terapkan" && laporan.readback.status !== "selisih") {
        // Kartu tidak lengkap -> ruang tunggu "Perlu Dilengkapi" (bukan riwayat resmi). Idempoten per jejak.
        laporan.kartuTertunda = await eksekutor.simpanKartuTertunda(klien, rencana);
        const hitung = {};
        for (const k of laporan.kartuTertunda) hitung[k.status] = (hitung[k.status] ?? 0) + 1;
        process.stdout.write(`${JSON.stringify({ kartuTertunda: hitung }, null, 1)}\n`);
      }
      process.stdout.write(`${JSON.stringify({ readback: { ok: laporan.readback.ok, status: laporan.readback.status, diperiksa: laporan.readback.diperiksa, disposisi: laporan.readback.disposisi, selisih: laporan.readback.selisih.length } }, null, 1)}\n`);
      tulis(opsi.laporan, laporan);
      if (!laporan.readback.ok) process.exitCode = 4;
    } finally {
      buku.tutup();
    }
  } finally {
    await klien.keluar();
  }
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
