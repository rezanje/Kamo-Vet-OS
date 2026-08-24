import { describe, it, expect } from "vitest";
import { rekap, perCabang, perHari, perKanal, type Trx } from "../laporan-transaksi";

const t = (p: Partial<Trx>): Trx => ({
  tanggal: "2026-08-20", cabang: "DC LOJI", customerId: null,
  omzet: 100_000, item: 2, kanal: "POS", ...p,
});

describe("rekap", () => {
  it("pelanggan berkartu dihitung sekali walau belanja berkali-kali", () => {
    const r = rekap([
      t({ customerId: "a" }), t({ customerId: "a" }), t({ customerId: "b" }),
    ]);
    expect(r.trx).toBe(3);
    expect(r.pelangganTerdaftar).toBe(2);
    expect(r.rataTrxPerPelanggan).toBeCloseTo(1.5);
  });

  it("struk tanpa identitas dianggap satu orang per struk", () => {
    const r = rekap([t({}), t({}), t({ customerId: "a" })]);
    expect(r.trxTanpaAkun).toBe(2);
    expect(r.pelangganDilayani).toBe(3);
  });

  it("struk umum tidak ikut menurunkan rata-rata kunjungan pelanggan berkartu", () => {
    const r = rekap([t({}), t({}), t({ customerId: "a" }), t({ customerId: "a" })]);
    expect(r.rataTrxPerPelanggan).toBe(2);
  });

  it("rata-rata item dan rata-rata belanja per struk", () => {
    const r = rekap([t({ item: 1, omzet: 50_000 }), t({ item: 4, omzet: 150_000 })]);
    expect(r.rataItemPerTrx).toBeCloseTo(2.5);
    expect(r.rataPerTrx).toBe(100_000);
  });

  it("tanpa transaksi tidak membagi dengan nol", () => {
    const r = rekap([]);
    expect(r.rataPerTrx).toBe(0);
    expect(r.rataItemPerTrx).toBe(0);
    expect(r.rataTrxPerPelanggan).toBe(0);
    expect(r.pelangganDilayani).toBe(0);
  });
});

describe("perCabang", () => {
  const list = [
    t({ cabang: "DC LOJI", omzet: 300_000, customerId: "a" }),
    t({ cabang: "TKI", omzet: 100_000, customerId: "a" }),
    t({ cabang: "TKI", omzet: 100_000, customerId: "b" }),
  ];

  it("cabang omzet terbesar di atas", () => {
    expect(perCabang(list).map((r) => r.cabang)).toEqual(["DC LOJI", "TKI"]);
  });

  it("pelanggan yang belanja di dua cabang dihitung di masing-masing cabang", () => {
    const tki = perCabang(list).find((r) => r.cabang === "TKI")!;
    expect(tki.trx).toBe(2);
    expect(tki.pelangganTerdaftar).toBe(2);
  });
});

describe("perHari", () => {
  it("hari terbaru di atas dan pelanggan unik per hari", () => {
    const h = perHari([
      t({ tanggal: "2026-08-19", customerId: "a" }),
      t({ tanggal: "2026-08-20", customerId: "a" }),
      t({ tanggal: "2026-08-20", customerId: "a" }),
      t({ tanggal: "2026-08-20", customerId: "b" }),
    ]);
    expect(h.map((r) => r.tanggal)).toEqual(["2026-08-20", "2026-08-19"]);
    expect(h[0].trx).toBe(3);
    expect(h[0].pelangganDilayani).toBe(2);
  });
});

describe("perKanal", () => {
  it("menghitung tiap pintu transaksi, termasuk yang nol", () => {
    expect(perKanal([t({ kanal: "POS" }), t({ kanal: "Klinik" }), t({ kanal: "Klinik" })]))
      .toEqual({ POS: 1, Online: 0, Klinik: 2 });
  });
});
