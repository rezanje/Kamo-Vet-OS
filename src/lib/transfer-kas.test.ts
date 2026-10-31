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
    const lines = jurnalTransfer("110003", "120002", 1000000, 6500);
    expect(lines).toEqual([
      { code: "120002", debit: 1000000, credit: 0 },
      { code: "740010", debit: 6500, credit: 0 },
      { code: "110003", debit: 0, credit: 1006500 },
    ]);
    expect(totalDebit(lines)).toBe(totalKredit(lines));
  });

  it("tanpa biaya admin, baris beban tidak dibuat", () => {
    const lines = jurnalTransfer("110003", "120002", 250000, 0);
    expect(lines).toEqual([
      { code: "120002", debit: 250000, credit: 0 },
      { code: "110003", debit: 0, credit: 250000 },
    ]);
    expect(totalDebit(lines)).toBe(totalKredit(lines));
  });

  it("biaya negatif dari data kotor diperlakukan nol, bukan mengurangi kredit sumber", () => {
    const lines = jurnalTransfer("110003", "120002", 100000, -50000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ code: "110003", debit: 0, credit: 100000 });
  });
});

describe("jurnalBalik", () => {
  it("debit & kredit ditukar, tetap seimbang", () => {
    const asli = jurnalTransfer("110003", "120002", 1000000, 6500);
    const balik = jurnalBalik(asli);
    expect(balik).toEqual([
      { code: "120002", debit: 0, credit: 1000000 },
      { code: "740010", debit: 0, credit: 6500 },
      { code: "110003", debit: 1006500, credit: 0 },
    ]);
    expect(totalDebit(balik)).toBe(totalKredit(balik));
  });

  it("dibalik dua kali kembali ke asal", () => {
    const asli = jurnalTransfer("110003", "120002", 77000, 0);
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
  it("kas melanjutkan bagan akun 110001–110022 dan melompati kode terpakai", () => {
    expect(kodeAkunBerikutnya(["110003", "120002", "182004"])).toBe("110023");
    expect(kodeAkunBerikutnya(["110003", "110023", "110024"], "Kas")).toBe("110025");
  });

  it("bank memakai rentangnya sendiri, melanjutkan 120001–120006", () => {
    expect(kodeAkunBerikutnya(["120002", "120007"], "Bank")).toBe("120008");
  });

  it("mengabaikan kode di luar rentang kas/bank", () => {
    expect(kodeAkunBerikutnya(["170001", "510001", "750004"])).toBe("110023");
  });

  it("rentang penuh mengembalikan null, bukan kode ngawur", () => {
    const penuh = Array.from({ length: 129999 - 120007 + 1 }, (_, i) => String(120007 + i));
    expect(kodeAkunBerikutnya(penuh, "Bank")).toBeNull();
  });
});
