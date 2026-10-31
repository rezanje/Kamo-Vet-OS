import { describe, expect, it } from "vitest";
import {
  anggaranEfektif, bolehTransfer, realisasiAkun, ringkasSerapan, statusSerapan,
} from "../anggaran";

describe("anggaranEfektif", () => {
  const dasar = [{ coaCode: "720002", jumlah: 5_000_000 }, { coaCode: "740003", jumlah: 2_000_000 }];

  it("tanpa transfer = angka aslinya", () => {
    const e = anggaranEfektif(dasar, []);
    expect(e.get("720002")).toBe(5_000_000);
    expect(e.get("740003")).toBe(2_000_000);
  });

  it("transfer memindahkan jatah tanpa mengubah totalnya", () => {
    const e = anggaranEfektif(dasar, [{ dariCoa: "720002", keCoa: "740003", jumlah: 1_500_000 }]);
    expect(e.get("720002")).toBe(3_500_000);
    expect(e.get("740003")).toBe(3_500_000);
    expect([...e.values()].reduce((a, b) => a + b, 0)).toBe(7_000_000);
  });

  it("pos tujuan yang belum dianggarkan ikut muncul", () => {
    const e = anggaranEfektif(dasar, [{ dariCoa: "720002", keCoa: "760003", jumlah: 1_000_000 }]);
    expect(e.get("760003")).toBe(1_000_000);
  });
});

describe("realisasiAkun", () => {
  it("beban = debit dikurangi kredit", () => {
    expect(realisasiAkun([{ debit: 500_000, credit: 0 }, { debit: 250_000, credit: 0 }])).toBe(750_000);
  });

  it("jurnal pembalikan mengurangi realisasi, bukan menambah", () => {
    expect(realisasiAkun([{ debit: 500_000, credit: 0 }, { debit: 0, credit: 200_000 }])).toBe(300_000);
  });

  it("tanpa baris = nol", () => {
    expect(realisasiAkun([])).toBe(0);
  });
});

describe("statusSerapan", () => {
  it("di bawah 85% aman, 85%+ waspada, di atas 100% lewat", () => {
    expect(statusSerapan(1_000_000, 500_000)).toBe("aman");
    expect(statusSerapan(1_000_000, 850_000)).toBe("waspada");
    expect(statusSerapan(1_000_000, 1_000_000)).toBe("waspada");
    expect(statusSerapan(1_000_000, 1_000_001)).toBe("lewat");
  });

  it("belanja tanpa anggaran langsung dianggap lewat", () => {
    expect(statusSerapan(0, 250_000)).toBe("lewat");
    expect(statusSerapan(0, 0)).toBe("aman");
  });
});

describe("ringkasSerapan", () => {
  it("hitung sisa & persen, urut dari belanja terbesar", () => {
    const r = ringkasSerapan(
      new Map([["720002", 1_000_000], ["740003", 2_000_000]]),
      new Map([["720002", 900_000], ["740003", 500_000]]),
    );
    expect(r[0]).toMatchObject({ coaCode: "720002", sisa: 100_000, persen: 90, status: "waspada" });
    expect(r[1]).toMatchObject({ coaCode: "740003", sisa: 1_500_000, persen: 25, status: "aman" });
  });

  it("pengeluaran di luar rencana tetap muncul", () => {
    const r = ringkasSerapan(new Map(), new Map([["760003", 300_000]]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ anggaran: 0, realisasi: 300_000, sisa: -300_000, status: "lewat" });
  });
});

describe("bolehTransfer", () => {
  it("hanya sisa yang belum terpakai yang boleh digeser", () => {
    expect(bolehTransfer(5_000_000, 3_000_000, 2_000_000)).toEqual({ boleh: true, maksimal: 2_000_000 });
    expect(bolehTransfer(5_000_000, 3_000_000, 2_000_001)).toEqual({ boleh: false, maksimal: 2_000_000 });
  });

  it("pos yang sudah habis terpakai tidak bisa menyumbang", () => {
    expect(bolehTransfer(1_000_000, 1_200_000, 1)).toEqual({ boleh: false, maksimal: 0 });
  });

  it("nominal nol atau negatif ditolak", () => {
    expect(bolehTransfer(5_000_000, 0, 0).boleh).toBe(false);
    expect(bolehTransfer(5_000_000, 0, -100).boleh).toBe(false);
  });
});
