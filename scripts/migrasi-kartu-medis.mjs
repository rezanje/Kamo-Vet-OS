#!/usr/bin/env node
/**
 * Migrasi kartu medis — CLI OFFLINE saja (dry-run). Tidak ada mode jaringan/tulis di CLI ini: login/sesi OWNER untuk
 * apply masih keputusan operasional terbuka (docs/rencana-migrasi-kartu-medis.md §9 K4).
 *
 *   node scripts/migrasi-kartu-medis.mjs dry-run --berkas master.xlsx [--laporan laporan.json]
 *        [--hari-ini YYYY-MM-DD] [--tanggal-minimum YYYY-MM-DD]
 *
 * Tanpa dependensi baru: modul TypeScript offline ditranspilasi (typescript yang sudah ada) ke folder cache di
 * node_modules/.cache lalu dimuat. Hanya modul offline yang ikut (klien/eksekutor/identitas TIDAK dimuat).
 * Keluaran konsol hanya hitungan; laporan JSON berisi ID lokal + kode alasan (tanpa PHI). Laporan wajib di luar repo.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Modul offline yang boleh dimuat CLI. Modul jaringan sengaja tidak ada di daftar ini. */
export const MODUL_OFFLINE = [
  "src/lib/kontak.ts",
  "src/lib/impor-rekam-medis.ts",
  "src/lib/migrasi-kartu-medis/kontrak.ts",
  "src/lib/migrasi-kartu-medis/baca-master.ts",
  "src/lib/migrasi-kartu-medis/rencana.ts",
  "src/lib/migrasi-kartu-medis/dry-run.ts",
];

export function muatDryRun() {
  const ts = require("typescript");
  const out = join(ROOT, "node_modules/.cache/migrasi-kartu-medis");
  for (const rel of MODUL_OFFLINE) {
    const sumber = readFileSync(join(ROOT, rel), "utf8");
    const hasil = ts.transpileModule(sumber, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: rel,
    });
    const tujuan = join(out, rel.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(tujuan), { recursive: true });
    writeFileSync(tujuan, hasil.outputText);
  }
  return require(join(out, "src/lib/migrasi-kartu-medis/dry-run.js"));
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

function diDalamRepo(path) {
  const rel = relative(ROOT, resolve(path));
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function main() {
  const { perintah, opsi } = argumen(process.argv.slice(2));
  if (perintah !== "dry-run") throw new Error("Hanya perintah `dry-run` (offline) yang tersedia.");
  if (!opsi.berkas) throw new Error("--berkas wajib.");
  const izin = new Set(["berkas", "laporan", "hari-ini", "tanggal-minimum"]);
  for (const k of Object.keys(opsi)) if (!izin.has(k)) throw new Error(`Opsi tidak dikenal: --${k}`);
  if (opsi.laporan && diDalamRepo(opsi.laporan)) throw new Error("--laporan harus di luar repo.");
  const { dryRunOffline } = muatDryRun();
  const laporan = await dryRunOffline(new Uint8Array(readFileSync(opsi.berkas)), { hariIni: opsi["hari-ini"], tanggalMinimum: opsi["tanggal-minimum"] });
  if (opsi.laporan) writeFileSync(opsi.laporan, JSON.stringify(laporan, null, 1), { mode: 0o600 });
  const ringkas = {
    mode: laporan.mode, ok: laporan.ok, versi: laporan.versi, sha256Berkas: laporan.sha256Berkas, sidikRencana: laporan.sidikRencana,
    galat: laporan.galat, peringatan: laporan.peringatan, hitungan: laporan.hitungan, catatan: laporan.catatan,
  };
  process.stdout.write(`${JSON.stringify(ringkas, null, 1)}\n`);
  process.exitCode = laporan.ok ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
}
