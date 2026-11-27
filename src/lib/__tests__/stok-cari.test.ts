import { describe, expect, it } from "vitest";
import { kataCariStok, peringkatCariStok, polaCariStok, saringCariStok } from "../stok-cari";

describe("polaCariStok", () => {
  it("kosong → null", () => {
    expect(polaCariStok("")).toBeNull();
    expect(polaCariStok("   ")).toBeNull();
    expect(polaCariStok(undefined)).toBeNull();
  });
  it("spasi jadi wildcard", () => {
    expect(polaCariStok("bolt 1kg")).toBe("*bolt*1kg*");
  });
  it("membuang karakter sintaks filter", () => {
    expect(polaCariStok("a,b(c)%_*:\"'\\")).toBe("*a*b*c*");
  });
});

describe("kataCariStok", () => {
  it("memakai pembersihan yang sama dengan pola database", () => {
    expect(kataCariStok("  Bolt   1KG ")).toEqual(["bolt", "1kg"]);
    expect(kataCariStok("1,5kg")).toEqual(["1", "5kg"]);
    expect(kataCariStok("%%")).toEqual([]);
    expect(kataCariStok(null)).toEqual([]);
  });
});

const peringkat = (q: string, code: string, name: string) => peringkatCariStok(kataCariStok(q), code, name);

describe("peringkatCariStok", () => {
  it("nama diawali kata pencarian paling pas", () => {
    expect(peringkat("rc", "RC001", "RC Adult Persian")).toBe(0);
    expect(peringkat("RC", "DRC3182550751988", "RC Digestive 400gr")).toBe(0);
  });
  it("kata pencarian mengawali kata lain di nama", () => {
    expect(peringkat("rc", "X1", "(non aktif) RC Kitten 2kg")).toBe(1);
    expect(peringkat("kitten", "RC009", "RC British Shorthair Kitten 2kg")).toBe(1);
    expect(peringkat("canin", "100655", "Royal Canin cat Hairball Control")).toBe(1);
  });
  it("peralihan huruf↔angka dihitung awal kata", () => {
    expect(peringkat("gr", "X1", "Bolt Donat 800gr")).toBe(1);
    expect(peringkat("1,5kg", "X1", "RC Chihuahua Adult 1,5kg")).toBe(1);
  });
  it("awalan kode atau bagian kode", () => {
    expect(peringkat("rc", "RCC-000001", "Rocco Snack")).toBe(2);
    expect(peringkat("b001", "B001", "BOLT IKAN 1KG")).toBe(2);
    expect(peringkat("8997210900539", "DRC8997210900539", "Beauty Premium")).toBe(2);
    expect(peringkat("food", "DOG FOOD-000007", "Dog Medium 4kg")).toBe(2);
  });
  it("menempel di tengah kata/kode hanya cocok longgar", () => {
    expect(peringkat("rc", "DRC8997210900539", "Beauty Premium")).toBe(3);
    expect(peringkat("rc", "CTDRC0001", "Catie Care 1 KG")).toBe(3);
    expect(peringkat("rc", "OBV0016", "(non aktif) Curcuma Sirup 200Ml")).toBe(3);
    expect(peringkat("rc", "ALK-00006", "Allis Forceps")).toBe(3);
    expect(peringkat("rc", "100481", "Arthacat Tofu 7L Charcoal")).toBe(3);
    expect(peringkat("326987", "DRC8993374326987", "Bolt Donat 800gr")).toBe(3);
  });
  it("beberapa kata harus berurutan", () => {
    expect(peringkat("bolt 1kg", "B001", "BOLT IKAN 1KG")).toBe(0);
    expect(peringkat("1kg bolt", "B001", "BOLT IKAN 1KG")).toBeNull();
  });
  it("tidak cocok", () => {
    expect(peringkat("whiskas", "B001", "BOLT IKAN 1KG")).toBeNull();
  });
});

describe("saringCariStok", () => {
  // Urutan asal = urut nama, seperti matrix di layar.
  const barang = [
    { code: "OBV0016", name: "(non aktif) Curcuma Sirup 200Ml" },
    { code: "ALK-00006", name: "Allis Forceps" },
    { code: "DRC8997210900539", name: "Beauty Premium" },
    { code: "DRC8993374326987", name: "Bolt Donat 800gr" },
    { code: "RC001", name: "RC Adult Persian" },
    { code: "DRC3182550751988", name: "RC Digestive 400gr" },
    { code: "RCC-000001", name: "Rocco Snack" },
    { code: "W001", name: "Whiskas Tuna" },
  ];
  const ambil = (b: (typeof barang)[number]) => b;
  const nama = (q: string, semua = false) => saringCariStok(barang, q, ambil, semua).baris.map((b) => b.name);

  it("\"RC\" hanya menampilkan barang RC, bukan kode DRC atau nama seperti Curcuma", () => {
    const hasil = saringCariStok(barang, "RC", ambil);
    expect(hasil.baris.map((b) => b.name)).toEqual(["RC Adult Persian", "RC Digestive 400gr", "Rocco Snack"]);
    expect(hasil.ringkas).toEqual({ pas: 3, longgar: 4, tampilLonggar: false });
  });
  it("cocokan longgar bisa diminta, tetap di bawah yang pas", () => {
    const hasil = saringCariStok(barang, "RC", ambil, true);
    expect(hasil.baris.map((b) => b.name)).toEqual([
      "RC Adult Persian", "RC Digestive 400gr", "Rocco Snack",
      "(non aktif) Curcuma Sirup 200Ml", "Allis Forceps", "Beauty Premium", "Bolt Donat 800gr",
    ]);
    expect(hasil.ringkas).toEqual({ pas: 3, longgar: 4, tampilLonggar: true });
  });
  it("tanpa cocokan pas, cocokan longgar tetap tampil (potongan barcode)", () => {
    const hasil = saringCariStok(barang, "326987", ambil);
    expect(hasil.baris.map((b) => b.name)).toEqual(["Bolt Donat 800gr"]);
    expect(hasil.ringkas).toEqual({ pas: 0, longgar: 1, tampilLonggar: true });
  });
  it("awalan kode tetap bisa dicari", () => {
    expect(nama("drc")).toEqual(["Beauty Premium", "Bolt Donat 800gr", "RC Digestive 400gr"]);
  });
  it("pencarian kosong mengembalikan semua barang apa adanya", () => {
    const hasil = saringCariStok(barang, "  ", ambil);
    expect(hasil.baris).toBe(barang);
    expect(hasil.ringkas).toEqual({ pas: barang.length, longgar: 0, tampilLonggar: false });
  });
  it("tidak ada yang cocok", () => {
    expect(saringCariStok(barang, "xyz", ambil)).toEqual({ baris: [], ringkas: { pas: 0, longgar: 0, tampilLonggar: false } });
  });
});
