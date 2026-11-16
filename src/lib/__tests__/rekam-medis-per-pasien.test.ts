import { describe, expect, it } from "vitest";
import {
  bacaKelompok, JENDELA_KUNJUNGAN, kelompokkanPerPasien, petakanKunjungan, ringkasTeks, susunDaftarPerPasien,
  type BarisKunjungan, type SumberBarisDaftar,
} from "../rekam-medis-per-pasien";

const sumber = (o: Partial<SumberBarisDaftar> & { id: string }): SumberBarisDaftar => ({
  created_at: "2026-10-01T03:00:00Z", pet_id: "p1", branch_id: "b", dokter: "drh", keluhan: "gatal", legacy_source_key: null,
  pets: { name: "choco", species: "Kucing", breed: null }, customers: { name: "tes", phone: "085845455145" },
  branches: { code: "VET_CMGG" }, medical_records: { diagnosis: "dermatitis", anamnesis: "gatal" }, inpatient_records: [], ...o,
});
const k = (o: Partial<SumberBarisDaftar> & { id: string }): BarisKunjungan => petakanKunjungan(sumber(o));

describe("bacaKelompok", () => {
  it("bawaan Per pasien; hanya 'kunjungan' memilih tampilan lama", () => {
    expect(bacaKelompok(undefined)).toBe("pasien");
    expect(bacaKelompok("")).toBe("pasien");
    expect(bacaKelompok("ngawur")).toBe("pasien");
    expect(bacaKelompok("pasien")).toBe("pasien");
    expect(bacaKelompok("kunjungan")).toBe("kunjungan");
  });
});

describe("petakanKunjungan", () => {
  it("memetakan relasi objek/array, pemilik impor placeholder, dan penanda rawat inap", () => {
    const r = k({ id: "v", pets: [{ name: "Mochi", species: "Anjing", breed: "Poodle" }], inpatient_records: [{ created_at: "2026-10-01", discharged_at: null, condition_status: "stabil" }] });
    expect(r).toMatchObject({ petName: "Mochi", species: "Anjing", breed: "Poodle", branch: "VET_CMGG", punyaRawatInap: true, activeInpatient: true });
    expect(k({ id: "v2" }).punyaRawatInap).toBe(false);
  });
});

