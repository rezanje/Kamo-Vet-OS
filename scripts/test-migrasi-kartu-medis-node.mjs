#!/usr/bin/env node
/**
 * Bagian Node dari harness integrasi migrasi kartu medis (dipanggil oleh scripts/test-migrasi-kartu-medis-postgres.py).
 *
 * Eksekutor ASLI (ditranspilasi) memanggil RPC lewat adaptor `psql` yang meniru PostgREST: satu panggilan = satu
 * transaksi, `role authenticated`, klaim JWT, dan header cabang persis seperti aplikasi. Bukti ini hanya untuk DB
 * SINTETIS lokal — bukan bukti PostgREST/auth/jaringan hosted. Semua data fiktif.
 *
 * Masukan: path JSON {psql: string[], aktor: {...}, cabang: {...}}. Keluaran: satu baris JSON per kasus.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MODUL = [
  "src/lib/kontak.ts", "src/lib/impor-rekam-medis.ts",
  "src/lib/migrasi-kartu-medis/kontrak.ts", "src/lib/migrasi-kartu-medis/baca-master.ts", "src/lib/migrasi-kartu-medis/rencana.ts",
  "src/lib/migrasi-kartu-medis/klien.ts", "src/lib/migrasi-kartu-medis/identitas.ts", "src/lib/migrasi-kartu-medis/buku-besar.ts",
  "src/lib/migrasi-kartu-medis/eksekutor.ts", "src/lib/__tests__/fixtures/master-kartu-medis.ts",
];

function muat() {
  const ts = require("typescript");
  const out = join(ROOT, "node_modules/.cache/migrasi-kartu-medis-harness");
  for (const rel of MODUL) {
    const hasil = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: rel,
    });
    const tujuan = join(out, rel.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(tujuan), { recursive: true });
    writeFileSync(tujuan, hasil.outputText);
  }
  const m = (p) => require(join(out, p));
  return {
    baca: m("src/lib/migrasi-kartu-medis/baca-master.js"), rencana: m("src/lib/migrasi-kartu-medis/rencana.js"),
    buku: m("src/lib/migrasi-kartu-medis/buku-besar.js"), eks: m("src/lib/migrasi-kartu-medis/eksekutor.js"),
    fixture: m("src/lib/__tests__/fixtures/master-kartu-medis.js"),
  };
}

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jalankanPsql(sql) {
  const r = spawnSync(cfg.psql[0], [...cfg.psql.slice(1), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", env: { ...process.env, PSQLRC: "/dev/null" } });
  if (r.status !== 0) {
    const pesan = (r.stderr || "").split("\n").find((l) => l.startsWith("ERROR")) ?? r.stderr;
    return { ok: false, pesan: pesan.trim() };
  }
  const baris = r.stdout.trim().split("\n");
  return { ok: true, keluaran: baris[baris.length - 1] ?? "" };
}
const tag = () => { const t = `q${randomBytes(6).toString("hex")}`; return [`$${t}$`, `$${t}$`]; };
const lit = (text) => { const [a, b] = tag(); if (text.includes(a)) throw new Error("tag bentrok"); return `${a}${text}${b}`; };

/** Superuser (fixture/inspeksi saja). */
export function sqlSuper(sql) {
  const r = jalankanPsql(sql);
  if (!r.ok) throw new Error(r.pesan);
  return r.keluaran;
}

