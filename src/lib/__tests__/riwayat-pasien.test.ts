import { describe, expect, it } from "vitest";
import {
  adalahUuid, bacaMuatan, deretBerat, jumlahObat, MAKS_MUATAN, susunKunjungan, susunProfil, titikGrafik, umurHewan,
  type SumberBarisRpc, type SumberItem, type SumberRawatInap, type SumberRekam,
} from "../riwayat-pasien";

const rpc = (id: string, created_at: string, extra: Partial<SumberBarisRpc> = {}): SumberBarisRpc => ({
  id, created_at, pet_id: "pet-a", branch_id: "br-1", dokter: "drh. Uji", keluhan: "Muntah", legacy_source_key: null,
  branches: { code: "VET_CMGG" }, medical_records: [{ diagnosis: "Ringkas dx", anamnesis: "Ringkas anamnesa" }], ...extra,
});
const rekam = (id: string, visit_id: string, extra: Partial<SumberRekam> = {}): SumberRekam => ({
  id, visit_id, created_at: "2026-10-29T03:00:00Z", diagnosis: "Gastritis", anamnesis: "Muntah 2x", therapy: "Infus", gejala_klinis: "Dehidrasi",
  hasil_penunjang: null, follow_up: "Kontrol 3 hari", catatan_resep: null, suhu: "39.40", berat: "2.60", ...extra,
});
const item = (id: string, medical_record_id: string, jenis: string | null, nama: string, qty: number | string | null = 1): SumberItem => ({
  id, medical_record_id, nama_obat: nama, qty, satuan: "tab", aturan_pakai: "2x1", jenis,
});

describe("susunKunjungan", () => {
  it("terbaru dulu, apa pun urutan sumbernya", () => {
    const hasil = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z"), rpc("v3", "2026-11-12T03:00:00Z"), rpc("v2", "2026-10-31T03:00:00Z")],
      kunjungan: [], rekam: [], item: [], rawatInap: [],
    });
    expect(hasil.map((k) => k.visitId)).toEqual(["v3", "v2", "v1"]);
  });

  it("memetakan rekam medis lengkap: suhu/berat numerik, resep dan tindakan dipisah, tanpa harga", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z")],
      kunjungan: [{ id: "v1", poli: "Poli Umum", status: "Selesai", archived_at: null, branches: { code: "VET_CMGG", name: "Cabang Cimanggis" } }],
      rekam: [rekam("r1", "v1")],
      item: [item("i1", "r1", "obat", "Amoxicillin", 2), item("i2", "r1", "jasa", "Konsultasi"), item("i3", "r1", null, "Tanpa jenis", "1.5")],
      rawatInap: [],
    });
    expect(k).toMatchObject({
      visitId: "v1", cabang: "Cabang Cimanggis", poli: "Poli Umum", dokter: "drh. Uji", keluhan: "Muntah", suhu: 39.4, berat: 2.6,
      anamnesa: "Muntah 2x", gejala: "Dehidrasi", diagnosa: "Gastritis", terapi: "Infus", tindakLanjut: "Kontrol 3 hari",
      impor: false, diarsipkan: false, rawatInap: null, adaRekam: true,
    });
    expect(k.obat.map((o) => o.nama)).toEqual(["Amoxicillin", "Tanpa jenis"]);
    expect(k.obat[0]).toMatchObject({ jumlah: "2 tab", aturan: "2x1" });
    expect(k.obat[1].jumlah).toBe("1,5 tab");
    expect(k.tindakan.map((o) => o.nama)).toEqual(["Konsultasi"]);
    expect(JSON.stringify(k)).not.toMatch(/harga|price|total|amount/i);
  });

  it("bidang kosong/hilang menjadi null tanpa error; kunjungan tanpa rekam memakai ringkasan RPC", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z", { dokter: null, keluhan: "  ", branches: null })],
      kunjungan: [], rekam: [], item: [], rawatInap: [],
    });
    expect(k).toMatchObject({ dokter: null, keluhan: null, cabang: null, poli: null, adaRekam: false, suhu: null, berat: null, terapi: null, gejala: null });
    expect(k.diagnosa).toBe("Ringkas dx");
    expect(k.anamnesa).toBe("Ringkas anamnesa");
    expect(k.obat).toEqual([]);
  });

  it("nilai suhu/berat rusak tidak menjadi NaN", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z")], kunjungan: [], item: [], rawatInap: [],
      rekam: [rekam("r1", "v1", { suhu: "abc", berat: "" })],
    });
    expect(k.suhu).toBeNull();
    expect(k.berat).toBeNull();
  });

  it("riwayat impor tanpa cabang: bertanda impor, cabang kosong", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2025-01-15T03:00:00Z", { branch_id: null, branches: null, legacy_source_key: "wowo::1" })],
      kunjungan: [{ id: "v1", poli: null, status: null, archived_at: null, branches: null }],
      rekam: [rekam("r1", "v1", { therapy: null, catatan_resep: "Terapi hasil impor" })],
      item: [], rawatInap: [],
    });
    expect(k).toMatchObject({ impor: true, cabang: null, catatanResep: "Terapi hasil impor", terapi: null });
  });

  it("rawat inap: label dan id catatan terbaru; aktif bila belum pulang", () => {
    const ranap = (id: string, created_at: string, discharged_at: string | null): SumberRawatInap => ({ id, visit_id: "v1", condition_status: "stabil", admitted_at: created_at, discharged_at, created_at });
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z")], kunjungan: [], rekam: [], item: [],
      rawatInap: [ranap("ri-lama", "2026-10-29T04:00:00Z", "2026-10-30T04:00:00Z"), ranap("ri-baru", "2026-10-31T04:00:00Z", null)],
    });
    expect(k.rawatInap).toEqual({ id: "ri-baru", aktif: true });
  });

  it("kunjungan diarsipkan ditandai", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z")], rekam: [], item: [], rawatInap: [],
      kunjungan: [{ id: "v1", poli: "Poli Umum", status: "Batal", archived_at: "2026-10-30T00:00:00Z", branches: null }],
    });
    expect(k.diarsipkan).toBe(true);
  });

  it("dua rekam medis dalam satu kunjungan: memakai yang terbaru, resep ikut rekam itu saja", () => {
    const [k] = susunKunjungan({
      rpc: [rpc("v1", "2026-10-29T03:00:00Z")], kunjungan: [], rawatInap: [],
      rekam: [rekam("r-lama", "v1", { created_at: "2026-10-29T03:00:00Z", diagnosis: "Lama" }), rekam("r-baru", "v1", { created_at: "2026-10-29T05:00:00Z", diagnosis: "Baru" })],
      item: [item("i1", "r-lama", "obat", "Obat lama"), item("i2", "r-baru", "obat", "Obat baru")],
    });
    expect(k.diagnosa).toBe("Baru");
    expect(k.obat.map((o) => o.nama)).toEqual(["Obat baru"]);
  });
});