describe("kelompokkanPerPasien", () => {
  it("kunjungan hewan yang sama (pet_id) menjadi satu kelompok dengan jumlah dan kunjungan terakhir", () => {
    const g = kelompokkanPerPasien([
      k({ id: "a", created_at: "2026-10-01T03:00:00Z" }), k({ id: "c", created_at: "2026-10-31T03:00:00Z", keluhan: "terbaru" }), k({ id: "b", created_at: "2026-10-15T03:00:00Z" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ petId: "p1", petName: "choco", jumlah: 3, jumlahRawatInap: 0, jumlahImpor: 0, kembar: false });
    expect(g[0].terakhir.id).toBe("c");
  });

  it("hewan berbeda milik pemilik yang sama tetap dua kelompok (kunci = pet_id, bukan teks)", () => {
    const g = kelompokkanPerPasien([
      k({ id: "a", pet_id: "p1" }), k({ id: "b", pet_id: "p2", pets: { name: "mochi", species: "Anjing", breed: null }, created_at: "2026-10-02T03:00:00Z" }),
    ]);
    expect(g.map((x) => x.petId)).toEqual(["p2", "p1"]);
    expect(g.every((x) => x.kembar === false)).toBe(true);
  });

  it("pet_id kosong: tiap kunjungan berdiri sendiri, tanpa petId (tidak ada tautan Riwayat)", () => {
    const g = kelompokkanPerPasien([k({ id: "a", pet_id: null }), k({ id: "b", pet_id: null, created_at: "2026-10-02T03:00:00Z" })]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.petId === null && x.jumlah === 1)).toBe(true);
  });

  it("menghitung rawat inap dan impor per hewan", () => {
    const inap = [{ created_at: "2026-10-01", discharged_at: "2026-10-03", condition_status: "sembuh" }];
    const g = kelompokkanPerPasien([
      k({ id: "a", inpatient_records: inap }), k({ id: "b", inpatient_records: inap, created_at: "2026-10-05T03:00:00Z" }),
      k({ id: "c", legacy_source_key: "impor::1", branch_id: null, branches: null, created_at: "2026-09-01T03:00:00Z" }), k({ id: "d", created_at: "2026-10-09T03:00:00Z" }),
    ]);
    expect(g[0]).toMatchObject({ jumlah: 4, jumlahRawatInap: 2, jumlahImpor: 1 });
    expect(g[0].terakhir.id).toBe("d");
  });

  it("urut kunjungan terakhir terbaru dulu; seri tanggal diputus id", () => {
    const g = kelompokkanPerPasien([
      k({ id: "x", pet_id: "p1", created_at: "2026-10-01T03:00:00Z" }), k({ id: "z", pet_id: "p3", created_at: "2026-11-01T03:00:00Z" }),
      k({ id: "y", pet_id: "p2", created_at: "2026-11-01T03:00:00Z" }),
    ]);
    expect(g.map((x) => x.terakhir.id)).toEqual(["y", "z", "x"]);
  });

  it("penanda hewan kembar: pemilik + nama + jenis sama tetapi pet_id berbeda; data tidak digabung", () => {
    const g = kelompokkanPerPasien([
      k({ id: "a", pet_id: "p1" }), k({ id: "b", pet_id: "p9", created_at: "2026-10-02T03:00:00Z", pets: { name: " Choco ", species: "kucing", breed: null } }),
      k({ id: "c", pet_id: "p3", pets: { name: "choco", species: "Anjing", breed: null } }),
    ]);
    expect(g).toHaveLength(3);
    expect(g.find((x) => x.petId === "p1")?.kembar).toBe(true);
    expect(g.find((x) => x.petId === "p9")?.kembar).toBe(true);
    expect(g.find((x) => x.petId === "p3")?.kembar).toBe(false); // jenis lain
    expect(g.find((x) => x.petId === "p1")?.jumlah).toBe(1);
  });

  it("pemilik tidak dikenal / pemilik berbeda tidak dianggap kembar", () => {
    const tanpaPemilik = { customers: null };
    const g = kelompokkanPerPasien([
      k({ id: "a", pet_id: "p1", ...tanpaPemilik }), k({ id: "b", pet_id: "p2", ...tanpaPemilik }),
      k({ id: "c", pet_id: "p3", customers: { name: "Budi", phone: "0811" } }), k({ id: "d", pet_id: "p4", customers: { name: "Sari", phone: "0822" } }),
    ]);
    expect(g.every((x) => !x.kembar)).toBe(true);
  });

  it("daftar kosong -> kelompok kosong", () => { expect(kelompokkanPerPasien([])).toEqual([]); });
});

describe("susunDaftarPerPasien (jendela)", () => {
  it("jendela habis hanya bila jumlah yang cocok melebihi jendela", () => {
    const v = [k({ id: "a" })];
    expect(susunDaftarPerPasien(v, 1).jendelaHabis).toBe(false);
    expect(susunDaftarPerPasien(v, JENDELA_KUNJUNGAN).jendelaHabis).toBe(false);
    expect(susunDaftarPerPasien(v, JENDELA_KUNJUNGAN + 1)).toMatchObject({ jendelaHabis: true, dibaca: 1, jumlahCocok: JENDELA_KUNJUNGAN + 1 });
  });
});

describe("ringkasTeks", () => {
  it("merapikan spasi, memotong panjang, dan null bila kosong", () => {
    expect(ringkasTeks("  a \n b  ")).toBe("a b");
    expect(ringkasTeks("x".repeat(200), 20)).toHaveLength(20);
    expect(ringkasTeks("x".repeat(200), 20)?.endsWith("…")).toBe(true);
    expect(ringkasTeks("   ")).toBeNull();
    expect(ringkasTeks(null)).toBeNull();
  });
});