/** Klien seperti PostgREST: satu panggilan psql = satu transaksi sebagai `authenticated`. */
function klienPsql(uid, konteks, opsi = {}) {
  const prefix = () => {
    const header = opsi.headerPaksa !== undefined ? opsi.headerPaksa : (konteks.mode === "cabang" ? konteks.cabangId : null);
    return "set role authenticated;\n"
      + "select set_config('request.jwt.claim.role','authenticated',false);\n"
      + `select set_config('request.jwt.claim.sub',${lit(uid ?? "")},false);\n`
      + `select set_config('request.headers',${lit(header ? JSON.stringify({ "x-kamo-operational-branch": header }) : "")},false);\n`;
  };
  const jawab = (r) => (r.ok ? { data: JSON.parse(r.keluaran), error: null } : { data: null, error: { message: r.pesan } });
  const arr = (xs) => `array(select jsonb_array_elements_text(${lit(JSON.stringify(xs))}::jsonb))`;
  return {
    konteks,
    idPengguna: async () => uid,
    pilih: async (tabel, kolom, ids) => {
      if (!["profiles", "customers", "pets"].includes(tabel) || !/^[a-z_,]+$/.test(kolom)) throw new Error("pilih tidak sah");
      return jawab(jalankanPsql(`${prefix()}select coalesce(jsonb_agg(t),'[]'::jsonb) from (select ${kolom} from public.${tabel} where id = any(${arr(ids)}::uuid[])) t;`));
    },
    rpc: async (nama, args) => {
      let sql;
      if (nama === "import_legacy_identity_scan") sql = `select public.import_legacy_identity_scan(${arr(args.p_source_keys)}, ${arr(args.p_owner_keys)}, ${arr(args.p_phone_keys)});`;
      else if (nama === "import_legacy_medical_records_bulk") sql = `select public.import_legacy_medical_records_bulk(${lit(JSON.stringify(args.p_rows))}::jsonb);`;
      else if (nama === "hasil_impor_rekam_medis") sql = `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.hasil_impor_rekam_medis(${arr(args.p_keys)}) t;`;
      else if (nama === "detail_riwayat_bersama") sql = `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.detail_riwayat_bersama(${lit(String(args.p_visit))}::uuid) t;`;
      else if (nama === "riwayat_bersama_hewan") {
        if (!Number.isInteger(args.p_dari) || !Number.isInteger(args.p_jumlah)) throw new Error("paginasi tidak sah");
        sql = `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.riwayat_bersama_hewan(${lit(String(args.p_pet))}::uuid, ${args.p_dari}, ${args.p_jumlah}) t;`;
      } else throw new Error(`rpc tidak dikenal ${nama}`);
      if (opsi.sebelumRpc) await opsi.sebelumRpc(nama);
      const r = jawab(jalankanPsql(prefix() + sql));
      if (opsi.sesudahRpc) await opsi.sesudahRpc(nama, r);
      return r;
    },
  };
}

const hasil = [];
const catat = (kasus, ok, detail) => { hasil.push({ kasus, ok: !!ok, detail: String(detail).slice(0, 300) }); };

