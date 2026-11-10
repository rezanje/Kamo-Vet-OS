import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RiwayatObat, susunRiwayatObat } from "./riwayat-obat";

const row = (o: Partial<Parameters<typeof susunRiwayatObat>[0][number]>) => ({
  id: "x", created_at: "2026-11-02T03:00:00Z", jenis: "obat", nama_obat: "AB", qty: 1, satuan: "TAB", aturan_pakai: null,
  bmhp_components: null, compounding_recipes: null, ...o,
});

describe("Riwayat obat rawat inap", () => {
  const rows = susunRiwayatObat([
    row({ id: "1", nama_obat: "Antibiotik" }),
    row({ id: "2", nama_obat: "Biaya Admin", jenis: "jasa" }),
    row({ id: "3", nama_obat: "Racik Recovery", created_at: "2026-11-05T03:00:00Z", compounding_recipes: { status: "ready", compounding_ingredients: [{ ingredient_name: "Curcuma", quantity: 2, unit: "TAB" }] } }),
    row({ id: "4", nama_obat: "Infus", jenis: "jasa", created_at: "2026-11-05T03:00:00Z", bmhp_components: [{ name: "Infus Nacl", qty: 1, unit: "BTL" }] }),
    row({ id: "5", nama_obat: "Racik Batal", compounding_recipes: [{ status: "void", compounding_ingredients: [] }] }),
  ]);

  it("ambil obat, racikan, dan baris ber-BMHP; jasa biasa tidak ikut", () => {
    expect(rows.map((r) => r.id)).toEqual(["1", "3", "4", "5"]);
    expect(rows[1]).toMatchObject({ racikan: true, bahan: [{ nama: "Curcuma", qty: 2, satuan: "TAB" }] });
    expect(rows[2].bmhp).toEqual([{ nama: "Infus Nacl", qty: 1, satuan: "BTL" }]);
    expect(rows[3].batal).toBe(true);
  });

  it("isi racikan/BMHP dijabarkan, tanpa tautan atau tombol", () => {
    const out = renderToStaticMarkup(<RiwayatObat rows={rows} />);
    expect(out).toContain("Isi: Curcuma 2 TAB");
    expect(out).toContain("BMHP: Infus Nacl 1 BTL");
    expect(out).toContain("2/11/26");
    expect(out).not.toMatch(/<a |<button|<form|<input/);
  });

  it("gagal baca beda dengan kosong", () => {
    expect(renderToStaticMarkup(<RiwayatObat rows={null} />)).toContain("tidak terbaca");
    expect(renderToStaticMarkup(<RiwayatObat rows={[]} />)).toContain("Belum ada obat");
  });
});
