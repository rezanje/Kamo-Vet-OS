import { describe, it, expect } from "vitest";
import {
  FORMAT_BAWAAN, bangunPrefix, contohNomor, periksaPola, periksaDigit,
} from "../no-dokumen";

describe("bangunPrefix", () => {
  it("mengisi token tahun dan bulan", () => {
    expect(bangunPrefix("FB.{YYYY}.{MM}.", "2026-08-25")).toBe("FB.2026.08.");
  });
  it("mengisi token harian", () => {
    expect(bangunPrefix("POS-{YYYY}{MM}{DD}-", "2026-08-02")).toBe("POS-20260802-");
  });
  it("dua digit tahun", () => {
    expect(bangunPrefix("KM/{YY}/{MM}/", "2026-01-09")).toBe("KM/26/01/");
  });
  it("pola tanpa token dipakai apa adanya", () => {
    expect(bangunPrefix("OPO.", "2026-08-25")).toBe("OPO.");
  });
});

describe("contohNomor", () => {
  it("memperlihatkan bentuk jadinya dengan urutan pertama", () => {
    expect(contohNomor("FB.{YYYY}.{MM}.", 5, "2026-08-25")).toBe("FB.2026.08.00001");
    expect(contohNomor("POS-{YYYY}{MM}{DD}-", 4, "2026-08-02")).toBe("POS-20260802-0001");
  });
});

describe("periksaPola", () => {
  it("menolak kosong, spasi, dan token asing", () => {
    expect(periksaPola("")).toMatch(/kosong/);
    expect(periksaPola("FB {YYYY}.")).toMatch(/spasi/);
    expect(periksaPola("FB.{BULAN}.")).toMatch(/tidak dikenal/);
  });
  it("menolak % dan _ karena dipakai pencarian nomor", () => {
    expect(periksaPola("FB%")).toMatch(/%/);
    expect(periksaPola("FB_")).toMatch(/%/);
  });
  it("meloloskan pola yang sah", () => {
    expect(periksaPola("FB.{YYYY}.{MM}.")).toBeNull();
    expect(periksaPola("OPO.")).toBeNull();
  });
});

describe("periksaDigit", () => {
  it("hanya 1 sampai 8", () => {
    expect(periksaDigit(0)).toMatch(/1 sampai 8/);
    expect(periksaDigit(9)).toMatch(/1 sampai 8/);
    expect(periksaDigit(2.5)).toMatch(/1 sampai 8/);
    expect(periksaDigit(5)).toBeNull();
  });
});

describe("FORMAT_BAWAAN", () => {
  it("semua bawaan sah dan jenisnya unik", () => {
    const jenis = FORMAT_BAWAAN.map((f) => f.jenis);
    expect(new Set(jenis).size).toBe(jenis.length);
    for (const f of FORMAT_BAWAAN) {
      expect(periksaPola(f.pola), f.jenis).toBeNull();
      expect(periksaDigit(f.digit), f.jenis).toBeNull();
    }
  });

  it("bawaan menghasilkan nomor yang bentuknya sama dengan sebelum fitur ini ada", () => {
    const per = (j: string) => FORMAT_BAWAAN.find((f) => f.jenis === j)!;
    const t = "2026-08-04";
    expect(contohNomor(per("FB").pola, per("FB").digit, t)).toBe("FB.2026.08.00001");
    expect(contohNomor(per("PO").pola, per("PO").digit, t)).toBe("PO-20260804-0001");
    expect(contohNomor(per("POS").pola, per("POS").digit, t)).toBe("POS-20260804-0001");
    expect(contohNomor(per("ONL").pola, per("ONL").digit, t)).toBe("ONL-20260804-0001");
    expect(contohNomor(per("INV").pola, per("INV").digit, t)).toBe("INV-202608-0001");
    expect(contohNomor(per("TRM").pola, per("TRM").digit, t)).toBe("TRM-260804-001");
    expect(contohNomor(per("OPO").pola, per("OPO").digit, t)).toBe("OPO.00001");
    expect(contohNomor(per("FJK").pola, per("FJK").digit, t)).toBe("FJK.2026.08.00001");
  });
});