async function main() {
  const { baca, rencana: R, buku: B, eks, fixture } = muat();
  const { OWNER, ADMIN, DOCTOR, OWNER_OFF } = cfg.aktor;
  const { A: CAB_A, C: CAB_C } = cfg.cabang;
  const SEMUA = { mode: "semua-cabang" };
  const OPSI = { hariIni: "2026-10-30", tanggalMinimum: "1990-01-01" };
  const buatRencana = async (f) => {
    const h = await baca.bacaMaster(await fixture.buatMaster(f));
    if (!h.ok) throw new Error(h.galat.join("; "));
    return R.buatRencana(h.versi, h.sha256, h.blok, OPSI, h.peringatan);
  };
  const ledger = (r, konteks = SEMUA, ukuranBatch = 2) => B.BukuBesar.buka(join(mkdtempSync(join(tmpdir(), "mkm-int-")), "ledger"),
    { runId: randomBytes(4).toString("hex"), versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks, ukuranBatch }).buku;
  const hitung = (where) => Number(sqlSuper(`select count(*) from public.visits where ${where};`));
  const tgl = fixture.tgl;

  // Master roundtrip: 2 pemilik, 3 hewan, 5 riwayat; teks batas, baris baru/tepi spasi, HP setara (+62 vs jejak 08).
  const mRoundtrip = () => {
    const f = fixture.masterDasar(3);
    f.pemilik[0].phone = "+62 812-3456-7890";
    f.riwayat[0].diagnosis = `  ${"D".repeat(9990)}\nakhir  `;
    f.riwayat[0].doctor = "d".repeat(100);
    f.riwayat[1].note = null;                                   // keluhan = anamnesis
    f.pemilik.push({ local_owner_id: "P2", name: "UJI PEMILIK DUA", phone: "081300000002", address: null, decision: "SETUJU" });
    f.hewan.push({ local_pet_id: "H2", local_owner_id: "P2", name: "UJI ANJING", species: "Anjing", gender: "Jantan", dob: null, dob_raw: "2021", decision: "SETUJU" },
      { local_pet_id: "H3", local_owner_id: "P2", name: "UJI BURUNG", decision: "SETUJU" });
    for (const [id, pet, d] of [["R4", "H2", "2026-02-01"], ["R5", "H3", "2026-02-02"]]) {
      f.riwayat.push({ local_record_id: id, local_pet_id: pet, record_date: tgl(d), record_no: null, doctor: "drh. Dua", note: `Keluhan ${id}`,
        anamnesis: null, clinical_findings: null, diagnosis: `Dx ${id}`, therapy: `Tx ${id}`, source_sheet: "Sheet1", decision: "SETUJU" });
      f.perSheet.push({ local_ref: id, file: `${id}.xlsx`, sheet: "Sheet1", source_key: `${id}.xlsx::Sheet1`, tab_date: tgl(d) });
    }
    return f;
  };

  // 1) Peran salah / nonaktif / ADMIN end-to-end ditolak sebelum panggilan data.
  const r1 = await buatRencana(mRoundtrip());
  for (const [nama, uid] of [["ADMIN", ADMIN], ["DOCTOR", DOCTOR], ["OWNER nonaktif", OWNER_OFF], ["tanpa JWT", null]]) {
    const panggil = [];
    const k = klienPsql(uid, SEMUA, { sebelumRpc: (n) => panggil.push(n) });
    const b = ledger(r1);
    let pesan = "";
    try { await eks.jalankanMigrasi(k, r1, b, { ukuranBatch: 2 }); } catch (e) { pesan = e.message; }
    b.tutup();
    catat(`Peran ${nama}: ditolak sebelum RPC data`, pesan && !panggil.length, pesan);
  }
  // DB tetap otoritas: DOCTOR memanggil RPC simpan massal langsung -> ditolak DB.
  {
    const k = klienPsql(DOCTOR, SEMUA);
    const { error } = await k.rpc("import_legacy_medical_records_bulk", { p_rows: [{ source_key: "x::y" }] });
    catat("DB menolak DOCTOR memanggil simpan massal langsung", error && /OWNER\/ADMIN/.test(error.message), error?.message);
  }

  // 2) Roundtrip penuh (OWNER, Semua cabang) + readback per field.
  const b1 = ledger(r1);
  const j1 = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r1, b1, { ukuranBatch: 2 });
  catat("Roundtrip: 5 riwayat tersimpan dalam 3 batch", j1.status === "selesai" && j1.tersimpan === 5 && j1.batchDiakui === 3, JSON.stringify(j1));
  const rb1 = await eks.readbackMigrasi(klienPsql(OWNER, SEMUA), r1, b1);
  catat("Readback: kunjungan→hewan→pemilik + tanggal/dokter/keluhan/anamnesis/gejala/diagnosis/terapi + demografi sama persis", rb1.ok && rb1.diperiksa === 5, JSON.stringify(rb1));
  b1.tutup();
  catat("Pemilik/hewan dibuat sekali (2 pemilik, 3 hewan baru)", sqlSuper("select count(*) from public.customers where name like 'UJI PEMILIK%'") === "2" && sqlSuper("select count(*) from public.pets where name in ('UJI KUCING','UJI ANJING','UJI BURUNG')") === "3", "");
  catat("Teks klinis batas tanpa potong (spasi tepi & baris baru utuh)", sqlSuper(`select length(m.diagnosis)=10000 and m.diagnosis like '  %' and m.diagnosis like '%akhir  ' from public.visits v join public.medical_records m on m.visit_id=v.id where v.legacy_source_key='uji pemilik::081234567890::uji kucing::15012026';`) === "t", "");
  catat("HP setara disimpan apa adanya, jejak tidak ditulis ulang", sqlSuper("select count(*) from public.customers where phone='+62 812-3456-7890'") === "1" && hitung("legacy_source_key='uji pemilik::081234567890::uji kucing::15012026'") === 1, "");
  catat("dob parsial tidak dikirim (NULL)", sqlSuper("select dob is null from public.pets where name='UJI ANJING'") === "t", "");

  // 3) Replay -> 0 baru, visit_id sama.
  const sebelum = sqlSuper("select string_agg(id::text, ',' order by id) from public.visits where legacy_source_key is not null");
  const b2 = ledger(r1);
  const j2 = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r1, b2, { ukuranBatch: 2 });
  b2.tutup();
  catat("Replay berkas sama: 0 baru, 5 sudah_ada, visit sama", j2.tersimpan === 0 && j2.sudahAda === 5 && sqlSuper("select string_agg(id::text, ',' order by id) from public.visits where legacy_source_key is not null") === sebelum, JSON.stringify(j2));

  // 4) Isi berubah dengan jejak sama -> ditahan DB, riwayat lama utuh.
  const fUbah = mRoundtrip(); fUbah.riwayat[2].therapy = "TERAPI DIUBAH";
  const r4 = await buatRencana(fUbah);
  const b4 = ledger(r4);
  const j4 = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r4, b4, { ukuranBatch: 2 });
  b4.tutup();
  catat("Isi berubah jejak sama: ditahan (bentrok), riwayat lama tidak berubah", j4.ditahanDb["db.jejak_bentrok"] === 1 && j4.tersimpan === 0
    && sqlSuper("select m.catatan_resep from public.visits v join public.medical_records m on m.visit_id=v.id where v.legacy_source_key like '%::17012026'") === "UJI TERAPI 3", JSON.stringify(j4));

  // 5) Putus sebelum / sesudah commit -> lanjutkan payload identik, tanpa duplikat.
  for (const kapan of ["sebelum", "sesudah"]) {
    const f = fixture.masterDasar(3);
    f.pemilik[0] = { ...f.pemilik[0], name: `UJI PUTUS ${kapan}`, phone: kapan === "sebelum" ? "081500000001" : "081500000002" };
    f.perSheet.forEach((m, i) => { m.source_key = `putus-${kapan}-${i}.xlsx::Sheet1`; m.file = `putus-${kapan}-${i}.xlsx`; m.sheet = "Sheet1"; });
    f.riwayat.forEach((r) => { r.source_sheet = "Sheet1"; });
    const r = await buatRencana(f);
    const dir = join(mkdtempSync(join(tmpdir(), "mkm-putus-")), "ledger");
    const meta = { runId: "putus", versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks: SEMUA, ukuranBatch: 2 };
    let sekali = true;
    const k = klienPsql(OWNER, SEMUA, {
      sebelumRpc: (n) => { if (kapan === "sebelum" && sekali && n === "import_legacy_medical_records_bulk") { sekali = false; throw new Error("ECONNRESET"); } },
      sesudahRpc: (n) => { if (kapan === "sesudah" && sekali && n === "import_legacy_medical_records_bulk") { sekali = false; throw new Error("ECONNRESET"); } },
    });
    const ba = B.BukuBesar.buka(dir, meta).buku;
    const ja = await eks.jalankanMigrasi(k, r, ba, { ukuranBatch: 2 });
    ba.tutup();
    const bb = B.BukuBesar.buka(dir, meta).buku;
    const jb = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r, bb, { ukuranBatch: 2 });
    const rb = await eks.readbackMigrasi(klienPsql(OWNER, SEMUA), r, bb);
    bb.tutup();
    const n = hitung(`legacy_source_key like 'putus-${kapan}-%'`);
    catat(`Putus ${kapan} commit: berhenti tidak pasti, lanjutkan identik, 3 riwayat tanpa duplikat, readback ok`,
      ja.status === "berhenti_tidak_pasti" && jb.status === "selesai" && n === 3 && rb.ok
      && (kapan === "sebelum" ? jb.tersimpan === 3 : jb.sudahAda === 2 && jb.tersimpan === 1), JSON.stringify({ ja, jb, n, rb: rb.ok }));
  }

  // 6) Atomisitas: panggilan ke-2 gagal level panggilan (header cabang nonaktif) -> batch 1 tetap, batch 2 nol.
  {
    const f = fixture.masterDasar(4);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI ATOM", phone: "081600000001" };
    f.perSheet.forEach((m, i) => { m.source_key = `atom-${i}.xlsx::Sheet1`; m.file = `atom-${i}.xlsx`; m.sheet = "Sheet1"; });
    f.riwayat.forEach((r) => { r.source_sheet = "Sheet1"; });
    const r = await buatRencana(f);
    const dir = join(mkdtempSync(join(tmpdir(), "mkm-atom-")), "ledger");
    const meta = { runId: "atom", versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks: SEMUA, ukuranBatch: 2 };
    let ke = 0;
    const kSalah = klienPsql(OWNER, SEMUA);
    const kBenar = klienPsql(OWNER, SEMUA);
    const kCampur = { ...kBenar, rpc: async (n, a) => (n === "import_legacy_medical_records_bulk" && ++ke === 2 ? klienPsql(OWNER, SEMUA, { headerPaksa: CAB_C }).rpc(n, a) : kSalah.rpc(n, a)) };
    const ba = B.BukuBesar.buka(dir, meta).buku;
    const ja = await eks.jalankanMigrasi(kCampur, r, ba, { ukuranBatch: 2 });
    ba.tutup();
    const setelahGagal = hitung("legacy_source_key like 'atom-%'");
    const bb = B.BukuBesar.buka(dir, meta).buku;
    const jb = await eks.jalankanMigrasi(kBenar, r, bb, { ukuranBatch: 2 });
    bb.tutup();
    catat("Atomisitas: batch 1 ter-commit, batch 2 gagal level panggilan = nol baris; lanjutkan melengkapi", ja.status === "berhenti_tidak_pasti" && setelahGagal === 2 && jb.tersimpan === 4 /* kumulatif per ledger */ && jb.batchDiakui === 2 && hitung("legacy_source_key like 'atom-%'") === 4, JSON.stringify({ ja, setelahGagal, jb }));
  }

  // 7) Gagal per baris tidak membatalkan baris lain di batch yang sama (jejak bentrok dengan riwayat lama).
  {
    const f = fixture.masterDasar(2);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI BARIS", phone: "081700000001" };
    f.perSheet.forEach((m, i) => { m.source_key = `baris-${i}.xlsx::Sheet1`; m.file = `baris-${i}.xlsx`; m.sheet = "Sheet1"; });
    f.riwayat.forEach((r) => { r.source_sheet = "Sheet1"; });
    sqlSuper(`set session_replication_role=replica; insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-000000000001','UJI LAMA','081799999999');
      insert into public.pets(id,customer_id,name) values ('0d000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000001','UJI LAMA');
      insert into public.visits(id,customer_id,pet_id,poli,status,legacy_source_key,legacy_source_hash) values ('0d000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002','Poli Umum','Selesai','baris-0.xlsx::Sheet1','hash-lama');
      set session_replication_role=origin;`);
    const r = await buatRencana(f);
    const b = ledger(r);
    const j = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r, b, { ukuranBatch: 2 });
    b.tutup();
    catat("Per baris: satu ditahan (jejak bentrok), baris lain di kiriman yang sama tersimpan", j.tersimpan === 1 && j.ditahanDb["db.jejak_bentrok"] === 1 && j.batchDiakui === 1, JSON.stringify(j));
  }

  // 8) F2 di DB nyata: dua anabul senama (satu nonaktif) -> TAHAN sebelum RPC simpan.
  {
    sqlSuper(`insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-000000000011','UJI F2','081800000001');
      insert into public.pets(id,customer_id,name,status) values ('0d000000-0000-4000-8000-000000000012','0d000000-0000-4000-8000-000000000011','UJI KUCING','Nonaktif'),
        ('0d000000-0000-4000-8000-000000000013','0d000000-0000-4000-8000-000000000011','Uji Kucing','Aktif');`);
    const f = fixture.masterDasar(1);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI F2", phone: "081800000001", address: null };
    f.hewan[0] = { ...f.hewan[0], species: null, breed: null, gender: null, dob: null };
    f.perSheet[0] = { ...f.perSheet[0], source_key: "f2.xlsx::Sheet1", file: "f2.xlsx", sheet: "Sheet1" };
    f.riwayat[0].source_sheet = "Sheet1";
    const r = await buatRencana(f);
    const panggil = [];
    const b = ledger(r);
    const j = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA, { sebelumRpc: (n) => panggil.push(n) }), r, b, { ukuranBatch: 2 });
    b.tutup();
    catat("F2: anabul senama >1 (termasuk nonaktif) ditahan, simpan massal tidak dipanggil", j.ditahanIdentitas["identitas.hewan_ganda"] === 1 && !panggil.includes("import_legacy_medical_records_bulk"), JSON.stringify(j));
  }

  // 9) Konteks cabang A (header selalu dikirim) bekerja end-to-end; cabang nonaktif ditolak DB.
  {
    const f = fixture.masterDasar(1);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI CABANG", phone: "081900000001" };
    f.perSheet[0] = { ...f.perSheet[0], source_key: "cabang.xlsx::Sheet1", file: "cabang.xlsx", sheet: "Sheet1" };
    f.riwayat[0].source_sheet = "Sheet1";
    const r = await buatRencana(f);
    const kA = { mode: "cabang", cabangId: CAB_A };
    const headers = [];
    const kli = klienPsql(OWNER, kA, { sebelumRpc: () => headers.push(kA.cabangId) });
    const b = ledger(r, kA);
    const j = await eks.jalankanMigrasi(kli, r, b, { ukuranBatch: 2 });
    const rb = await eks.readbackMigrasi(kli, r, b);
    b.tutup();
    catat("Cabang aktif A (header dikirim): tersimpan tanpa cabang + readback RS-2 ok", j.tersimpan === 1 && rb.ok && sqlSuper("select branch_id is null from public.visits where legacy_source_key='cabang.xlsx::Sheet1'") === "t", JSON.stringify({ j, rb }));
    const kC = { mode: "cabang", cabangId: CAB_C };
    const rC = await buatRencana({ ...f, perSheet: [{ ...f.perSheet[0], source_key: "cabang-c.xlsx::Sheet1", file: "cabang-c.xlsx" }] });
    const bC = ledger(rC, kC);
    let pesan = "";
    let jC = null;
    try { jC = await eks.jalankanMigrasi(klienPsql(OWNER, kC), rC, bC, { ukuranBatch: 2 }); } catch (e) { pesan = e.message; }
    bC.tutup();
    catat("Cabang nonaktif C: tidak ada yang tersimpan (ditolak DB atau gagal tertutup)", hitung("legacy_source_key='cabang-c.xlsx::Sheet1'") === 0 && (pesan || jC?.status === "berhenti_tidak_pasti"), pesan || JSON.stringify(jC));
  }

  // 10) R1 di DB nyata: percobaan pertama putus SEBELUM commit, lalu aktor lain membuat pemilik persis + dua anabul senama
  //     (satu nonaktif). Lanjutan wajib berhenti tidak pasti tanpa memanggil simpan massal (fallback LIMIT 1 tidak tersentuh).
  {
    const f = fixture.masterDasar(1);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI R1", phone: "082000000001", address: null };
    f.hewan[0] = { ...f.hewan[0], species: null, breed: null, gender: null, dob: null };
    f.perSheet[0] = { ...f.perSheet[0], source_key: "r1.xlsx::Sheet1", file: "r1.xlsx", sheet: "Sheet1" };
    f.riwayat[0].source_sheet = "Sheet1";
    const r = await buatRencana(f);
    const dir = join(mkdtempSync(join(tmpdir(), "mkm-r1-")), "ledger");
    const meta = { runId: "r1", versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks: SEMUA, ukuranBatch: 2 };
    let sekali = true;
    const ba = B.BukuBesar.buka(dir, meta).buku;
    await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA, { sebelumRpc: (n) => { if (sekali && n === "import_legacy_medical_records_bulk") { sekali = false; throw new Error("ECONNRESET"); } } }), r, ba, { ukuranBatch: 2 });
    ba.tutup();
    sqlSuper(`insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-000000000021','UJI R1','082000000001');
      insert into public.pets(id,customer_id,name,status) values ('0d000000-0000-4000-8000-000000000022','0d000000-0000-4000-8000-000000000021','UJI KUCING','Nonaktif'),
        ('0d000000-0000-4000-8000-000000000023','0d000000-0000-4000-8000-000000000021','uji kucing','Aktif');`);
    const panggil = [];
    const bb = B.BukuBesar.buka(dir, meta).buku;
    const jb = await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA, { sebelumRpc: (n) => panggil.push(n) }), r, bb, { ukuranBatch: 2 });
    bb.tutup();
    catat("R1: ambiguitas muncul sebelum commit -> lanjutan berhenti tidak pasti, simpan massal TIDAK dipanggil, nol riwayat",
      jb.status === "berhenti_tidak_pasti" && jb.sebab === "identitas_berubah_sebelum_ulang" && !panggil.includes("import_legacy_medical_records_bulk")
      && hitung("legacy_source_key='r1.xlsx::Sheet1'") === 0, JSON.stringify({ jb, panggil }));
  }

  // 11) R2 di DB nyata: ledger awalan (sebagian) ditolak sebelum bacaan DB apa pun.
  {
    const f = fixture.masterDasar(3);
    f.pemilik[0] = { ...f.pemilik[0], name: "UJI R2", phone: "082100000001" };
    f.perSheet.forEach((m, i) => { m.source_key = `r2-${i}.xlsx::Sheet1`; m.file = `r2-${i}.xlsx`; m.sheet = "Sheet1"; });
    f.riwayat.forEach((x) => { x.source_sheet = "Sheet1"; });
    const r = await buatRencana(f);
    const dir = join(mkdtempSync(join(tmpdir(), "mkm-r2-")), "ledger");
    const meta = { runId: "r2", versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks: SEMUA, ukuranBatch: 2 };
    const ba = B.BukuBesar.buka(dir, meta).buku;
    await eks.jalankanMigrasi(klienPsql(OWNER, SEMUA), r, ba, { ukuranBatch: 2 });
    ba.tutup();
    const st = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    writeFileSync(join(dir, "state.json"), JSON.stringify({ ...st, batches: st.batches.slice(0, 1) }));
    const panggil = [];
    const bb = B.BukuBesar.buka(dir, meta).buku;
    let pesan = "";
    try { await eks.readbackMigrasi(klienPsql(OWNER, SEMUA, { sebelumRpc: (n) => panggil.push(n) }), r, bb); } catch (e) { pesan = e.message; }
    bb.tutup();
    catat("R2: readback menolak ledger awalan yang menyembunyikan baris, tanpa RPC", /Ledger tidak lengkap/.test(pesan) && !panggil.length, pesan);
  }

  process.stdout.write(hasil.map((h) => JSON.stringify(h)).join("\n") + "\n");
}

main().catch((e) => { process.stdout.write(JSON.stringify({ kasus: "harness node", ok: false, detail: e.stack || String(e) }) + "\n"); process.exitCode = 1; });
