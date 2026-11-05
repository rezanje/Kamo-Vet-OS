import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/useClinicDraft", () => ({ useClinicDraft: ({ requestKey }: { requestKey: string }) => ({ submissionKey: requestKey, submit: vi.fn(), capture: vi.fn(), attachForm: vi.fn(), discard: vi.fn(), recovered: false, storageError: "", saveError: "" }) }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("../../app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/metode-bayar", async () => await import("../metode-bayar"));
vi.mock("@/lib/promo-hitung", async () => await import("../promo-hitung"));
vi.mock("@/lib/harga-golongan", async () => await import("../harga-golongan"));
vi.mock("@/lib/voucher", async () => await import("../voucher"));
vi.mock("@/lib/tagihan-klinik", () => ({ hargaNetto: (r: { harga: number }) => r.harga, nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
import { ItemTable } from "../../app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { parsePriceFloorRows } from "../price-floor-message";

const PESAN = [
  "Penjualan ditolak. Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Ada 2 baris yang ditolak; semuanya tercantum di bawah.",
  "- Infus Refill: harga neto Rp20.000 per PCS, HPP Rp29.578 per PCS, harga minimum Rp29.578 per PCS",
  "- Obat Racik Probiotik (racikan): harga neto Rp50.000 per racikan, HPP Rp50.151 per racikan, harga minimum Rp50.151 per racikan",
  "Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa.",
].join("\n");
const lantai = parsePriceFloorRows(PESAN);
const rows = [
  { key: "a", deskripsi: "Icare Can Recovery", qty: 1, harga: 45000, item_id: "i1", satuan: "PCS", prescription_item_id: "p1" },
  { key: "b", deskripsi: "Infus Refill", qty: 1, harga: 20000, item_id: "i2", satuan: "PCS", prescription_item_id: "p2" },
  { key: "c", deskripsi: "Obat Racik Probiotik", qty: 1, harga: 50000, item_id: null, satuan: "racikan", prescription_item_id: "p3", recipe_id: "rec-1", terkunci: true, harga_awal: 50000 },
];
const props = { title: "OBAT", icon: "ti-pill", color: "#000", setRows: () => {}, master: [], listId: "t", allowUnits: true, discountsDisabled: true };
const html = (extra: Partial<React.ComponentProps<typeof ItemTable>> = {}, data = rows) =>
  renderToStaticMarkup(<ItemTable {...props} rows={data} {...extra} />);
/** The full opening tag of the input carrying this aria-label (attribute order differs between inputs). */
const input = (markup: string, label: string) => (markup.match(/<input[^>]*>/g) ?? []).find(tag => tag.includes(`aria-label="${label}"`)) ?? "";

describe("F4: rows named by the price-floor error are highlighted with their minimum price", () => {
  it("marks exactly the offending rows (red border + 'Harga minimum Rp X' under the price)", () => {
    const out = html({ lantaiHarga: lantai });
    expect(out.match(/data-harga-di-bawah-hpp="true"/g)).toHaveLength(2);
    expect(out).toContain("Harga minimum Rp 29.578");
    expect(out).toContain("Harga minimum Rp 50.151");
    expect(out.match(/data-harga-minimum/g)).toHaveLength(2);
    expect(out).toMatch(/aria-invalid="true"/);
  });
  it("shows nothing without an error, and releases a row once its price reaches the minimum", () => {
    expect(html()).not.toContain("data-harga-di-bawah-hpp");
    expect(html({ lantaiHarga: lantai })).toContain("Harga minimum Rp 29.578");
    const fixed = html({ lantaiHarga: lantai }, rows.map(row => row.key === "b" ? { ...row, harga: 29578 } : row));
    expect(fixed).not.toContain("Harga minimum Rp 29.578");
    expect(fixed.match(/data-harga-di-bawah-hpp="true"/g)).toHaveLength(1);
  });
  it("does not mark a different row that merely contains the name", () => {
    const out = html({ lantaiHarga: lantai }, [{ key: "x", deskripsi: "Infus Refill Besar", qty: 1, harga: 10, item_id: "i9", satuan: "PCS" }]);
    expect(out).not.toContain("data-harga-di-bawah-hpp");
  });
  it("marks a package card named in the error", () => {
    const paket = parsePriceFloorRows("- Paket Steril (paket): harga neto Rp800 untuk seluruh paket, total HPP komponen Rp1.000, harga minimum paket Rp1.000");
    const out = renderToStaticMarkup(<ItemTable {...props} lantaiHarga={paket}
      rows={[{ key: "k1", deskripsi: "Obat komp", qty: 1, harga: 0, item_id: "i1", satuan: "PCS", package_item_id: "pk", package_qty: 1 }]}
      packages={[{ id: "pk", name: "Paket Steril", componentIds: ["i1"] }]} />);
    expect(out).toContain("Harga minimum paket Rp 1.000");
    expect(out).toContain("data-harga-di-bawah-hpp=\"true\"");
  });
});

describe("F6: the locked racikan price points at the real correction path (not 'koreksi melalui diskon')", () => {
  it("tooltip names /klinik/racik/<id>, a 'Koreksi racikan' link is shown, the price stays read-only for non-owners", () => {
    const out = html();
    expect(out).not.toContain("koreksi melalui diskon");
    expect(out).toContain("/klinik/racik/rec-1");
    expect(out).toContain("Koreksi racikan");
    expect(out).toMatch(/title="Harga racikan tersimpan dikunci\. Untuk koreksi bahan buka \/klinik\/racik\/rec-1/);
    expect(out).toMatch(/<input[^>]*value="50000"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*value="50000"/);
  });
});

describe("F7: owner-only racikan price input", () => {
  it("is editable for the owner, labelled 'Harga racikan (Owner)', and asks for a reason only after a change", () => {
    const unchanged = html({ racikanHargaOwner: true });
    expect(unchanged).toContain("Harga racikan (Owner)");
    expect(unchanged).not.toContain("Alasan ubah harga");
    expect(input(unchanged, "Harga racikan (Owner) Obat Racik Probiotik")).not.toBe("");
    expect(input(unchanged, "Harga racikan (Owner) Obat Racik Probiotik")).not.toMatch(/readOnly/i);
    const changed = html({ racikanHargaOwner: true }, rows.map(row => row.recipe_id ? { ...row, harga: 50500 } : row));
    expect(changed).toContain("Alasan ubah harga");
  });
  it("never unlocks qty (stays locked) and non-owners get no reason field", () => {
    const out = html({ racikanHargaOwner: true });
    expect(input(out, "Jumlah Obat Racik Probiotik")).toMatch(/readOnly/i);
    expect(html({}, rows.map(row => row.recipe_id ? { ...row, harga: 50500 } : row))).not.toContain("Alasan ubah harga");
  });
});
