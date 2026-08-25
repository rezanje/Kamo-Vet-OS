import { describe, it, expect } from "vitest";
import {
  digitNpwp, npwpSah, formatNpwp, ringkasMasa, periksaKesiapan, berkasCsv, namaBerkas,
  type BarisPajak,
} from "../faktur-pajak";

const b = (p: Partial<BarisPajak>): BarisPajak => ({
  nomor: "FJ.2026.08.00001", tanggal: "2026-08-05", pihak: "PT Contoh",
  npwp: "012345678901000", alamat: "Jl. Contoh 1", noFakturPajak: null,
  dpp: 1_000_000, ppn: 110_000, ...p,
});

describe("NPWP", () => {
  it("dibandingkan dari angkanya saja", () => {
    expect(digitNpwp("01.234.567.8-901.000")).toBe("012345678901000");
  });

  it("15 dan 16 digit dianggap sah, panjang lain tidak", () => {
    expect(npwpSah("01.234.567.8-901.000")).toBe(true);
    expect(npwpSah("0123456789012345")).toBe(true);
    expect(npwpSah("12345")).toBe(false);
    expect(npwpSah(null)).toBe(false);
    expect(npwpSah("")).toBe(false);
  });

  it("15 digit dirapikan, 16 digit ditulis apa adanya", () => {
    expect(formatNpwp("012345678901000")).toBe("01.234.567.8-901.000");
    expect(formatNpwp("0123456789012345")).toBe("0123456789012345");
  });
});

describe("ringkasMasa", () => {
  it("netto = PPN keluaran dikurangi PPN masukan", () => {
    const r = ringkasMasa("2026-08", [b({ ppn: 110_000 })], [b({ ppn: 40_000 })]);
    expect(r.netto).toBe(70_000);
    expect(r.keluaranPpn).toBe(110_000);
    expect(r.masukanPpn).toBe(40_000);
  });

  it("masukan lebih besar = lebih bayar (negatif)", () => {
    expect(ringkasMasa("2026-08", [], [b({ ppn: 40_000 })]).netto).toBe(-40_000);
  });

  it("masa kosong tetap menghasilkan angka nol, bukan NaN", () => {
    expect(ringkasMasa("2026-08", [], [])).toMatchObject({ keluaranPpn: 0, masukanPpn: 0, netto: 0 });
  });
});

describe("periksaKesiapan", () => {
  const lengkap = {
    npwpPerusahaan: "012345678901000", namaPerusahaan: "PT Kamo Group",
    keluaran: [b({})], masukan: [b({ noFakturPajak: "010.000-26.00000001" })],
  };

  it("data lengkap = tidak ada masalah", () => {
    expect(periksaKesiapan(lengkap)).toEqual([]);
  });

  it("NPWP perusahaan kosong disebut", () => {
    const m = periksaKesiapan({ ...lengkap, npwpPerusahaan: null });
    expect(m.some((x) => x.hal === "npwp-perusahaan")).toBe(true);
  });

  it("nama perusahaan kosong disebut", () => {
    expect(periksaKesiapan({ ...lengkap, namaPerusahaan: "   " })
      .some((x) => x.hal === "nama-perusahaan")).toBe(true);
  });

  it("faktur keluaran tanpa NPWP pembeli dihitung, bukan cuma disebut ada", () => {
    const m = periksaKesiapan({ ...lengkap, keluaran: [b({ npwp: null }), b({ npwp: "" }), b({})] });
    expect(m.find((x) => x.hal === "npwp-pelanggan")?.jumlah).toBe(2);
  });

  it("faktur masukan tanpa nomor faktur pajak pemasok disebut — PPN-nya tidak bisa dikreditkan", () => {
    const m = periksaKesiapan({ ...lengkap, masukan: [b({ noFakturPajak: null })] });
    expect(m.find((x) => x.hal === "no-faktur-pemasok")?.pesan).toMatch(/dikreditkan/);
  });
});

describe("berkasCsv", () => {
  it("judul kolom + satu baris per faktur, keluaran dulu baru masukan", () => {
    const csv = berkasCsv([b({ nomor: "OUT-1" })], [b({ nomor: "IN-1", noFakturPajak: "010.001" })]);
    const baris = csv.split("\n");
    expect(baris[0]).toMatch(/^jenis,no_dokumen,tanggal/);
    expect(baris[1]).toMatch(/^Keluaran,OUT-1/);
    expect(baris[2]).toMatch(/^Masukan,IN-1/);
  });

  it("nama yang mengandung koma dikutip supaya kolomnya tidak bergeser", () => {
    const csv = berkasCsv([b({ pihak: "PT Aneka, Jaya" })], []);
    expect(csv).toContain('"PT Aneka, Jaya"');
  });

  it("tanda kutip di dalam nama digandakan", () => {
    expect(berkasCsv([b({ pihak: 'PT "Bintang"' })], [])).toContain('"PT ""Bintang"""');
  });

  it("angka dibulatkan ke rupiah penuh", () => {
    expect(berkasCsv([b({ dpp: 1_000_000.4, ppn: 110_000.6 })], [])).toContain("1000000,110001");
  });

  it("NPWP ikut dirapikan di berkasnya", () => {
    expect(berkasCsv([b({ npwp: "012345678901000" })], [])).toContain("01.234.567.8-901.000");
  });

  it("masa kosong tetap punya baris judul", () => {
    expect(berkasCsv([], []).split("\n")).toHaveLength(1);
  });
});

describe("namaBerkas", () => {
  it("memuat masanya", () => {
    expect(namaBerkas("2026-08")).toBe("pajak-2026-08.csv");
  });
});
