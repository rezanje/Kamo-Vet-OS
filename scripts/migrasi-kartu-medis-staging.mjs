#!/usr/bin/env node
/**
 * Migrasi kartu medis dari paket staging JSON (`staging-card-v1` + delta tanggal) lewat runner PR355.
 *
 *   node scripts/migrasi-kartu-medis-staging.mjs dry-run   --paket <dir> [--paket <dir>] --delta <dir> --hari-ini YYYY-MM-DD --laporan <luar-repo>.json
 *   node scripts/migrasi-kartu-medis-staging.mjs rencana   (opsi sama) --konfirmasi-proyek <ref> --rencana <luar-repo>.json
 *        -> login OWNER, validasi DB + rekonsiliasi jejak lama/tanggal sama (NOL tulis), lalu rencana dibekukan.
 *   node scripts/migrasi-kartu-medis-staging.mjs terapkan  --rencana <beku>.json --konfirmasi-proyek <ref> --ledger <dir> --laporan <json>
 *        -> satu antrean ber-ledger (pemilik baru bertanda impor, simpan massal per batch) -> readback -> Perlu Dilengkapi.
 *
 * `<dir>` = folder hasil ekstrak paket: `batchNN-cards.json` (paket) atau `delta/date-v2-targets.json` + `revised/*.json` +
 * `MANIFEST.json` (delta; SHA-256 tiap berkas dicek). Rencana beku, laporan, dan ledger berisi data pasien: wajib di luar
 * repo (0600). Konsol hanya hitungan. Kredensial hanya dari environment (lihat klien-supabase.ts).
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MODUL = [
  "src/lib/kontak.ts", "src/lib/impor-rekam-medis.ts",
  "src/lib/migrasi-kartu-medis/kontrak.ts", "src/lib/migrasi-kartu-medis/baca-xlsx.ts", "src/lib/migrasi-kartu-medis/baca-master.ts",
  "src/lib/migrasi-kartu-medis/rencana.ts", "src/lib/migrasi-kartu-medis/klien.ts", "src/lib/migrasi-kartu-medis/identitas.ts",
  "src/lib/migrasi-kartu-medis/buku-besar.ts", "src/lib/migrasi-kartu-medis/eksekutor.ts", "src/lib/migrasi-kartu-medis/klien-supabase.ts",
  "src/lib/migrasi-kartu-medis/staging-json.ts", "src/lib/migrasi-kartu-medis/rekonsiliasi-staging.ts",
];

function muat() {
  const ts = require("typescript");
  const out = join(ROOT, "node_modules/.cache/migrasi-kartu-medis-staging");
  for (const rel of MODUL) {
    const hasil = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: rel,
    });
    const tujuan = join(out, rel.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(tujuan), { recursive: true });
    writeFileSync(tujuan, hasil.outputText);
  }
  const m = (rel) => require(join(out, rel));
  return {
    staging: m("src/lib/migrasi-kartu-medis/staging-json.js"), rekon: m("src/lib/migrasi-kartu-medis/rekonsiliasi-staging.js"),
    buku: m("src/lib/migrasi-kartu-medis/buku-besar.js"), eks: m("src/lib/migrasi-kartu-medis/eksekutor.js"),
    supabase: m("src/lib/migrasi-kartu-medis/klien-supabase.js"),
  };
}

function argumen(argv) {
  const [perintah, ...sisa] = argv;
  const opsi = { paket: [] };
  for (let i = 0; i < sisa.length; i += 2) {
    const k = sisa[i];
    if (!k?.startsWith("--") || sisa[i + 1] === undefined) throw new Error(`Argumen tidak dikenal: ${k ?? ""}`);
    if (k === "--paket") opsi.paket.push(sisa[i + 1]); else opsi[k.slice(2)] = sisa[i + 1];
  }
  return { perintah, opsi };
}
const diDalamRepo = (p) => { const rel = relative(ROOT, resolve(p)); return !rel || (!rel.startsWith("..") && !isAbsolute(rel)); };
const tulis = (p, isi) => writeFileSync(p, `${JSON.stringify(isi, null, 1)}\n`, { mode: 0o600 });
const sha = (b) => createHash("sha256").update(b).digest("hex");

function bacaMasukan(opsi, staging) {
  const berkas = [];
  const batches = [];
  for (const dir of opsi.paket) {
    for (const nama of readdirSync(dir).filter((n) => /^batch\d+-cards\.json$/.test(n)).sort()) {
      const bytes = readFileSync(join(dir, nama));
      berkas.push({ nama: `paket/${nama}`, bytes });
      batches.push(JSON.parse(bytes.toString("utf8")));
    }
  }
  let delta;
  if (opsi.delta) {
    const manifest = JSON.parse(readFileSync(join(opsi.delta, "MANIFEST.json"), "utf8"));
    for (const f of manifest.files ?? []) {
      if (sha(readFileSync(join(opsi.delta, f.path))) !== f.sha256) throw new Error(`Delta: SHA-256 ${f.path} tidak cocok dengan MANIFEST.`);
    }
    const tBytes = readFileSync(join(opsi.delta, "delta/date-v2-targets.json"));
    berkas.push({ nama: "delta/date-v2-targets.json", bytes: tBytes });
    const revisi = [];
    for (const nama of readdirSync(join(opsi.delta, "revised")).filter((n) => n.endsWith(".json")).sort()) {
      const bytes = readFileSync(join(opsi.delta, "revised", nama));
      berkas.push({ nama: `delta/revised/${nama}`, bytes });
      revisi.push(JSON.parse(bytes.toString("utf8")));
    }
    delta = { targets: JSON.parse(tBytes.toString("utf8")), revisi };
  }
  const paket = staging.bacaPaketStaging(batches, delta);
  if (paket.galat.length) throw new Error(`Paket ditolak: ${[...new Set(paket.galat)].join(" | ")}`);
  return { paket, sha256: staging.sha256Paket(berkas) };
}

function ringkas(r) {
  return { riwayat: r.hitungan.riwayat, siap: r.hitungan.siap, karantina: r.hitungan.karantina, dikecualikan: r.hitungan.dikecualikan,
    perluDilengkapi: r.hitungan.tertunda, perAlasan: r.hitungan.perAlasan };
}

async function masuk(supabase, proyek) {
  const env = { ...process.env };
  if (!env.KAMO_SUPABASE_ANON_KEY && env.SUPABASE_ACCESS_TOKEN) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(proyek)}/api-keys`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
    const anon = res.ok ? (await res.json()).find((k) => k?.name === "anon" && k?.type === "legacy") : null;
    if (!anon) throw new Error("Kunci publik proyek tidak ditemukan.");
    env.KAMO_SUPABASE_ANON_KEY = anon.api_key;
  }
  return supabase.masukOwner(supabase.opsiDariEnv(env, { mode: "semua-cabang" }, proyek));
}

async function main() {
  const { perintah, opsi } = argumen(process.argv.slice(2));
  if (!["dry-run", "rencana", "terapkan"].includes(perintah)) throw new Error("Perintah: dry-run | rencana | terapkan.");
  for (const k of ["laporan", "rencana", "ledger"]) if (opsi[k] && diDalamRepo(opsi[k])) throw new Error(`--${k} harus di luar repo.`);
  const { staging, rekon, buku: modBuku, eks, supabase } = muat();

  if (perintah !== "terapkan") {
    if (!opsi.paket.length || !opsi["hari-ini"] || !opsi.laporan) throw new Error("--paket, --hari-ini, --laporan wajib.");
    const { paket, sha256 } = bacaMasukan(opsi, staging);
    let rencana = staging.rencanaDariStaging(paket.kartu, { hariIni: opsi["hari-ini"], tanggalMinimum: opsi["tanggal-minimum"] ?? "1990-01-01", sha256Paket: sha256 });
    const laporan = { perintah, sha256Paket: sha256, kartu: paket.kartu.length, delta: { diterapkan: paket.deltaDiterapkan, diluarCakupan: paket.deltaDiluarCakupan, ditahanGerbang: paket.deltaDitahan.length }, rencana: ringkas(rencana) };
    if (perintah === "rencana") {
      if (!opsi["konfirmasi-proyek"] || !opsi.rencana) throw new Error("--konfirmasi-proyek dan --rencana wajib.");
      const perId = new Map(paket.kartu.map((k) => [k.stable_key, k]));
      const klien = await masuk(supabase, opsi["konfirmasi-proyek"]);
      try {
        const h = await rekon.rekonsiliasiDb(klien, rencana, (id) => staging.jejakLamaKandidat(perId.get(id)));
        rencana = rekon.terapkanRekonsiliasi(rencana, h);
        laporan.rekonsiliasi = { sudahAdaJejakLama: h.sudahAdaJejakLama.length, tabrakanNamaBerkas: h.tabrakanNamaBerkas.length, tanggalSama: h.tanggalSama.length };
        laporan.validasiDb = await eks.validasiDb(klien, rencana);
        laporan.rencanaBeku = ringkas(rencana);
        laporan.sidikRencana = rencana.sidikRencana;
        tulis(opsi.rencana, rencana);
        laporan.detailRekonsiliasi = h;
      } finally { await klien.keluar(); }
    }
    laporan.baris = rencana.baris.map((b) => ({ id: b.local_record_id, status: b.status, alasan: b.alasan, peringatan: b.peringatan, tertunda: b.tertunda?.kekurangan ?? null }));
    tulis(opsi.laporan, laporan);
    const v = laporan.validasiDb;
    process.stdout.write(`${JSON.stringify({ ...laporan, baris: undefined, detailRekonsiliasi: undefined, validasiDb: v ? { siapMasuk: v.siapMasuk, sudahAda: v.sudahAda, ditahan: v.ditahan, pemilikBaru: v.pemilikBaru, perAlasanTahan: v.perAlasanTahan } : undefined }, null, 1)}\n`);
    return;
  }

  if (!opsi.rencana || !opsi.ledger || !opsi.laporan || !opsi["konfirmasi-proyek"]) throw new Error("--rencana, --ledger, --laporan, --konfirmasi-proyek wajib.");
  const rencana = rekon.muatRencanaBeku(JSON.parse(readFileSync(opsi.rencana, "utf8")));
  const klien = await masuk(supabase, opsi["konfirmasi-proyek"]);
  const laporan = { perintah, sidikRencana: rencana.sidikRencana, rencana: ringkas(rencana) };
  try {
    laporan.validasiDb = await eks.validasiDb(klien, rencana);
    const meta = { runId: `staging-${rencana.sidikRencana.slice(0, 12)}`, versiKontrak: rencana.versi, sha256Berkas: rencana.sha256Berkas, sidikRencana: rencana.sidikRencana, konteks: { mode: "semua-cabang" }, ukuranBatch: 150 };
    const { buku } = modBuku.BukuBesar.buka(opsi.ledger, meta, { akarRepo: ROOT });
    try {
      laporan.jalan = await eks.jalankanMigrasi(klien, rencana, buku, { ukuranBatch: 150 });
      process.stdout.write(`${JSON.stringify({ jalan: laporan.jalan }, null, 1)}\n`);
      if (laporan.jalan.status === "selesai") {
        laporan.readback = await eks.readbackMigrasi(klien, rencana, buku);
        if (laporan.readback.status !== "selisih") laporan.kartuTertunda = await eks.simpanKartuTertunda(klien, rencana);
      }
      const state = buku.baca();
      laporan.perBaris = [
        ...state.batches.flatMap((b) => b.baris.map((lr, i) => ({ ...b.hasil?.[i], customer_id: lr.customer_id, pet_id: lr.pet_id, catatan: lr.catatan ?? [] }))),
        ...state.ditahanIdentitas.map((d) => ({ local_record_id: d.local_record_id, status: "ditahan", alasan: d.alasan })),
      ];
      laporan.pemilikBaru = state.pemilikBaru ?? [];
    } finally { buku.tutup(); }
  } finally { await klien.keluar(); }
  tulis(opsi.laporan, laporan);
  const kt = {};
  for (const k of laporan.kartuTertunda ?? []) kt[k.status] = (kt[k.status] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({ readback: laporan.readback && { ok: laporan.readback.ok, status: laporan.readback.status, diperiksa: laporan.readback.diperiksa, selisih: laporan.readback.selisih.length }, kartuTertunda: kt, pemilikBaru: laporan.pemilikBaru.length }, null, 1)}\n`);
  if (laporan.jalan.status !== "selesai") process.exitCode = 3;
  else if (!laporan.readback?.ok) process.exitCode = 4;
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