describe("berat per kunjungan", () => {
  const mk = (id: string, tanggal: string, berat: number | null) => ({ visitId: id, tanggal, berat }) as never;
  const k = (id: string, tanggal: string, berat: number | null) => ({ ...susunKunjungan({ rpc: [rpc(id, tanggal)], kunjungan: [], rekam: berat == null ? [] : [rekam("r" + id, id, { berat })], item: [], rawatInap: [] })[0] });

  it("deret dari yang terlama; kunjungan tanpa berat tetap ada sebagai null; nol dianggap kosong", () => {
    const deret = deretBerat([k("v3", "2026-11-12T03:00:00Z", 3), k("v2", "2026-10-31T03:00:00Z", null), k("v1", "2026-10-29T03:00:00Z", 2.6), k("v0", "2026-10-01T03:00:00Z", 0)]);
    expect(deret.map((t) => [t.visitId, t.berat])).toEqual([["v0", null], ["v1", 2.6], ["v2", null], ["v3", 3]]);
  });

  it("grafik: null bila kurang dari 2 titik terisi; lewati null; datar di tengah", () => {
    expect(titikGrafik([])).toBeNull();
    expect(titikGrafik([mk("a", "2026-01-01", 2), mk("b", "2026-02-01", null)])).toBeNull();
    const titik = titikGrafik([mk("a", "2026-01-01", 2), mk("b", "2026-02-01", null), mk("c", "2026-03-01", 4)], 100, 20, 0)!;
    expect(titik).toBe("0.0,20.0 100.0,0.0");
    expect(titikGrafik([mk("a", "2026-01-01", 3), mk("b", "2026-03-01", 3)], 100, 20, 0)).toBe("0.0,10.0 100.0,10.0");
  });
});

describe("profil, umur, jumlah, parameter URL", () => {
  const sekarang = new Date("2026-11-16T00:00:00Z");
  it("umur dari tanggal lahir", () => {
    expect(umurHewan("2024-08-10", sekarang)).toBe("2 th 3 bln");
    expect(umurHewan("2026-05-20", sekarang)).toBe("5 bln");
    expect(umurHewan("2025-11-16", sekarang)).toBe("1 th");
    expect(umurHewan("2026-11-10", sekarang)).toBe("kurang dari 1 bulan");
    expect(umurHewan(null, sekarang)).toBeNull();
    expect(umurHewan("2027-01-01", sekarang)).toBeNull();
    expect(umurHewan("bukan tanggal", sekarang)).toBeNull();
  });

  it("profil: pemilik placeholder disamarkan, hewan lain tanpa dirinya sendiri, berat 0 = kosong", () => {
    const dasar = { id: "pet-a", name: "choco", species: "Kucing", breed: null, dob: null, gender: "jantan", weight: "0", alergi: null, sterilisasi: "Steril", kondisi_khusus: null, golongan_darah: null, microchip: null };
    const lain = [{ id: "pet-a", name: "choco", species: "Kucing" }, { id: "pet-b", name: "Mimi", species: null }];
    const tidakSah = (n: string | null | undefined) => /drive/i.test(n ?? "");
    const normal = susunProfil({ ...dasar, customers: { name: "tes", phone: "0812" } }, lain, tidakSah);
    expect(normal).toMatchObject({ nama: "choco", pemilik: "tes", telepon: "0812", beratTerkini: null, steril: "Steril" });
    expect(normal.hewanLain).toEqual([{ id: "pet-b", nama: "Mimi", spesies: null }]);
    const samar = susunProfil({ ...dasar, weight: 4.5, customers: [{ name: "Drive Download 1", phone: "0899" }] }, [], tidakSah);
    expect(samar).toMatchObject({ pemilik: "Pemilik perlu verifikasi", telepon: "", beratTerkini: 4.5 });
  });

  it("jumlah obat, uuid, muatan", () => {
    expect(jumlahObat(2, "tab")).toBe("2 tab");
    expect(jumlahObat(null, "tab")).toBe("tab");
    expect(jumlahObat(null, null)).toBe("");
    expect(adalahUuid("bb5fef84-a24b-4f1b-bbe2-f25d345b1555")).toBe(true);
    expect(adalahUuid("pasien")).toBe(false);
    expect(adalahUuid("1' or 1=1")).toBe(false);
    expect([undefined, "", "abc", "0", "-1", "1.5", String(MAKS_MUATAN + 1)].map(bacaMuatan)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(bacaMuatan("3")).toBe(3);
  });
});
