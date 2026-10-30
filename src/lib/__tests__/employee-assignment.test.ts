import { describe, expect, it } from "vitest";
import {
  bacaAkhiriPenugasan, bacaCabangUtamaMassal, keadaanPenugasan, labelPenugasan,
  penugasanBerlaku, saringanPenugasanAktif, tanggalSingkat,
} from "../employee-assignment";

const HARI_INI = "2026-10-29";
const EMP = "a1000000-0000-4000-8000-000000000001";
const CAB = "a2000000-0000-4000-8000-000000000001";

describe("penugasanBerlaku", () => {
  it("berlaku saat sudah mulai dan belum punya tanggal berakhir", () => {
    expect(penugasanBerlaku({ effective_date: "2026-01-01", end_date: null }, HARI_INI)).toBe(true);
  });
  it("hari terakhir masih dihitung berlaku, besoknya tidak", () => {
    expect(penugasanBerlaku({ effective_date: "2026-01-01", end_date: HARI_INI }, HARI_INI)).toBe(true);
    expect(penugasanBerlaku({ effective_date: "2026-01-01", end_date: "2026-10-28" }, HARI_INI)).toBe(false);
  });
  it("penugasan bertanggal depan belum berlaku", () => {
    expect(penugasanBerlaku({ effective_date: "2026-11-05", end_date: null }, HARI_INI)).toBe(false);
  });
});

describe("keterangan penugasan di layar (R1)", () => {
  it.each([
    [{ effective_date: "2026-11-05", end_date: null }, "akan-datang", "Mulai 5 Nov"],
    [{ effective_date: "2026-01-01", end_date: "2026-10-28" }, "berakhir", "Berakhir 28 Okt"],
    [{ effective_date: "2026-01-01", end_date: "2026-11-30" }, "berjalan", "Sampai 30 Nov"],
    [{ effective_date: "2026-01-01", end_date: null }, "berjalan", ""],
  ])("%o → %s", (row, keadaan, label) => {
    expect(keadaanPenugasan(row, HARI_INI)).toBe(keadaan);
    expect(labelPenugasan(row, HARI_INI)).toBe(label);
  });
  it("menuliskan tahun bila berbeda dari tahun acuan", () => {
    expect(tanggalSingkat("2027-01-03", HARI_INI)).toBe("3 Jan 2027");
    expect(tanggalSingkat("2026-01-03", HARI_INI)).toBe("3 Jan");
  });
});

describe("saringanPenugasanAktif", () => {
  it("menyaring yang belum berakhir saja", () => {
    expect(saringanPenugasanAktif(HARI_INI)).toBe("end_date.is.null,end_date.gte.2026-10-29");
  });
});

describe("bacaAkhiriPenugasan", () => {
  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    Object.entries({ employee_id: EMP, branch_id: CAB, reason: "Selesai masa bantuan", ...extra })
      .forEach(([key, value]) => data.set(key, value));
    return data;
  };
  it("tanpa tanggal memakai hari ini", () => {
    expect(bacaAkhiriPenugasan(form(), HARI_INI)).toEqual({ employeeId: EMP, branchId: CAB, endDate: HARI_INI, reason: "Selesai masa bantuan" });
  });
  it("menerima tanggal berakhir di masa depan", () => {
    expect(bacaAkhiriPenugasan(form({ end_date: "2026-11-30" }), HARI_INI).endDate).toBe("2026-11-30");
  });
  it("menolak alasan kosong atau terlalu pendek", () => {
    expect(() => bacaAkhiriPenugasan(form({ reason: "" }), HARI_INI)).toThrow("Alasan");
    expect(() => bacaAkhiriPenugasan(form({ reason: "ya" }), HARI_INI)).toThrow("Alasan");
  });
  it("menolak identitas dan tanggal yang tidak valid", () => {
    expect(() => bacaAkhiriPenugasan(form({ branch_id: "bukan-uuid" }), HARI_INI)).toThrow();
    expect(() => bacaAkhiriPenugasan(form({ end_date: "2026-02-30" }), HARI_INI)).toThrow("Tanggal");
  });
});

describe("bacaCabangUtamaMassal", () => {
  const form = (ids: string[], extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set("branch_id", CAB);
    Object.entries(extra).forEach(([key, value]) => data.set(key, value));
    ids.forEach(id => data.append("employee_ids", id));
    return data;
  };
  it("membuang pilihan ganda dan membiarkan alasan kosong", () => {
    expect(bacaCabangUtamaMassal(form([EMP, EMP]))).toEqual({ branchId: CAB, employeeIds: [EMP], reason: null });
  });
  it("menolak tanpa karyawan, tanpa cabang, atau di atas 200 orang", () => {
    expect(() => bacaCabangUtamaMassal(form([]))).toThrow();
    const banyak = Array.from({ length: 201 }, (_, i) => `a1000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(() => bacaCabangUtamaMassal(form(banyak))).toThrow();
    const tanpaCabang = form([EMP]); tanpaCabang.set("branch_id", "");
    expect(() => bacaCabangUtamaMassal(tanpaCabang)).toThrow("cabang");
  });
  it("menolak alasan yang terlalu pendek bila diisi", () => {
    expect(() => bacaCabangUtamaMassal(form([EMP], { reason: "ya" }))).toThrow("Alasan");
  });
});
