import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bacaMaster } from "@/lib/migrasi-kartu-medis/baca-master";
import { BukuBesar, type MetaRun } from "@/lib/migrasi-kartu-medis/buku-besar";
import { jalankanMigrasi, readbackMigrasi, simpanKartuTertunda, validasiJawabanBulk, type PayloadKirim } from "@/lib/migrasi-kartu-medis/eksekutor";
import type { KartuPemilikBaru, KlienMigrasi, KonteksJaringan, NamaRpcMigrasi } from "@/lib/migrasi-kartu-medis/klien";
import { kunciHpIndonesia } from "@/lib/kontak";
import { kunciTeksImporRekamMedis as kunci } from "@/lib/impor-rekam-medis";
import { buatRencana, kanonikJson, type Rencana } from "@/lib/migrasi-kartu-medis/rencana";
import { buatMaster, masterDasar, tgl, type FixtureMaster } from "./fixtures/master-kartu-medis";

const OWNER = "0f000000-0000-4000-8000-000000000001";
const CABANG = "0f000000-0000-4000-8000-0000000000b1";
let seq = 0;
const uuid = () => `0e000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

type Cust = { id: string; name: string; phone: string; address: string | null; imported_at?: string | null };
type Pet = { id: string; customer_id: string; name: string; species: string | null; breed: string | null; gender: string | null; dob: string | null; status: string };
type Visit = { id: string; key: string; hash: string; customer_id: string; pet_id: string; p: PayloadKirim };

/** DB palsu sederhana: jejak persis, sidik = isi tanpa UUID, pemilik/anabul dibuat bila null (cermin aturan RPC). */
class DbPalsu {
  role = "OWNER"; active = true;
  customers: Cust[] = []; pets: Pet[] = []; visits: Visit[] = [];
  putus: null | "sebelum" | "sesudah" = null;
  rusak: null | ((data: unknown[]) => unknown) = null;
  panggilan: NamaRpcMigrasi[] = [];
  pilihan: string[] = [];
  rs1Rusak = false;
  hookScan: null | (() => void) = null;
  buatGagal: null | "sebelum" | "sesudah" = null;
  kartuDibuat: KartuPemilikBaru[] = [];
  tertunda = new Map<string, { id: string; isi: string }>();
  klien(konteks: KonteksJaringan = { mode: "semua-cabang" }): KlienMigrasi {
    return {
      konteks,
      buatPemilik: async (kartu) => {
        if (this.buatGagal === "sebelum") { this.buatGagal = null; throw new Error("ECONNRESET"); }
        const c = { id: uuid(), name: kartu.name, phone: kartu.phone, address: kartu.address, imported_at: kartu.imported_at };
        this.customers.push(c); this.kartuDibuat.push(kartu);
        if (this.buatGagal === "sesudah") { this.buatGagal = null; throw new Error("ECONNRESET"); }
        return { data: [{ id: c.id }], error: null };
      },
      idPengguna: async () => OWNER,
      pilih: async (tabel, _kolom, ids) => {
        this.pilihan.push(tabel);
        if (tabel === "profiles") return { data: ids.includes(OWNER) ? [{ id: OWNER, role: this.role, is_active: this.active }] : [], error: null };
        const src = tabel === "customers" ? this.customers : this.pets;
        return { data: (src as Array<{ id: string }>).filter((r) => ids.includes(r.id)).map((r) => ({ imported_at: null, ...r })), error: null };
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
        if (nama === "hasil_impor_rekam_medis") {
          if (this.rs1Rusak) return { data: null, error: { message: "gagal" } };
          const keys = args.p_keys as string[];
          return { data: this.visits.filter((v) => keys.includes(v.key)).map((v) => ({ kunci: v.key, visit_id: v.id })), error: null };
        }
        if (nama === "simpan_kartu_tertunda") {
          return { data: this.rusak ? this.rusak(args.p_rows as unknown[]) : (args.p_rows as { source_key: string; batch_sha256: string }[]).map((k) => {
            const ada = this.tertunda.get(k.source_key);
            const isi = JSON.stringify(k);
            if (!ada) { this.tertunda.set(k.source_key, { id: uuid(), isi }); return { source_key: k.source_key, status: "tersimpan", id: this.tertunda.get(k.source_key)!.id }; }
            return { source_key: k.source_key, status: ada.isi === isi ? "sudah_ada" : "bentrok", id: ada.id };
          }), error: null };
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
    expect(rb).toEqual({ ok: true, status: "terverifikasi", diperiksa: 5, disposisi: { siap: 5, denganKunjungan: 5, ditahanDb: 0, ditahanIdentitas: 0 }, selisih: [] });
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
  it("refuses a ledger inside the repo", async () => {
    const r = await rencana(masterDasar(1));
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
    // scan 1: nol kandidat -> kartu dibuat; scan 2: resolusi ulang; scan 3 (cek ulang): muncul kartu kedua dengan HP sama.
    let n = 0;
    db.hookScan = () => { if (++n === 3) db.customers.push({ id: uuid(), name: "KARTU LAIN", phone: "+62 812-3456-7890", address: null }); };
    const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "identitas.kandidat_berubah": 1 } });
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
  });
  it("treats the same phone with a different name as ONE owner: old card used, its name kept, variant noted", async () => {
    const db = new DbPalsu();
    const lama = { id: uuid(), name: "ORANG LAIN", phone: "+6281234567890", address: "Alamat lama" };
    db.customers.push(lama);
    const r = await rencana(masterDasar(2)); const dir = folder(); const a = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 2, ditahanIdentitas: {} });
    expect(db.customers).toEqual([lama]);
    expect(db.kartuDibuat).toHaveLength(0);
    expect(db.visits.every((v) => v.customer_id === lama.id)).toBe(true);
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(state.batches[0].baris[0].catatan).toEqual(expect.arrayContaining(["demografi.pemilik.name_dipertahankan", "demografi.pemilik.address_dipertahankan"]));
    expect(await readbackMigrasi(db.klien(), r, a)).toMatchObject({ ok: true, status: "terverifikasi", selisih: [] });
  });
  it("holds (never merges) when two existing cards share the phone, and never invents a phone", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "ORANG A", phone: "081234567890", address: null }, { id: uuid(), name: "ORANG B", phone: "6281234567890", address: null });
    const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "identitas.pemilik_ganda_hp": 1 } });
    expect(db.customers).toHaveLength(2);
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
  });
  it("ignores a same-name card with a different phone (phone is the primary key) and notes it", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "UJI PEMILIK", phone: "089999999999", address: null });
    const r = await rencana(masterDasar(1)); const dir = folder(); const a = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 1 });
    expect(db.kartuDibuat).toHaveLength(1);
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(state.batches[0].baris[0].catatan).toEqual(expect.arrayContaining(["identitas.pemilik_baru", "identitas.nama_sama_nomor_beda"]));
  });
  // ------------------------------------------------ batch kartu medis: HP patokan, pemilik baru bertanda impor (Q01)
  /** Dua pemilik lokal dengan HP setara (08… / +628…), nama berbeda; dua hewan lokal bernama sama + satu hewan lain. */
  const masterVarian = (genderH2: string | null = null): FixtureMaster => {
    const f = masterDasar(1);
    f.pemilik.push({ local_owner_id: "P2", name: "UJI PEMILIK VARIAN", phone: "+62 812-3456-7890", address: "Jl. Fiktif 2", decision: "SETUJU" });
    f.hewan[0].gender = null;
    f.hewan.push({ local_pet_id: "H2", local_owner_id: "P2", name: "uji kucing ", gender: genderH2, decision: "SETUJU" });
    f.hewan.push({ local_pet_id: "H3", local_owner_id: "P1", name: "UJI ANJING", species: "Anjing", decision: "SETUJU" });
    for (const [id, pet, tanggal] of [["R2", "H2", "2026-02-01"], ["R3", "H3", "2026-02-02"]] as const) {
      f.riwayat.push({ ...f.riwayat[0], local_record_id: id, local_pet_id: pet, record_date: tgl(tanggal), source_sheet: id, diagnosis: `DIAG ${id}` });
      f.perSheet.push({ local_ref: id, file: "UJI.xlsx", sheet: id, source_key: `UJI.xlsx::${id}`, tab_date: tgl(tanggal), cell_date: tgl(tanggal) });
    }
    return f;
  };
  it("creates ONE new owner card per phone (name 'A / B', imported_at set) and never sends a row without a card", async () => {
    const db = new DbPalsu(); const r = await rencana(masterVarian()); const dir = folder();
    const kiriman: PayloadKirim[] = [];
    const k = db.klien();
    const klien: KlienMigrasi = { ...k, rpc: async (n, a) => { if (n === "import_legacy_medical_records_bulk") kiriman.push(...(a.p_rows as PayloadKirim[])); return k.rpc(n, a); } };
    const a = BukuBesar.buka(dir, meta(r, undefined, 150)).buku;
    expect(await jalankanMigrasi(klien, r, a, { ukuranBatch: 150 })).toMatchObject({ status: "selesai", tersimpan: 3, ditahanIdentitas: {} });
    expect(db.kartuDibuat).toEqual([{ name: "UJI PEMILIK / UJI PEMILIK VARIAN", phone: "081234567890", address: "Jl. Fiktif 1", imported_at: expect.any(String) }]);
    expect(db.customers).toHaveLength(1);
    expect(kiriman.every((p) => p.customer_id === db.customers[0].id)).toBe(true);
    // Hewan tetap terpisah per nama: UJI KUCING (dua hewan lokal, nama setara) = satu hewan; UJI ANJING terpisah.
    expect(db.pets.map((p) => p.name).sort()).toEqual(["UJI ANJING", "UJI KUCING"]);
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(state.pemilikBaru).toEqual([{ kunciHash: expect.stringMatching(/^[0-9a-f]{64}$/), status: "dibuat", customer_id: db.customers[0].id }]);
    expect(JSON.stringify(state)).not.toContain("081234567890");
    expect(await readbackMigrasi(db.klien(), r, a)).toMatchObject({ ok: true, status: "terverifikasi", diperiksa: 3, selisih: [] });
    // Kartu tanpa penanda impor terdeteksi readback.
    db.customers[0].imported_at = null;
    expect((await readbackMigrasi(db.klien(), r, a)).selisih).toContainEqual({ local_record_id: null, kode: "readback.pemilik_baru_tanpa_penanda_impor" });
  });
  it("holds two local pets that would become one new pet with conflicting data (never guesses)", async () => {
    const f = masterVarian("Jantan"); f.hewan[0].gender = "Betina";
    const db = new DbPalsu(); const r = await rencana(f); const a = BukuBesar.buka(folder(), meta(r, undefined, 150)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 150 })).toMatchObject({ tersimpan: 1, ditahanIdentitas: { "identitas.hewan_baru_demografi_bentrok": 2 } });
    expect(db.pets.map((p) => p.name)).toEqual(["UJI ANJING"]);
  });
  it("compatible merged pet: the extra value is noted as not applied, and readback still verifies", async () => {
    const db = new DbPalsu(); const r = await rencana(masterVarian("neutered")); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r, undefined, 150)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 150 })).toMatchObject({ tersimpan: 3 });
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(state.batches[0].baris.find((b: { local_record_id: string }) => b.local_record_id === "R2").catatan).toContain("demografi.hewan.gender_tidak_diisi");
    expect(await readbackMigrasi(db.klien(), r, a)).toMatchObject({ ok: true, selisih: [] });
  });
  it("existing pet: empty field in DB = note (not overwritten); conflicting species = hold", async () => {
    const db = new DbPalsu();
    const c = { id: uuid(), name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1" };
    db.customers.push(c);
    db.pets.push({ id: uuid(), customer_id: c.id, name: "UJI KUCING", species: "Kucing", breed: null, gender: "Betina", dob: "2023-05-01", status: "Aktif" });
    const r = await rencana(masterDasar(1)); const dir = folder(); const a = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 1 });
    expect(db.pets[0].breed).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).batches[0].baris[0].catatan).toContain("demografi.hewan.breed_tidak_diisi");
    const db2 = new DbPalsu(); db2.customers.push(c);
    db2.pets.push({ id: uuid(), customer_id: c.id, name: "UJI KUCING", species: "Anjing", breed: null, gender: null, dob: null, status: "Aktif" });
    const b = BukuBesar.buka(folder(), meta(r)).buku;
    expect(await jalankanMigrasi(db2.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "demografi.hewan.species": 1 } });
  });
  it.each(["sebelum", "sesudah"] as const)("new owner card: a %s-commit disconnect stops, and resume yields exactly one card", async (kapan) => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(2)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.buatGagal = kapan;
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ status: "berhenti_tidak_pasti", sebab: "pemilik_baru_tidak_pasti", tersimpan: 0 });
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
    await expect(readbackMigrasi(db.klien(), r, a)).rejects.toThrow(/tidak pasti/);
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ status: "selesai", tersimpan: 2 });
    expect(db.customers).toHaveLength(1);
    expect(db.customers[0].imported_at).toEqual(expect.any(String));
    expect(await readbackMigrasi(db.klien(), r, a)).toMatchObject({ ok: true, status: "terverifikasi" });
  });
  it("an uncertain card attempt is not adopted when the card found for that phone lacks the import marker", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.buatGagal = "sebelum";
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });
    db.customers.push({ id: uuid(), name: "KASIR BARU", phone: "081234567890", address: null, imported_at: null });
    expect(await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).toMatchObject({ tersimpan: 0, ditahanIdentitas: { "pemilik_baru.tidak_terbukti": 1 } });
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
  });
  it("stores fixable incomplete cards in 'Perlu Dilengkapi' idempotently, bound to the file, and fails closed on bad answers", async () => {
    const f = masterDasar(2);
    f.pemilik[0].phone = null;
    const db = new DbPalsu(); const r = await rencana(f);
    expect(r.hitungan).toMatchObject({ siap: 0, tertunda: 2 });
    const a = await simpanKartuTertunda(db.klien(), r);
    expect(a.map((x) => x.status)).toEqual(["tersimpan", "tersimpan"]);
    expect(a[0].kekurangan).toEqual(["hp_kosong"]);
    expect([...db.tertunda.values()].every((v) => JSON.parse(v.isi).batch_sha256 === r.sha256Berkas)).toBe(true);
    expect((await simpanKartuTertunda(db.klien(), r)).map((x) => x.status)).toEqual(["sudah_ada", "sudah_ada"]);
    expect(db.panggilan).not.toContain("import_legacy_medical_records_bulk");
    db.rusak = (rows) => rows.slice(1);
    await expect(simpanKartuTertunda(db.klien(), r)).rejects.toThrow("tidak lengkap");
    db.rusak = (rows) => rows.map(() => ({ source_key: "lain", status: "tersimpan", id: uuid() }));
    await expect(simpanKartuTertunda(db.klien(), r)).rejects.toThrow("rusak");
    db.rusak = null; db.role = "DOCTOR";
    await expect(simpanKartuTertunda(db.klien(), r)).rejects.toThrow("OWNER");
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

  // ---------------------------------------------------------------- R1: kirim ulang batch tidak pasti
  const putusSebelum = async (db: DbPalsu, f: FixtureMaster) => {
    const r = await rencana(f); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.putus = "sebelum";
    expect((await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 })).status).toBe("berhenti_tidak_pasti");
    a.tutup();
    return { r, dir };
  };
  const bulk = (db: DbPalsu) => db.panggilan.filter((n) => n === "import_legacy_medical_records_bulk").length;
  it("R1: an ambiguity introduced BEFORE the lost first attempt committed blocks the replay with zero bulk calls", async () => {
    const db = new DbPalsu();
    const { r, dir } = await putusSebelum(db, masterDasar(1));
    expect(bulk(db)).toBe(1);
    // Aktor lain membuat pemilik persis + dua anabul senama (satu nonaktif) sebelum lanjutan.
    db.customers.push({ id: uuid(), name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1" });
    db.pets.push({ id: uuid(), customer_id: db.customers[0].id, name: "UJI KUCING", species: null, breed: null, gender: null, dob: null, status: "Nonaktif" },
      { id: uuid(), customer_id: db.customers[0].id, name: "uji kucing", species: null, breed: null, gender: null, dob: null, status: "Aktif" });
    const b = BukuBesar.buka(dir, meta(r)).buku;
    const j = await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 });
    expect(j).toMatchObject({ status: "berhenti_tidak_pasti", sebab: "identitas_berubah_sebelum_ulang", tersimpan: 0 });
    expect(bulk(db)).toBe(1);
    expect(db.visits).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).batches[0]).toMatchObject({ status: "tidak_pasti", sebab: "identitas_berubah_sebelum_ulang" });
  });
  it("R1: a changed existing owner/pet relation before commit blocks the replay", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1" });
    db.pets.push({ id: uuid(), customer_id: db.customers[0].id, name: "UJI KUCING", species: "Kucing", breed: "Domestik", gender: "Betina", dob: "2023-05-01", status: "Aktif" });
    const { r, dir } = await putusSebelum(db, masterDasar(1));
    const ledger = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(ledger.batches[0].baris[0].pet_id).toBe(db.pets[0].id);
    db.customers.push({ id: uuid(), name: "PEMILIK BARU", phone: "081111111111", address: null });
    db.pets[0].customer_id = db.customers[1].id;               // anabul dipindah ke pemilik lain
    const b = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ status: "berhenti_tidak_pasti", sebab: "identitas_berubah_sebelum_ulang" });
    expect(bulk(db)).toBe(1);
  });
  it("R1: a lost reply AFTER commit replays idempotently even if identities changed afterwards", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(2)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.putus = "sesudah";
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 }); a.tutup();
    db.pets.push({ id: uuid(), customer_id: db.customers[0].id, name: "UJI KUCING ", species: null, breed: null, gender: null, dob: null, status: "Nonaktif" });
    const b = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ status: "selesai", tersimpan: 0, sudahAda: 2 });
    expect(db.visits).toHaveLength(2);
  });
  it.each([
    ["the commit-state reader is unavailable", (db: DbPalsu) => { db.rs1Rusak = true; }, "status_commit_tidak_terbukti"],
    ["the identity scan is malformed", (db: DbPalsu) => { db.hookScan = () => { throw new Error("scan putus"); }; }, "identitas_tidak_terbukti"],
  ])("R1: replay stays uncertain with zero mutation when %s", async (_l, rusak, sebab) => {
    const db = new DbPalsu();
    const { r, dir } = await putusSebelum(db, masterDasar(1));
    rusak(db);
    const b = BukuBesar.buka(dir, meta(r)).buku;
    expect(await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ status: "berhenti_tidak_pasti", sebab });
    expect(bulk(db)).toBe(1);
    expect(db.visits).toHaveLength(0);
  });

  // ---------------------------------------------------------------- R2: readback hanya untuk ledger lengkap dan terikat
  it("R2: rejects an empty ledger for a plan with ready rows, before any DB read", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1));
    const b = BukuBesar.buka(folder(), meta(r)).buku;
    await expect(readbackMigrasi(db.klien(), r, b)).rejects.toThrow("Ledger tidak lengkap: 1 baris siap");
    expect([db.panggilan, db.pilihan]).toEqual([[], []]);
  });
  it("R2: rejects a partially acknowledged prefix that hides unattempted rows", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(3)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 }); a.tutup();
    const st = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    writeFileSync(join(dir, "state.json"), JSON.stringify({ ...st, batches: st.batches.slice(0, 1) }));
    const b = BukuBesar.buka(dir, meta(r)).buku;
    db.panggilan = [];
    await expect(readbackMigrasi(db.klien(), r, b)).rejects.toThrow("Ledger tidak lengkap: 1 baris siap");
    expect(db.panggilan).toEqual([]);
  });
  it("R2: rejects a ledger for another plan or context", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(1));
    const a = BukuBesar.buka(folder(), meta(r)).buku; await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });
    const f = masterDasar(1); f.riwayat[0].note = "lain"; const r2 = await rencana(f);
    db.panggilan = []; db.pilihan = [];
    await expect(readbackMigrasi(db.klien(), r2, a)).rejects.toThrow("bukan untuk rencana ini");
    await expect(readbackMigrasi(db.klien({ mode: "cabang", cabangId: CABANG }), r, a)).rejects.toThrow("Konteks klien berbeda");
    expect([db.panggilan, db.pilihan]).toEqual([[], []]);
  });
  it.each([
    ["a duplicate local id", (st: { batches: { baris: object[]; hasil: object[] }[] }) => { st.batches[1].baris[0] = st.batches[0].baris[0]; st.batches[1].hasil[0] = st.batches[0].hasil[0]; }],
    ["a missing visit id on success", (st: { batches: { hasil: { visit_id: unknown }[] }[] }) => { st.batches[0].hasil[0].visit_id = null; }],
    ["a duplicated visit id", (st: { batches: { hasil: { visit_id: unknown }[] }[] }) => { st.batches[0].hasil[1].visit_id = st.batches[0].hasil[0].visit_id; }],
    ["an unknown local id", (st: { ditahanIdentitas: object[] }) => { st.ditahanIdentitas.push({ local_record_id: "R99", alasan: ["x"] }); }],
    ["a tampered payload fingerprint", (st: { batches: { baris: { sidikPayload: string }[] }[] }) => { st.batches[0].baris[0].sidikPayload = "0".repeat(64); }],
    ["a malformed state", (st: Record<string, unknown>) => { st.batches = "rusak"; }],
  ])("R2: rejects %s before any DB read", async (_l, rusak) => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(3)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku; await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 }); a.tutup();
    const st = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    rusak(st);
    writeFileSync(join(dir, "state.json"), JSON.stringify(st));
    const b = BukuBesar.buka(dir, meta(r)).buku;
    db.panggilan = []; db.pilihan = [];
    await expect(readbackMigrasi(db.klien(), r, b)).rejects.toThrow(/Ledger rusak|tidak cocok/);
    expect([db.panggilan, db.pilihan]).toEqual([[], []]);
  });
  it("R2: an all-held run or a plan with no eligible rows reads back as 'kosong', never a successful migration", async () => {
    const db = new DbPalsu();
    db.customers.push({ id: uuid(), name: "ORANG A", phone: "081234567890", address: null }, { id: uuid(), name: "ORANG B", phone: "081234567890", address: null });
    const r = await rencana(masterDasar(1)); const a = BukuBesar.buka(folder(), meta(r)).buku;
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });
    expect(await readbackMigrasi(db.klien(), r, a)).toMatchObject({ ok: false, status: "kosong", diperiksa: 0, disposisi: { siap: 1, ditahanIdentitas: 1 } });
    const f = masterDasar(1); f.riwayat[0].decision = null; const r0 = await rencana(f);
    const b = BukuBesar.buka(folder(), meta(r0)).buku;
    expect(await readbackMigrasi(db.klien(), r0, b)).toMatchObject({ ok: false, status: "kosong", disposisi: { siap: 0 } });
  });

  // ---------------------------------------------------------------- R3: kunci milik pemegang, tanpa pengambilalihan di proses
  const kunciIsi = (dir: string) => JSON.parse(readFileSync(join(dir, "run.lock"), "utf8"));
  const matikan = (dir: string) => writeFileSync(join(dir, "run.lock"), JSON.stringify({ ...kunciIsi(dir), pid: 2 ** 22 + 7 }));
  it("R3: close is idempotent and owner-bound: an old handle never releases a newer owner's lock", async () => {
    const r = await rencana(masterDasar(1)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("kunci eksklusif");
    a.tutup();
    const b = BukuBesar.buka(dir, meta(r)).buku;
    a.tutup(); a.tutup();
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("kunci eksklusif");
    expect(() => b.simpan(b.baca())).not.toThrow();
    expect(() => a.simpan({ batches: [], ditahanIdentitas: [] })).toThrow("sudah ditutup");
    b.tutup();
    expect(existsSync(join(dir, "run.lock"))).toBe(false);
  });
  const sidikKunci = (dir: string) => { const st = statSync(join(dir, "run.lock")); return `${st.ino}:${readFileSync(join(dir, "run.lock"), "utf8")}`; };
  it("R3: any existing lock (live, dead, malformed, foreign host) fails closed; buka never moves or deletes it", async () => {
    const r = await rencana(masterDasar(1));
    const kasus: [string, (dir: string) => void, RegExp][] = [
      ["hidup", () => {}, /kunci eksklusif/],
      ["basi", (dir) => matikan(dir), /Kunci basi terdeteksi .*Tidak diambil alih otomatis/],
      ["rusak", (dir) => writeFileSync(join(dir, "run.lock"), "bukan json"), /rusak/],
      ["host lain", (dir) => writeFileSync(join(dir, "run.lock"), JSON.stringify({ ...kunciIsi(dir), host: "host-lain", pid: 2 ** 22 + 7 })), /host lain/],
    ];
    for (const [, ubah, pesan] of kasus) {
      const dir = folder();
      BukuBesar.buka(dir, meta(r));
      ubah(dir);
      const sebelum = sidikKunci(dir);
      for (let i = 0; i < 3; i += 1) expect(() => BukuBesar.buka(dir, meta(r))).toThrow(pesan);
      expect(sidikKunci(dir)).toBe(sebelum);
    }
  });
  it("R3: three contenders — A stale reader, B live replacement, C gap acquirer: no lock is ever displaced", async () => {
    const r = await rencana(masterDasar(1)); const dir = folder();
    BukuBesar.buka(dir, meta(r)); matikan(dir);                           // pemegang lama mati (crash)
    const basi = sidikKunci(dir);
    // A dan B sama-sama melihat kunci basi T: keduanya hanya MEMBACA dan gagal tertutup; kunci T tetap utuh.
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("Kunci basi terdeteksi");
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("Kunci basi terdeteksi");
    expect(sidikKunci(dir)).toBe(basi);
    // Pemulihan MANUAL oleh operator saat semua proses berhenti (di luar runner), lalu B memperoleh kunci hidup.
    unlinkSync(join(dir, "run.lock"));
    const b = BukuBesar.buka(dir, meta(r)).buku;
    const milikB = sidikKunci(dir);
    // A (masih berbekal bacaan basi T) dan C (pendatang di sela) mencoba: keduanya ditolak; kunci B tidak bergeser.
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("kunci eksklusif");
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("kunci eksklusif");
    expect(sidikKunci(dir)).toBe(milikB);
    expect(() => b.simpan(b.baca())).not.toThrow();
    b.tutup();
    expect(existsSync(join(dir, "run.lock"))).toBe(false);
  });
  it("R3: crash recovery after manual lock removal keeps the ledger state and resumes", async () => {
    const db = new DbPalsu(); const r = await rencana(masterDasar(2)); const dir = folder();
    const a = BukuBesar.buka(dir, meta(r)).buku;
    db.putus = "sebelum";
    await jalankanMigrasi(db.klien(), r, a, { ukuranBatch: 2 });          // "crash": tidak ditutup
    matikan(dir);
    expect(() => BukuBesar.buka(dir, meta(r))).toThrow("Kunci basi terdeteksi");
    unlinkSync(join(dir, "run.lock"));                                     // pemulihan manual (semua proses berhenti)
    const b = BukuBesar.buka(dir, meta(r)).buku;
    expect(b.baca().batches[0].status).toBe("tidak_pasti");
    expect(() => a.simpan(a.baca())).toThrow("bukan milik run ini");
    expect(await jalankanMigrasi(db.klien(), r, b, { ukuranBatch: 2 })).toMatchObject({ status: "selesai", tersimpan: 2 });
  });
  it("R3: the ledger module has no lock takeover path (only its own token is ever released)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/migrasi-kartu-medis/buku-besar.ts"), "utf8");
    expect(src).not.toMatch(/\blinkSync\b|pulihkanKunciBasi|_uji/);
    expect(src.match(/renameSync\(/g)).toHaveLength(1);                    // hanya tulis atomik state/meta
    expect(src.match(/unlinkSync\(kunci\)/g)).toHaveLength(2);           // keduanya dijaga cek token milik sendiri
    expect(src).toMatch(/if \(isi\?\.token === milikku\.token\) unlinkSync\(kunci\)/);
    expect(src).toMatch(/if \(bacaKunci\(kunci\)\?\.token === this\.token\) unlinkSync\(kunci\)/);
  });
});
