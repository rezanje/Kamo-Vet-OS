import { describe, expect, it } from "vitest";
import { bacaMaster } from "@/lib/migrasi-kartu-medis/baca-master";
import { buatRencana, OPSI_BAWAAN_TANGGAL_MINIMUM, type Rencana } from "@/lib/migrasi-kartu-medis/rencana";
import { buatMaster, masterDasar, tgl, type FixtureMaster } from "./fixtures/master-kartu-medis";

const OPSI = { hariIni: "2026-10-30", tanggalMinimum: OPSI_BAWAAN_TANGGAL_MINIMUM };

async function rencana(f: FixtureMaster, opsi = OPSI): Promise<Rencana> {
  const hasil = await bacaMaster(await buatMaster(f));
  if (!hasil.ok) throw new Error(hasil.galat.join("; "));
  return buatRencana(hasil.versi, hasil.sha256, hasil.blok, opsi, hasil.peringatan);
}
const baris = (r: Rencana, id: string) => r.baris.find((b) => b.local_record_id === id)!;

describe("rencana dry-run offline", () => {
  it("builds frozen payloads with the original source key, WIB date, exact dob and untrimmed clinical text", async () => {
    const f = masterDasar(2);
    f.riwayat[0].diagnosis = "  UJI DIAGNOSIS 1\nbaris dua  ";
    const r = await rencana(f);
    expect(r.hitungan).toMatchObject({ riwayat: 2, siap: 2, karantina: 0, dikecualikan: 0, kandidat: 2, disetujui: 2 });
    const p = baris(r, "R1").payload!;
    expect(p).toEqual({
      source_key: "uji pemilik::081234567890::uji kucing::15012026", record_no: "RM-001", record_date: "2026-01-15T00:00:00+07:00",
      owner_name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1", patient_name: "UJI KUCING",
      species: "Kucing", breed: "Domestik", gender: "Betina", dob: "2023-05-01", doctor: "drh. Fiktif",
      note: "Keluhan uji 1", anamnesis: "Anamnesis uji 1", clinical_findings: "Gejala uji 1",
      diagnosis: "  UJI DIAGNOSIS 1\nbaris dua  ", therapy: "UJI TERAPI 1",
    });
    expect(Object.values(p)).not.toContain("P1");
    expect(Object.values(p)).not.toContain("H1");
    expect(baris(r, "R1").sidikPayload).toMatch(/^[0-9a-f]{64}$/);
    expect(r.sidikRencana).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic: the same file bytes and options give the same plan fingerprint; a content change changes it", async () => {
    // Satu berkas, dibaca dua kali. (Dua kali menulis fixture menghasilkan byte berbeda: ExcelJS menyematkan waktu
    // pembuatan, jadi SHA-256 berkas — dan sidik rencana — memang berbeda; itu disengaja.)
    const bytes = await buatMaster(masterDasar());
    const dariBytes = async () => {
      const h = await bacaMaster(bytes);
      if (!h.ok) throw new Error(h.galat.join("; "));
      return buatRencana(h.versi, h.sha256, h.blok, OPSI, h.peringatan);
    };
    const [a, b] = [await dariBytes(), await dariBytes()];
    expect(a.sidikRencana).toBe(b.sidikRencana);
    // Payload tidak bergantung pada byte berkas: dua tulisan fixture yang sama -> sidik payload sama.
    expect((await rencana(masterDasar())).baris.map((r) => r.sidikPayload)).toEqual(a.baris.map((r) => r.sidikPayload));
    const f = masterDasar(); f.riwayat[1].therapy = "UJI TERAPI BERUBAH";
    const berubah = await rencana(f);
    expect(berubah.sidikRencana).not.toBe(a.sidikRencana);
    expect(berubah.baris[1].sidikPayload).not.toBe(a.baris[1].sidikPayload);
  });
  it("treats SETUJU as review eligibility at all three levels only; empty/formula/freeform is not approval", async () => {
    const f = masterDasar(4);
    f.pemilik[0].decision = "SETUJU";
    f.riwayat[0].decision = "setuju";
    f.riwayat[1].decision = { formula: '"SETUJU"', result: "SETUJU" } as never;
    f.riwayat[2].decision = null;
    const r = await rencana(f);
    expect(["R1", "R2", "R3"].map((id) => baris(r, id).status)).toEqual(["dikecualikan", "dikecualikan", "dikecualikan"]);
    expect(baris(r, "R1").alasan).toEqual(["belum_disetujui"]);
    expect(baris(r, "R4").status).toBe("siap");
    expect(r.hitungan).toMatchObject({ kandidat: 4, disetujui: 1, siap: 1 });
    const tanpaHewan = masterDasar(1); tanpaHewan.hewan[0].decision = "Perlu cek";
    expect(baris(await rencana(tanpaHewan), "R1").alasan).toEqual(["belum_disetujui"]);
  });
  it("validates every row even without approval so empty approval cannot hide structural errors", async () => {
    const f = masterDasar(2);
    f.riwayat.forEach((r) => { r.decision = null; });
    f.riwayat[1].record_date = "15/01/2026";
    const r = await rencana(f);
    expect(baris(r, "R2").status).toBe("karantina");
    expect(baris(r, "R2").alasan).toEqual(["riwayat.record_date.bukan_tanggal_asli"]);
    expect(r.hitungan).toMatchObject({ kandidat: 1, disetujui: 0, karantina: 1, dikecualikan: 1 });
  });
  it.each([
    ["owner name above the effective DB limit (100)", (f: FixtureMaster) => { f.pemilik[0].name = "x".repeat(101); }, "induk.pemilik_karantina"],
    ["phone above 30", (f: FixtureMaster) => { f.pemilik[0].phone = "0812" + "3".repeat(27); }, "induk.pemilik_karantina"],
    ["phone typed as a number cell (leading zero lost)", (f: FixtureMaster) => { f.pemilik[0].phone = 81234567890; }, "induk.pemilik_karantina"],
    ["gender above 10", (f: FixtureMaster) => { f.hewan[0].gender = "Betina steril"; }, "induk.hewan_karantina"],
    ["species above 50", (f: FixtureMaster) => { f.hewan[0].species = "k".repeat(51); }, "induk.hewan_karantina"],
    ["doctor above 100", (f: FixtureMaster) => { f.riwayat[0].doctor = "d".repeat(101); }, "riwayat.doctor.terlalu_panjang"],
    ["diagnosis above 10000", (f: FixtureMaster) => { f.riwayat[0].diagnosis = "d".repeat(10001); }, "riwayat.diagnosis.terlalu_panjang"],
    ["note above 5000", (f: FixtureMaster) => { f.riwayat[0].note = "n".repeat(5001); }, "riwayat.note.terlalu_panjang"],
    ["a formula in a clinical field (stale cache)", (f: FixtureMaster) => { f.riwayat[0].therapy = { formula: "A1", result: "x" } as never; }, "riwayat.therapy.rumus"],
    ["a number in a text field", (f: FixtureMaster) => { f.riwayat[0].record_no = 123; }, "riwayat.record_no.bukan_teks"],
    ["an invalid actual customers.id", (f: FixtureMaster) => { f.pemilik[0].customer_uuid = "P1"; }, "induk.pemilik_karantina"],
    ["pets.id without customers.id", (f: FixtureMaster) => { f.hewan[0].pet_uuid = "0b9d5a52-1f2e-4b1a-9c3d-6e7f8a9b0c1d"; }, "hewan.pets_id_tanpa_customers_id"],
    ["a missing pet reference", (f: FixtureMaster) => { f.riwayat[0].local_pet_id = "H9"; }, "induk.hewan_tidak_ada"],
    ["a missing owner reference", (f: FixtureMaster) => { f.hewan[0].local_owner_id = "P9"; }, "induk.pemilik_tidak_ada"],
    ["a duplicated owner id", (f: FixtureMaster) => { f.pemilik.push({ ...f.pemilik[0] }); }, "induk.pemilik_id_ganda"],
    ["a duplicated pet id", (f: FixtureMaster) => { f.hewan.push({ ...f.hewan[0] }); }, "induk.hewan_id_ganda"],
    ["a missing mapping row", (f: FixtureMaster) => { f.perSheet.shift(); }, "mapping.hilang"],
    ["two mapping rows for one record", (f: FixtureMaster) => { f.perSheet.push({ ...f.perSheet[0] }); }, "mapping.ganda"],
    ["an unknown source key shape", (f: FixtureMaster) => { f.perSheet[0].source_key = "a::b::c"; }, "mapping.source_key.bentuk_tidak_dikenal"],
    ["a structured key whose phone differs from the owner", (f: FixtureMaster) => { f.perSheet[0].source_key = "uji pemilik::089999999999::uji kucing::15012026"; }, "mapping.source_key.hp_beda_dengan_pemilik"],
    ["a source key with edge whitespace", (f: FixtureMaster) => { f.perSheet[0].source_key = " berkas.xlsx::Sheet1"; }, "mapping.source_key.spasi_tepi"],
    ["a source key above 500", (f: FixtureMaster) => { f.perSheet[0].source_key = `${"f".repeat(495)}::Sheet1`; }, "mapping.source_key.terlalu_panjang"],
    ["tab date different from cell date (no auto-pick)", (f: FixtureMaster) => { f.perSheet[0].cell_date = tgl("2026-01-20"); }, "tanggal.tab_beda_sel"],
    ["proposed date different from source dates", (f: FixtureMaster) => { f.riwayat[0].record_date = tgl("2026-01-20"); }, "tanggal.usulan_beda_sumber"],
    ["a future date (WIB)", (f: FixtureMaster) => { f.riwayat[0].record_date = tgl("2026-10-31"); f.perSheet[0].tab_date = null; f.perSheet[0].cell_date = null; }, "riwayat.record_date.masa_depan"],
    ["a date before the advisory minimum", (f: FixtureMaster) => { f.riwayat[0].record_date = tgl("1989-12-31"); f.perSheet[0].tab_date = null; f.perSheet[0].cell_date = null; }, "riwayat.record_date.sebelum_batas_minimum"],
    ["a date with a time part", (f: FixtureMaster) => { f.riwayat[0].record_date = new Date("2026-01-15T10:30:00Z"); }, "riwayat.record_date.memuat_jam"],
    ["an impossible early date (Excel 1900 artefact)", (f: FixtureMaster) => { f.hewan[0].dob = new Date("1899-12-30T00:00:00Z"); }, "induk.hewan_karantina"],
    ["a text dob (no guessing)", (f: FixtureMaster) => { f.hewan[0].dob = "Mei 2023"; }, "induk.hewan_karantina"],
    ["an unreadable mapping date", (f: FixtureMaster) => { f.perSheet[0].tab_date = "15 Jan"; }, "mapping.tanggal_tab.tak_terbaca"],
    ["source sheet different from the mapping sheet", (f: FixtureMaster) => { f.riwayat[0].source_sheet = "lain"; }, "riwayat.sheet_sumber_beda_dengan_mapping"],
  ])("quarantines %s without truncation, even when approved", async (_label, ubah, alasan) => {
    const f = masterDasar(2);
    ubah(f);
    const r = await rencana(f);
    const b = baris(r, "R1");
    expect(b.status).toBe("karantina");
    expect(b.alasan).toContain(alasan);
    expect(b.payload).toBeNull();
    // Persetujuan tetap terbaca (karantina mengalahkannya); bila induk hilang/ganda, persetujuan tidak terbukti.
    if (!/^induk\.(hewan_tidak_ada|pemilik_tidak_ada|pemilik_id_ganda|hewan_id_ganda)$/.test(alasan)) expect(b.disetujui).toBe(true);
  });
  it("accepts exact boundary lengths", async () => {
    const f = masterDasar(1);
    f.pemilik[0].name = "x".repeat(100); f.pemilik[0].phone = "08" + "1".repeat(28);
    f.hewan[0].gender = "g".repeat(10); f.hewan[0].species = "s".repeat(50);
    f.riwayat[0].doctor = "d".repeat(100); f.riwayat[0].diagnosis = "d".repeat(10000); f.riwayat[0].note = "n".repeat(5000);
    f.perSheet[0].source_key = `${"f".repeat(492)}::Sheet1`;
    const b = baris(await rencana(f), "R1");
    expect(b.status).toBe("siap");
    expect(b.payload!.diagnosis).toHaveLength(10000);
  });
  it("excludes unresolved dates, templates and photo-only cards with reasons; never sends them", async () => {
    const f = masterDasar(3);
    f.riwayat[0].record_date = null; f.perSheet[0].tab_date = null; f.perSheet[0].cell_date = null;
    for (const k of ["doctor", "note", "anamnesis", "clinical_findings", "diagnosis", "therapy"]) f.riwayat[1][k] = null;
    f.perSheet[2].file = "Template Rekam Medis.xlsx";
    const r = await rencana(f);
    expect(baris(r, "R1")).toMatchObject({ status: "dikecualikan", alasan: ["tanggal.belum_terselesaikan"], payload: null });
    expect(baris(r, "R2")).toMatchObject({ status: "dikecualikan", alasan: ["tanpa_isi_klinis"], payload: null });
    expect(baris(r, "R3")).toMatchObject({ status: "karantina", alasan: ["mapping.file_template"] });
    expect(r.hitungan.siap + r.hitungan.karantina + r.hitungan.dikecualikan).toBe(r.hitungan.riwayat);
  });
  it("holds ALL rows sharing a source key, including a two-part fallback key across owners and phone-equivalent structured keys", async () => {
    const f = masterDasar(2);
    f.pemilik.push({ local_owner_id: "P2", name: "UJI LAIN", phone: "081111111111", decision: "SETUJU" });
    f.hewan.push({ local_pet_id: "H2", local_owner_id: "P2", name: "UJI ANJING", decision: "SETUJU" });
    f.riwayat.push({ ...f.riwayat[0], local_record_id: "R3", local_pet_id: "H2", diagnosis: "lain", source_sheet: "Sheet1" }, { ...f.riwayat[0], local_record_id: "R4", diagnosis: "lain lagi", source_sheet: "Sheet1" });
    f.perSheet.push({ local_ref: "R3", file: "Kartu.xlsx", sheet: "Sheet1", source_key: "Kartu.xlsx::Sheet1", tab_date: tgl("2026-01-15") },
      { local_ref: "R4", file: "Kartu.xlsx", sheet: "Sheet1", source_key: "Kartu.xlsx::Sheet1", tab_date: tgl("2026-01-15") });
    f.perSheet[1].source_key = "uji pemilik::6281234567890::uji kucing::15012026";
    const r = await rencana(f);
    expect(["R3", "R4"].map((id) => baris(r, id).alasan)).toEqual([["jejak.tabrakan"], ["jejak.tabrakan"]]);
    expect(["R1", "R2"].map((id) => baris(r, id).alasan)).toEqual([["jejak.tabrakan"], ["jejak.tabrakan", "tanggal.usulan_beda_sumber"].filter((a) => baris(r, "R2").alasan.includes(a))]);
    expect(r.hitungan.siap).toBe(0);
  });
  it("keeps an equivalent phone (+62 vs 08) as written without rewriting the key", async () => {
    const f = masterDasar(1);
    f.pemilik[0].phone = "+62 812-3456-7890";
    const b = baris(await rencana(f), "R1");
    expect(b.status).toBe("siap");
    expect(b.payload!.phone).toBe("+62 812-3456-7890");
    expect(b.payload!.source_key).toBe("uji pemilik::081234567890::uji kucing::15012026");
  });
  it("never sends local ids, even UUID-shaped ones, and keeps actual UUIDs only as unproven hints", async () => {
    const f = masterDasar(1);
    f.pemilik[0].local_owner_id = "11111111-1111-4111-8111-111111111111";
    f.hewan[0].local_owner_id = "11111111-1111-4111-8111-111111111111";
    f.pemilik[0].customer_uuid = "22222222-2222-4222-8222-222222222222";
    const b = baris(await rencana(f), "R1");
    expect(JSON.stringify(b.payload)).not.toContain("11111111");
    expect(JSON.stringify(b.payload)).not.toContain("22222222");
    expect(b.customer_uuid).toBe("22222222-2222-4222-8222-222222222222");
  });
  it("does not send a partial DOB; dob stays null with a warning", async () => {
    const f = masterDasar(1);
    f.hewan[0].dob = null; f.hewan[0].dob_raw = "Mei 2023";
    const b = baris(await rencana(f), "R1");
    expect(b.payload!.dob).toBeNull();
    expect(b.peringatan).toContain("hewan.dob_parsial_tidak_dikirim");
  });
  it("reconciles 100% of rows including every exclusion and quarantine reason", async () => {
    const f = masterDasar(5);
    f.riwayat[0].decision = null;
    f.riwayat[1].doctor = "d".repeat(101);
    f.riwayat[2].record_date = null; f.perSheet[2].tab_date = null; f.perSheet[2].cell_date = null;
    const r = await rencana(f);
    expect(r.hitungan).toMatchObject({ riwayat: 5, siap: 2, karantina: 1, dikecualikan: 2 });
    expect(r.hitungan.perAlasan).toEqual({ belum_disetujui: 1, "riwayat.doctor.terlalu_panjang": 1, "tanggal.belum_terselesaikan": 1 });
  });
  it("file-level OWNER approval (SHA-256 bound) replaces per-row SETUJU but never lifts quarantine or exclusions", async () => {
    const f = masterDasar(4);
    for (const r of f.riwayat) r.decision = null;
    f.pemilik[0].decision = null;
    f.riwayat[1].record_date = null;                     // dikecualikan: tanggal belum terselesaikan
    f.riwayat[2].doctor = "x".repeat(101);               // karantina
    const bytes = await buatMaster(f);
    const h = await bacaMaster(bytes);
    if (!h.ok) throw new Error(h.galat.join("; "));
    const tanpa = buatRencana(h.versi, h.sha256, h.blok, OPSI);
    expect(tanpa.hitungan).toMatchObject({ siap: 0, karantina: 1, dikecualikan: 3 });
    const dengan = buatRencana(h.versi, h.sha256, h.blok, { ...OPSI, persetujuanBerkas: h.sha256 });
    expect(dengan.hitungan).toMatchObject({ siap: 2, karantina: 1, dikecualikan: 1, disetujui: 3 });
    expect(baris(dengan, "R2").alasan).toEqual(["tanggal.belum_terselesaikan"]);
    expect(baris(dengan, "R3").status).toBe("karantina");
    expect(dengan.sidikRencana).not.toBe(tanpa.sidikRencana);
    expect(() => buatRencana(h.versi, h.sha256, h.blok, { ...OPSI, persetujuanBerkas: "0".repeat(64) })).toThrow(/tidak cocok/);
  });
  it("prepares 'Perlu Dilengkapi' cards only for fixable gaps, with source values kept and nothing invented", async () => {
    const f = masterDasar(6);
    f.pemilik.push(
      { local_owner_id: "P2", name: "UJI TANPA HP", phone: null, decision: "SETUJU" },
      { local_owner_id: "P3", name: null, phone: 81234500001, decision: "SETUJU" },
    );
    f.hewan.push({ local_pet_id: "H2", local_owner_id: "P2", name: "UJI H2", decision: "SETUJU" }, { local_pet_id: "H3", local_owner_id: "P3", name: null, decision: "SETUJU" });
    f.riwayat[0].local_pet_id = "H2";                                   // hp_kosong
    f.riwayat[1].local_pet_id = "H3";                                   // hp_angka + nama pemilik/hewan kosong
    f.perSheet[2].tab_date = tgl("2026-02-01");                         // tanggal bentrok
    f.riwayat[3].doctor = "x".repeat(101);                              // tidak bisa dilengkapi petugas
    f.riwayat[4].local_pet_id = "H2"; f.riwayat[4].note = f.riwayat[0].note; f.riwayat[4].anamnesis = f.riwayat[0].anamnesis;
    f.riwayat[4].clinical_findings = f.riwayat[0].clinical_findings; f.riwayat[4].diagnosis = f.riwayat[0].diagnosis; f.riwayat[4].therapy = f.riwayat[0].therapy;
    f.riwayat[4].record_no = f.riwayat[0].record_no; f.riwayat[4].record_date = f.riwayat[0].record_date; f.perSheet[4].tab_date = f.perSheet[0].tab_date; f.perSheet[4].cell_date = f.perSheet[0].cell_date;
    const r = await rencana(f);
    expect(baris(r, "R1").tertunda).toMatchObject({ kekurangan: ["hp_kosong", "kemungkinan_salinan"], source_key: f.perSheet[0].source_key, isi: { owner_name: "UJI TANPA HP", patient_name: "UJI H2" } });
    expect(baris(r, "R1").tertunda!.isi.phone).toBeUndefined();
    expect(baris(r, "R2").tertunda).toMatchObject({ kekurangan: ["hp_angka", "nama_hewan_kosong", "nama_pemilik_kosong"], isi: { phone: "81234500001" } });
    expect(baris(r, "R2").tertunda!.isi.owner_name).toBeUndefined();
    expect(baris(r, "R3").tertunda).toMatchObject({ kekurangan: ["tanggal_bentrok"], isi: { tanggal_tab: "2026-02-01", tanggal_sel: "2026-01-17", tanggal_usulan: "2026-01-17" } });
    expect(baris(r, "R4").tertunda).toBeNull();
    expect(baris(r, "R5").tertunda!.kekurangan).toEqual(["hp_kosong", "kemungkinan_salinan"]);
    expect(baris(r, "R6").tertunda).toBeNull();                         // siap
    expect(r.hitungan.tertunda).toBe(4);
    // Tanpa persetujuan: kartu tertunda juga tidak disiapkan.
    for (const x of f.riwayat) x.decision = null;
    expect((await rencana(f)).hitungan.tertunda).toBe(0);
  });
});
