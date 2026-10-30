import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bacaMaster } from "@/lib/migrasi-kartu-medis/baca-master";
import { BukuBesar, type MetaRun } from "@/lib/migrasi-kartu-medis/buku-besar";
import { jalankanMigrasi, readbackMigrasi, validasiJawabanBulk, type PayloadKirim } from "@/lib/migrasi-kartu-medis/eksekutor";
import type { KlienMigrasi, KonteksJaringan, NamaRpcMigrasi } from "@/lib/migrasi-kartu-medis/klien";
import { kunciHpIndonesia } from "@/lib/kontak";
import { kunciTeksImporRekamMedis as kunci } from "@/lib/impor-rekam-medis";
import { buatRencana, kanonikJson, type Rencana } from "@/lib/migrasi-kartu-medis/rencana";
import { buatMaster, masterDasar, type FixtureMaster } from "./fixtures/master-kartu-medis";

const OWNER = "0f000000-0000-4000-8000-000000000001";
const CABANG = "0f000000-0000-4000-8000-0000000000b1";
let seq = 0;
const uuid = () => `0e000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

type Cust = { id: string; name: string; phone: string; address: string | null };
type Pet = { id: string; customer_id: string; name: string; species: string | null; breed: string | null; gender: string | null; dob: string | null; status: string };
type Visit = { id: string; key: string; hash: string; customer_id: string; pet_id: string; p: PayloadKirim };

/** DB palsu sederhana: jejak persis, sidik = isi tanpa UUID, pemilik/anabul dibuat bila null (cermin aturan RPC). */
class DbPalsu {
  role = "OWNER"; active = true;
  customers: Cust[] = []; pets: Pet[] = []; visits: Visit[] = [];
  putus: null | "sebelum" | "sesudah" = null;
  rusak: null | ((data: unknown[]) => unknown) = null;
  panggilan: NamaRpcMigrasi[] = [];
  hookScan: null | (() => void) = null;
  klien(konteks: KonteksJaringan = { mode: "semua-cabang" }): KlienMigrasi {
    return {
      konteks,
      idPengguna: async () => OWNER,
      pilih: async (tabel, _kolom, ids) => {
        if (tabel === "profiles") return { data: ids.includes(OWNER) ? [{ id: OWNER, role: this.role, is_active: this.active }] : [], error: null };
        const src = tabel === "customers" ? this.customers : this.pets;
        return { data: src.filter((r) => ids.includes(r.id)).map((r) => ({ ...r })), error: null };
      },
      rpc: async (nama, args) => {
        this.panggilan.push(nama);
        if (nama === "import_legacy_identity_scan") {
          this.hookScan?.();
          const owners = args.p_owner_keys as string[]; const phones = args.p_phone_keys as string[];
          const calon = this.customers.filter((c) => owners.includes(kunci(c.name)) || phones.includes(kunciHpIndonesia(c.phone)));
          return { data: { sudah_ada: this.visits.filter((v) => (args.p_source_keys as string[]).includes(v.key)).map((v) => v.key),
            customers: calon.map(({ id, name, phone }) => ({ id, name, phone })),
            pets: this.pets.filter((p) => calon.some((c) => c.id === p.customer_id)).map(({ id, customer_id, name }) => ({ id, customer_id, name })) }, error: null };
        }
        if (nama === "import_legacy_medical_records_bulk") {
          if (this.putus === "sebelum") { this.putus = null; throw new Error("ECONNRESET"); }
          const out = (args.p_rows as PayloadKirim[]).map((p) => this.simpan(p));
          if (this.putus === "sesudah") { this.putus = null; throw new Error("ECONNRESET"); }
          return { data: this.rusak ? this.rusak(out) : out, error: null };
        }
        if (nama === "detail_riwayat_bersama") {
          const v = this.visits.find((x) => x.id === args.p_visit);
          return { data: v ? [this.baris(v)] : [], error: null };
        }
        if (nama === "riwayat_bersama_hewan") {
          const rows = this.visits.filter((v) => v.pet_id === args.p_pet).map((v) => this.baris(v));
          return { data: rows.slice(args.p_dari as number, (args.p_dari as number) + (args.p_jumlah as number)), error: null };
        }
        return { data: null, error: { message: "unknown" } };
      },
    };
  }
  baris(v: Visit) {
    return { visit_id: v.id, pet_id: v.pet_id, customer_id: v.customer_id, tanggal: v.p.record_date, dokter: v.p.doctor, keluhan: v.p.note ?? v.p.anamnesis,
      diagnosis: v.p.diagnosis, anamnesis: v.p.anamnesis, gejala_klinis: v.p.clinical_findings, terapi: v.p.therapy };
  }
  simpan(p: PayloadKirim) {
    const { customer_id: _c, pet_id: _p, ...isi } = p; void _c; void _p;
    const hash = kanonikJson(isi);
    const ada = this.visits.find((v) => v.key === p.source_key);
    if (ada) return ada.hash === hash ? { source_key: p.source_key, status: "sudah_ada", reason: null, visit_id: ada.id } : { source_key: p.source_key, status: "ditahan", reason: "Jejak sumber bentrok: x", visit_id: null };
    let cust = p.customer_id ? this.customers.find((c) => c.id === p.customer_id) : this.customers.find((c) => kunci(c.name) === kunci(p.owner_name) && kunciHpIndonesia(c.phone) === kunciHpIndonesia(p.phone));
    if (!cust) { cust = { id: uuid(), name: p.owner_name, phone: p.phone, address: p.address }; this.customers.push(cust); }
    let pet = p.pet_id ? this.pets.find((x) => x.id === p.pet_id) : this.pets.find((x) => x.customer_id === cust!.id && x.name.trim().toLowerCase() === p.patient_name.trim().toLowerCase());
    if (!pet) { pet = { id: uuid(), customer_id: cust.id, name: p.patient_name, species: p.species, breed: p.breed, gender: p.gender, dob: p.dob, status: "Aktif" }; this.pets.push(pet); }
    const v = { id: uuid(), key: p.source_key, hash, customer_id: cust.id, pet_id: pet.id, p };
    this.visits.push(v);
    return { source_key: p.source_key, status: "tersimpan", reason: null, visit_id: v.id };
  }
}

const OPSI = { hariIni: "2026-10-30", tanggalMinimum: "1990-01-01" };
async function rencana(f: FixtureMaster): Promise<Rencana> {
  const h = await bacaMaster(await buatMaster(f));
  if (!h.ok) throw new Error(h.galat.join(";"));
  return buatRencana(h.versi, h.sha256, h.blok, OPSI);
}
const meta = (r: Rencana, konteks: KonteksJaringan = { mode: "semua-cabang" }, ukuranBatch = 2): MetaRun =>
  ({ runId: "run-uji", versiKontrak: r.versi, sha256Berkas: r.sha256Berkas, sidikRencana: r.sidikRencana, konteks, ukuranBatch });
const folder = () => join(mkdtempSync(join(tmpdir(), "mkm-")), "ledger");

describe("eksekutor + ledger (klien palsu)", () => {
  it("runs bounded batches, records only pseudonymous metadata, and reads back every visit field by field", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(5)); const dir = folder();
    const { buku } = BukuBesar.buka(dir, meta(r));
    const hasil = await jalankanMigrasi(db.klien(), r, buku, { ukuranBatch: 2 });
    expect(hasil).toMatchObject({ status: "selesai", tersimpan: 5, sudahAda: 0, batchDiakui: 3, belumDikirim: 0 });
    expect(db.customers).toHaveLength(1); expect(db.pets).toHaveLength(1);
    const isiLedger = readFileSync(join(dir, "state.json"), "utf8") + readFileSync(join(dir, "run.json"), "utf8");
    for (const phi of ["UJI PEMILIK", "081234567890", "UJI KUCING", "UJI DIAGNOSIS", "uji pemilik::"]) expect(isiLedger).not.toContain(phi);
    expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const rb = await readbackMigrasi(db.klien(), r, buku);
    expect(rb).toEqual({ ok: true, diperiksa: 5, selisih: [] });
    buku.tutup();
  });
  it("replays the same file with zero new rows (sudah_ada with the same visit ids)", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(3));
    const a = BukuBesar.buka(folder(), meta(r)).buku; await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 }); a.tutup();
    const before = db.visits.map((v) => v.id);
    const b = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, sudahAda: 3 });
    expect(db.visits.map((v) => v.id)).toEqual(before);
  });
  it("holds changed content under the same source key without touching the stored record", async () => {
    const db = new DbPalsu(); const r1 = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r1)).buku; await jalankanMigrasi(db.klien(), r1, a, { ukuranBatch: 2 }); a.tutup();
    const f = masterDasar(1); f.riwayat[0].therapy = "TERAPI BERBEDA"; const r2 = await rencana(f);
    const b = BukuBesar.buka(folder(), meta(r2)).buku;
    expect(await jalankanMigrasi(db.klien(), r2, b, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanDb: { "db.jejak_bentrok": 1 } });
    expect(db.visits[0].p.therapy).toBe("UJI TERAPI 1");
  });
  it.each(["sebelum", "sesudah"] as const)("recovers a %s-commit disconnect by resending the identical payload (no duplicates)", async (kapan) => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(3)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.putus = kapan;
    expect((await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).status).toBe("berhenti_tidak_pasti");
    const ledger = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(ledger.batches[0]).toMatchObject({ no: 1, status: "tidak_pasti" });
    const sidikAwal = ledger.batches[0].baris.map((b: { sidikPayload: string }) => b.sidikPayload);
    a.tutup();
    const b = BukuBesar.buka(dir, meta(r)).buku;
    const hasil = await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 });
    expect(hasil).toMatchObject({ status: "selesai", tersimpan: kapan === "sebelum" ? 3 : 1, sudahAda: kapan === "sebelum" ? 0 : 2 });
    expect(db.visits).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).batches[0].baris.map((x: { sidikPayload: string }) => x.sidikPayload)).toEqual(sidikAwal);
    expect((await readbackMigrasi(db.klien(), r, b)).ok).toBe(true);
  });
  it.each([
    ["a short response", (d: unknown[]) => d.slice(1)],
    ["a reordered response", (d: unknown[]) => [...d].reverse()],
    ["an unknown status", (d: unknown[]) => d.map((x) => ({ ...(x as object), status: "ok" }))],
    ["a missing visit id", (d: unknown[]) => d.map((x) => ({ ...(x as object), visit_id: null }))],
    ["a non-array", () => ({ hasil: [] })],
  ])("treats %s as uncertain, never acknowledged", async (_l, rusak) => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(2)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.rusak = rusak;
    expect((await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).status).toBe("berhenti_tidak_pasti");
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).batches[0].status).toBe("tidak_pasti");
  });
  it("validates response correspondence exactly", () => {
    const k = [{ source_key: "a::b" }, { source_key: "c::d" }] as PayloadKirim[];
    const v = "0e000000-0000-4000-8000-0000000000aa";
    expect(() => validasiJawabanBulk([{ source_key: "a::b", status: "tersimpan", visit_id: v }, { source_key: "c::d", status: "sudah_ada", visit_id: v }], k)).toThrow("visit_id ganda");
    expect(() => validasiJawabanBulk([{ source_key: "a::b", status: "ditahan", visit_id: v, reason: "x" }, { source_key: "c::d", status: "ditahan", visit_id: null }], k)).toThrow("ditahan memuat visit_id");
  });
  it("rejects resume when the file, plan, context or batch size changed", async () => {
    const r = await rencana(masterDasar(2)); const dir = folder();
    BukuBesar.buka(dir, meta(r)).buku.tutup();
    const f = masterDasar(2); f.riwayat[0].note = "lain"; const r2 = await rencana(f);
    expect(() => BukuBesar.buka(dir, meta(r2))).toThrow(/sha256Berkas, sidikRencana berubah/);
    expect(() => BukuBesar.buka(dir, meta(r, { mode: "cabang", cabangId: CABANG }))).toThrow(/konteks berubah/);
    expect(() => BukuBesar.buka(dir, meta(r, { mode: "semua-cabang" }, 3))).toThrow(/ukuranBatch berubah/);
  });
  it("holds an exclusive run lock, takes over only a dead same-host lock, and refuses a ledger inside the repo", async () => {
    const r = await rencana(masterDasar(1)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("kunci eksklusif");
    a.tutup();
    BukuBesar.buka(dir, meta(r));                            // dibiarkan terkunci (crash)
    const lock = JSON.parse(readFileSync(join(dir, "run.lock"), "utf8"));
    writeFileSync(join(dir, "run.lock"), JSON.stringify({ ...lock, pid: 2 ** 22 + 7 }));
    const takeover = BukuBesar.buka(dir, meta(r));
    expect(takeover.kunciBasiDiambil).toBe(true);
    takeover.buku.tutup();
    expect(existsSync(join(dir, "run.lock"))).toBe(false);
    expect(() => BukuBesar.buka(join(process.cwd(), "tmp-ledger"), meta(r), { akarRepo: process.cwd() })).toThrow("di dalam repo");
  });
  it.each([
    ["ADMIN", (db: DbPalsu) => { db.role = "ADMIN"; }],
    ["inactive OWNER", (db: DbPalsu) => { db.active = false; }],
  ])("denies %s before any data call", async (_l, setup) => {
    const db = new DbPalsu(); setup(db); const r = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r)).buku;
    await expect(jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).rejects.toThrow("OWNER aktif");
    expect(db.panggilan).toEqual([]);
  });
  it("requires an explicit, matching context", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r, { mode: "cabang", cabangId: "bukan-uuid" })).buku;
    await expect(jalankanMigrasi(db.klien({ mode: "cabang", cabangId: "bukan-uuid" }), r, a, { ukuranBatch: 2 })).rejects.toThrow("wajib UUID");
    const b = BukuBesar.buka(folder(), meta(r)).buku;
    await expect(jalankanMigrasi(db.klien({ mode: "cabang", cabangId: CABANG }), r, b, { ukuranBatch: 2 })).rejects.toThrow("Konteks klien berbeda");
    await expect(jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 151 })).rejects.toThrow("Ukuran batch 1–150");
  });
  it("F2: holds when more than one same-name pet exists for the owner, including an inactive one", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1" });
    db.pets.push({ id: uuid(), customer_id: db.customers[0].id, name: "UJI KUCING", species: null, breed: null, gender: null, dob: null, status: "Nonaktif" },
      { id: uuid(), customer_id: db.customers[0].id, name: "uji kucing ", species: null, breed: null, gender: null, dob: null, status: "Aktif" });
    const r = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "identitas.hewan_ganda": 1 } });
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
  });
  it("sends the single matching existing pet explicitly and holds a demographic mismatch instead of overwriting", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "uji pemilik", phone: "+62 812 3456 7890", address: "Jl. Fiktif 1" });
    db.pets.push({ id: uuid(), customer_id: db.customers[0].id, name: "UJI KUCING", species: "Kucing", breed: "Domestik", gender: "Betina", dob: "2023-05-01", status: "Aktif" });
    const r = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 1 });
    expect(db.visits[0]).toMatchObject({ customer_id: db.customers[0].id, pet_id: db.pets[0].id });
    db.pets[0].breed = "Persia";
    const f = masterDasar(2); f.riwayat.shift(); f.perSheet.shift();
    const r2 = await rencana(f); const b = BukuBesar.buka(folder(), meta(r2)).buku;
    expect(await jalankanMigrasi(db.klien(), r2, b, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "demografi.hewan.breed": 1 } });
    expect(db.pets[0].breed).toBe("Persia");
  });
  it("holds rows whose candidates changed between resolution and the batch recheck (race)", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1));
    let n = 0;
    db.hookScan = () => { if (++n === 2) db.customers.push({ id: uuid(), name: "UJI PEMILIK", phone: "089999999999", address: null }); };
    const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "identitas.kandidat_berubah": 1 } });
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
  });
  it("holds an ambiguous owner (name or phone match, not exact) without merging or inventing a phone", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "ORANG LAIN", phone: "081234567890", address: null });
    const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ ditahanIdentitas: { "identitas.perlu_keputusan_pemilik": 1 } });
    expect(db.customers).toHaveLength(1);
  });
  it("fails closed on a malformed identity scan", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    const k = db.klien();
    const rusak: KlienMigrasi = { ...k, konteks: k.konteks, rpc: async (n, args) => (n === "import_legacy_identity_scan" ? { data: { customers: [] }, error: null } : k.rpc(n, args)) };
    await expect(jalankanMigrasi(rusak, r, a, { ukuranBatch: 2 })).rejects.toThrow("tidak lengkap");
  });
  it("detects an incomplete per-pet readback (more than 1000 rows) as a failure", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });
    const pet = db.visits[0].pet_id;
    for (let i = 0; i < 1000; i += 1) db.visits.push({ ...db.visits[0], id: uuid(), key: `lain::${i}` });
    expect(db.visits.filter((v) => v.pet_id === pet)).toHaveLength(1001);
    const rb = await readbackMigrasi(db.klien(), r, a);
    expect(rb.ok).toBe(false);
    expect(rb.selisih).toContainEqual({ local_record_id: null, kode: "readback.hewan_tidak_lengkap" });
  });
  it("flags a field mismatch on readback (no auto-fix)", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });
    db.visits[0].p = { ...db.visits[0].p, therapy: "diubah" };
    expect((await readbackMigrasi(db.klien(), r, a)).selisih).toEqual([{ local_record_id: "R1", kode: "readback.terapi" }]);
  });
});
