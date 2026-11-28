import { describe, expect, it } from "vitest";
import { idCabangKopRombongan, nomorTagihanRombongan, punyaRombongan, rincianTagihanUtuh, sisaTagihan, totalGabunganCocok } from "../rombongan-cetak";

describe("nomorTagihanRombongan", () => {
  it("mengumpulkan semua nomor aktif, tanpa duplikat, tanpa kunjungan yang belum ditagih", () => {
    expect(nomorTagihanRombongan([
      { invoiceNo: "A", invoiceNos: ["A", "A2"] }, { invoiceNo: null }, { invoiceNo: "B" }, { invoiceNo: "B", invoiceNos: ["B"] },
    ])).toEqual(["A", "A2", "B"]);
    expect(nomorTagihanRombongan([])).toEqual([]);
    expect(nomorTagihanRombongan([{ invoiceNo: null }])).toEqual([]);
  });
});

describe("rincianTagihanUtuh", () => {
  const baris = (...no: string[]) => no.map((invoice_no) => ({ invoice_no }));
  it("utuh: jumlah sama, tiap nomor sekali, tidak ada nomor asing", () => {
    expect(rincianTagihanUtuh(["A", "B"], baris("B", "A"), null)).toBe(true);
  });
  it("tanpa nomor yang diminta: tidak ada yang diverifikasi", () => {
    expect(rincianTagihanUtuh([], [], null)).toBe(true);
    expect(rincianTagihanUtuh([], null, { message: "x" })).toBe(true);
  });
  it("galat, bukan daftar, terpotong, duplikat, nomor asing, bukan teks: semuanya tidak utuh", () => {
    expect(rincianTagihanUtuh(["A", "B"], baris("A", "B"), { message: "gagal" })).toBe(false);
    expect(rincianTagihanUtuh(["A"], null, null)).toBe(false);
    expect(rincianTagihanUtuh(["A"], { invoice_no: "A" }, null)).toBe(false);
    expect(rincianTagihanUtuh(["A", "B"], baris("A"), null)).toBe(false);
    expect(rincianTagihanUtuh(["A", "B"], baris("A", "A"), null)).toBe(false);
    expect(rincianTagihanUtuh(["A", "B"], baris("A", "C"), null)).toBe(false);
    expect(rincianTagihanUtuh(["A", "B"], baris("A", "B", "C"), null)).toBe(false);
    expect(rincianTagihanUtuh(["A"], [{ invoice_no: 7 }], null)).toBe(false);
    expect(rincianTagihanUtuh(["A"], [null], null)).toBe(false);
  });
});

describe("idCabangKopRombongan", () => {
  const t = (id: string | null) => ({ visits: id === null ? null : { branch_id: id } });
  it("satu cabang penerbit: cabang itu (juga bila tersimpan sebagai larik)", () => {
    expect(idCabangKopRombongan(["A", "B"], [t("c1"), t("c1")], "acuan")).toBe("c1");
    expect(idCabangKopRombongan(["A"], [{ visits: [{ branch_id: "c9" }] }], "acuan")).toBe("c9");
  });
  it("beda cabang: tidak ada identitas (null), cabang acuan tidak dipakai", () => {
    expect(idCabangKopRombongan(["A", "B"], [t("c1"), t("c2")], "acuan")).toBeNull();
  });
  it("satu tagihan tanpa cabang tercatat: null, bukan cabang acuan", () => {
    expect(idCabangKopRombongan(["A"], [t(null)], "acuan")).toBeNull();
  });
  it("tanpa tagihan: cabang kunjungan acuan; acuan kosong: null", () => {
    expect(idCabangKopRombongan([], [], "acuan")).toBe("acuan");
    expect(idCabangKopRombongan([], [], undefined)).toBeNull();
  });
});

describe("totalGabunganCocok", () => {
  it("cocok bila jumlah total tiap tagihan sama dengan total daftar (toleransi sen)", () => {
    expect(totalGabunganCocok(225500, [45000, 100000, 80500])).toBe(true);
    expect(totalGabunganCocok(100.004, [100])).toBe(true);
    expect(totalGabunganCocok(0, [])).toBe(true);
  });
  it("tidak cocok bila selisih sen atau lebih besar", () => {
    expect(totalGabunganCocok(225500, [45000, 100000, 80501])).toBe(false);
    expect(totalGabunganCocok(100.01, [100])).toBe(false);
    expect(totalGabunganCocok(500, [])).toBe(false);
  });
});

describe("sisaTagihan", () => {
  it("lunas: sisa 0 berapa pun pembayarannya", () => {
    expect(sisaTagihan({ total: 100, dp_amount: 0, paid_status: "Lunas" }, [])).toEqual({ lunas: true, diterima: 0, sisa: 0 });
  });
  it("DP + pelunasan menyusul dijumlah; sisa tidak negatif", () => {
    expect(sisaTagihan({ total: 80500, dp_amount: 30000, paid_status: "DP" }, [{ amount: 20000 }])).toEqual({ lunas: false, diterima: 50000, sisa: 30500 });
    expect(sisaTagihan({ total: "1000", dp_amount: "600", paid_status: "DP" }, [{ amount: "700" }])).toEqual({ lunas: false, diterima: 1300, sisa: 0 });
    expect(sisaTagihan({ total: 1000, dp_amount: null, paid_status: "Belum Lunas" }, [])).toEqual({ lunas: false, diterima: 0, sisa: 1000 });
  });
});

describe("punyaRombongan", () => {
  it("hanya lebih dari satu hewan", () => {
    expect(punyaRombongan(null)).toBe(false); expect(punyaRombongan(undefined)).toBe(false);
    expect(punyaRombongan([])).toBe(false); expect(punyaRombongan([1])).toBe(false);
    expect(punyaRombongan([1, 2])).toBe(true); expect(punyaRombongan([1, 2, 3])).toBe(true);
  });
});
