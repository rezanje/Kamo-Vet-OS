import { describe, it, expect } from "vitest";
import {
  validasiTransfer, jurnalTransfer, jurnalBalik, nomorTransfer, kodeAkunBerikutnya,
  type JurnalBaris,
} from "./transfer-kas";

const draft = {
  tanggal: "2026-07-29", dariId: "kas", keId: "bca",
  jumlah: 1000000, biayaAdmin: 6500, hariIni: "2026-07-29",
};

const totalDebit = (l: JurnalBaris[]) => l.reduce((a, x) => a + x.debit, 0);
const totalKredit = (l: JurnalBaris[]) => l.reduce((a, x) => a + x.credit, 0);

describe("validasiTransfer", () => {
  it("draft wajar lolos", () => {
    expect(validasiTransfer(draft)).toBeNull();
  });

  it("rekening sumber & tujuan tidak boleh sama", () => {
    expect(validasiTransfer({ ...draft, keId: "kas" })).toMatch(/tidak boleh sama/i);
  });

  it("rekening wajib dipilih dua-duanya", () => {
    expect(validasiTransfer({ ...draft, dariId: "" })).toMatch(/sumber wajib/i);
    expect(validasiTransfer({ ...draft, keId: "" })).toMatch(/tujuan wajib/i);
  });

  it("jumlah nol atau negatif ditolak", () => {
    expect(validasiTransfer({ ...draft, jumlah: 0 })).toMatch(/lebih dari 0/i);
    expect(validasiTransfer({ ...draft, jumlah: -5000 })).toMatch(/lebih dari 0/i);
    expect(validasiTransfer({ ...draft, jumlah: Number.NaN })).toMatch(/lebih dari 0/i);
  });

  it("biaya admin negatif ditolak, nol boleh", () => {
    expect(validasiTransfer({ ...draft, biayaAdmin: -1 })).toMatch(/negatif/i);
    expect(validasiTransfer({ ...draft, biayaAdmin: 0 })).toBeNull();
  });

  it("tanggal masa depan ditolak, tanggal lampau boleh", () => {
    expect(validasiTransfer({ ...draft, tanggal: "2026-07-30" })).toMatch(/masa depan/i);
    expect(validasiTransfer({ ...draft, tanggal: "2026-01-15" })).toBeNull();
  });

  it("format tanggal ngawur ditolak", () => {
    expect(validasiTransfer({ ...draft, tanggal: "29/07/2026" })).toMatch(/tidak valid/i);
  });
});

describe("jurnalTransfer", () => {
  it("biaya admin dibebankan ke rekening sumber", () => {
    const lines = jurnalTransfer("1101", "1102", 1000000, 6500);
    expect(lines).toEqual([
      { code: "1102", debit: 1000000, credit: 0 },
      { code: "5501", debit: 6500, credit: 0 },
      { code: "1101", debit: 0, credit: 1006500 },
    ]);
    expect(totalDebit(lines)).toBe(totalKredit(lines));
  });

  it("tanpa biaya admin, baris beban tidak dibuat", () => {
    const lines = jurnalTransfer("1101", "1102", 250000, 0);
    expect(lines).toEqual([
      { code: "1102", debit: 250000, credit: 0 },
      { code: "1101", debit: 0, credit: 250000 },
    ]);
    expect(totalDebit(lines)).toBe(totalKredit(lines));
  });

  it("biaya negatif dari data kotor diperlakukan nol, bukan mengurangi kredit sumber", () => {
    const lines = jurnalTransfer("1101", "1102", 100000, -50000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ code: "1101", debit: 0, credit: 100000 });
  });
});

describe("jurnalBalik", () => {
  it("debit & kredit ditukar, tetap seimbang", () => {
    const asli = jurnalTransfer("1101", "1102", 1000000, 6500);
    const balik = jurnalBalik(asli);
    expect(balik).toEqual([
      { code: "1102", debit: 0, credit: 1000000 },
      { code: "5501", debit: 0, credit: 6500 },
      { code: "1101", debit: 1006500, credit: 0 },
    ]);
    expect(totalDebit(balik)).toBe(totalKredit(balik));
  });

  it("dibalik dua kali kembali ke asal", () => {
    const asli = jurnalTransfer("1101", "1102", 77000, 0);
    expect(jurnalBalik(jurnalBalik(asli))).toEqual(asli);
  });
});

describe("nomorTransfer", () => {
  it("format TF.YYYY.MM.NNNNN, urut dari hitungan bulan berjalan", () => {
    expect(nomorTransfer("2026-07-29", 0)).toBe("TF.2026.07.00001");
    expect(nomorTransfer("2026-07-29", 41)).toBe("TF.2026.07.00042");
  });

  it("ganti bulan mulai dari 1 lagi", () => {
    expect(nomorTransfer("2026-08-01", 0)).toBe("TF.2026.08.00001");
  });
});

describe("kodeAkunBerikutnya", () => {
  it("melompati kode yang sudah terpakai (1105 = PPN Masukan)", () => {
    expect(kodeAkunBerikutnya(["1101", "1102", "1105"])).toBe("1103");
    expect(kodeAkunBerikutnya(["1101", "1102", "1103", "1104", "1105"])).toBe("1106");
  });

  it("mengabaikan kode di luar rentang kas/bank", () => {
    expect(kodeAkunBerikutnya(["1301", "4101", "5601"])).toBe("1103");
  });

  it("rentang penuh mengembalikan null, bukan kode ngawur", () => {
    const penuh = Array.from({ length: 97 }, (_, i) => String(1103 + i)); // 1103..1199
    expect(kodeAkunBerikutnya(penuh)).toBeNull();
  });
});
