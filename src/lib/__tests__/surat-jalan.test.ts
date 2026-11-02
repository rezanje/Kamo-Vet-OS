import { describe, expect, it } from "vitest";
import { bisaCetakSuratJalan, susunSuratJalan } from "@/lib/surat-jalan";

const item = (id: string, over: Partial<{ qty_diminta: number | null; qty_disetujui: number | null; qty_dikirim: number | string | null }>) => ({
  id, nama: `Barang ${id}`, satuan: "pcs", qty_diminta: 10, qty_disetujui: null, qty_dikirim: null, ...over,
});

describe("surat jalan permintaan barang", () => {
  it("hanya bisa dicetak setelah barang benar-benar keluar dari gudang", () => {
    expect(bisaCetakSuratJalan("Dikirim")).toBe(true);
    expect(bisaCetakSuratJalan("Selesai")).toBe(true);
    for (const s of ["Menunggu Persetujuan", "Disetujui", "Ditolak", null, undefined]) expect(bisaCetakSuratJalan(s)).toBe(false);
  });

  it("memakai jumlah yang dikirim, bukan yang diminta", () => {
    const { baris } = susunSuratJalan([item("a", { qty_diminta: 500, qty_disetujui: 300, qty_dikirim: "250" })]);
    expect(baris).toEqual([{ id: "a", nama: "Barang a", satuan: "pcs", qty: 250 }]);
  });

  it("barang yang tidak ikut dikirim tidak dicetak sebagai baris, tapi disebut", () => {
    const r = susunSuratJalan([item("a", { qty_dikirim: 4 }), item("b", { qty_disetujui: 5, qty_dikirim: 0 })]);
    expect(r.baris.map((b) => b.id)).toEqual(["a"]);
    expect(r.tidakDikirim).toEqual(["Barang b"]);
  });

  it("kiriman lama tanpa catatan jumlah kirim jatuh ke disetujui lalu diminta", () => {
    const r = susunSuratJalan([item("a", { qty_disetujui: 7 }), item("b", { qty_diminta: 3 })]);
    expect(r.baris.map((b) => b.qty)).toEqual([7, 3]);
  });
});
