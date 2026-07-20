import { describe, expect, it } from "vitest";
import { bolehBayar, butuhConsent, kategoriBerisiko, kategoriWajibConsent } from "../tindakan";

const jasa = (kategori: string | null) => ({ jenis: "jasa", kategori });

describe("kategoriWajibConsent", () => {
  it("flags the risky categories", () => {
    expect(kategoriWajibConsent("Operasi")).toBe(true);
    expect(kategoriWajibConsent("Rawat Inap")).toBe(true);
    expect(kategoriWajibConsent("Vaksinasi")).toBe(true);
    expect(kategoriWajibConsent("Lab")).toBe(true);
  });
  it("leaves routine categories alone", () => {
    expect(kategoriWajibConsent("Konsultasi")).toBe(false);
    expect(kategoriWajibConsent("Grooming")).toBe(false);
  });
  it("treats missing category as not risky", () => {
    expect(kategoriWajibConsent(null)).toBe(false);
    expect(kategoriWajibConsent(undefined)).toBe(false);
    expect(kategoriWajibConsent("")).toBe(false);
  });
});

describe("kategoriBerisiko", () => {
  it("lists each risky category once", () => {
    expect(kategoriBerisiko([jasa("Operasi"), jasa("Operasi"), jasa("Lab")]).sort())
      .toEqual(["Lab", "Operasi"]);
  });

  it("ignores obat rows even when they carry a category", () => {
    expect(kategoriBerisiko([{ jenis: "obat", kategori: "Operasi" }])).toEqual([]);
  });

  // Data lama (sebelum kolom kategori ada) tidak boleh mendadak memblokir pembayaran.
  it("ignores uncategorised rows", () => {
    expect(kategoriBerisiko([jasa(null), jasa("Konsultasi")])).toEqual([]);
  });

  it("counts an inpatient record even though it is not a jasa row", () => {
    expect(kategoriBerisiko([], true)).toEqual(["Rawat Inap"]);
  });
});

describe("butuhConsent", () => {
  it("is false for a routine visit", () => {
    expect(butuhConsent([jasa("Konsultasi"), jasa("Grooming")])).toBe(false);
  });
  it("is true once any risky tindakan is present", () => {
    expect(butuhConsent([jasa("Konsultasi"), jasa("Vaksinasi")])).toBe(true);
  });
});

describe("bolehBayar", () => {
  it("allows payment when nothing risky happened", () => {
    expect(bolehBayar([jasa("Grooming")], false, [])).toBe(true);
  });

  it("blocks payment when a risky tindakan has no signed consent", () => {
    expect(bolehBayar([jasa("Operasi")], false, [])).toBe(false);
    expect(bolehBayar([jasa("Operasi")], false, [{ status: "belum_ttd" }])).toBe(false);
  });

  it("allows payment once the consent is signed", () => {
    expect(bolehBayar([jasa("Operasi")], false, [{ status: "sudah_ttd" }])).toBe(true);
  });

  it("blocks an inpatient visit with no signed consent", () => {
    expect(bolehBayar([], true, [{ status: "belum_ttd" }])).toBe(false);
  });
});
