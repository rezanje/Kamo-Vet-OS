import { describe, expect, it } from "vitest";
import { akunLawanTerlarang, jurnalKasEntry, nomorKasEntry, validasiKasEntry } from "../kas-entry";
import { jurnalBalik } from "../transfer-kas";

const dasar = {
  jenis: "Keluar" as const,
  tanggal: "2026-07-30",
  accountId: "rek-1",
  lawanCode: "760003",
  jumlah: 50000,
  hariIni: "2026-07-30",
};

describe("validasiKasEntry", () => {
  it("draft benar lolos", () => {
    expect(validasiKasEntry(dasar)).toBeNull();
  });
  it("jumlah 0 / negatif ditolak", () => {
    expect(validasiKasEntry({ ...dasar, jumlah: 0 })).toMatch(/lebih dari 0/);
    expect(validasiKasEntry({ ...dasar, jumlah: -1 })).toMatch(/lebih dari 0/);
  });
  it("tanggal masa depan ditolak", () => {
    expect(validasiKasEntry({ ...dasar, tanggal: "2026-07-31" })).toMatch(/masa depan/);
  });
  it("rekening & akun lawan wajib", () => {
    expect(validasiKasEntry({ ...dasar, accountId: "" })).toMatch(/Rekening/);
    expect(validasiKasEntry({ ...dasar, lawanCode: "" })).toMatch(/Akun lawan/);
  });
});

describe("jurnalKasEntry", () => {
  it("kas keluar: beban didebit, kas dikredit", () => {
    expect(jurnalKasEntry("Keluar", "110003", "760003", 50000)).toEqual([
      { code: "760003", debit: 50000, credit: 0 },
      { code: "110003", debit: 0, credit: 50000 },
    ]);
  });

  it("kas masuk: kas didebit, akun lawan dikredit", () => {
    expect(jurnalKasEntry("Masuk", "110003", "4901", 75000)).toEqual([
      { code: "110003", debit: 75000, credit: 0 },
      { code: "4901", debit: 0, credit: 75000 },
    ]);
  });

  it("selalu seimbang", () => {
    for (const j of ["Masuk", "Keluar"] as const) {
      const lines = jurnalKasEntry(j, "120002", "720002", 12345);
      const d = lines.reduce((a, l) => a + l.debit, 0);
      const k = lines.reduce((a, l) => a + l.credit, 0);
      expect(d).toBe(k);
    }
  });

  it("jurnal balik membatalkan efeknya", () => {
    const asli = jurnalKasEntry("Keluar", "110003", "760003", 50000);
    expect(jurnalBalik(asli)).toEqual([
      { code: "760003", debit: 0, credit: 50000 },
      { code: "110003", debit: 50000, credit: 0 },
    ]);
  });
});

describe("nomorKasEntry", () => {
  it("awalan beda per jenis, urut per bulan", () => {
    expect(nomorKasEntry("Masuk", "2026-07-30", 0)).toBe("KM.2026.07.00001");
    expect(nomorKasEntry("Keluar", "2026-07-30", 41)).toBe("KK.2026.07.00042");
  });
});

describe("akunLawanTerlarang", () => {
  it("rekening kas/bank tidak boleh jadi akun lawan", () => {
    const larangan = akunLawanTerlarang(["110003", " 120002 "]);
    expect(larangan.has("110003")).toBe(true);
    expect(larangan.has("120002")).toBe(true);
    expect(larangan.has("760003")).toBe(false);
  });
});
