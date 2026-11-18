import { describe, expect, it } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";
import { bacaItemRekapKlinik } from "./data";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JUMLAH = 230;
const invoices = Array.from({ length: JUMLAH }, (_, i) => ({ id: id(i + 1), voided_at: null, created_at: "2026-11-10T03:00:00Z", visits: { branch_id: i % 2 ? "cab-b" : "cab-a" } }));
const baris = invoices.flatMap((inv, i) => [
  { id: id(1000 + i * 2), invoice_id: inv.id, qty: 2, harga: 10000, jenis: "jasa", item_id: id(9001) },
  { id: id(1001 + i * 2), invoice_id: inv.id, qty: 1.5, harga: 20000, jenis: "obat", item_id: i % 5 === 0 ? null : id(9002) },
]);
const master = [
  { id: id(9001), tindakan_kategori: "Grooming", item_type: "Jasa" },
  { id: id(9002), tindakan_kategori: null, item_type: "Barang" },
];

describe("Rekap Klinik - baris layanan", () => {
  it("baris, urutan id item, isi item master, dan cabang sama dengan data; query dibatasi", async () => {
    const t = bikinKlienTiruan({ invoices, invoice_items: baris, items: master });
    const { data } = await bacaItemRekapKlinik(t.client, "2026-11-01T00:00:00+07:00", "2026-11-30T23:59:59+07:00", "");
    expect(data).toHaveLength(JUMLAH * 2);
    expect(data[0]).toEqual({ qty: 2, harga: 10000, jenis: "jasa", items: { tindakan_kategori: "Grooming", item_type: "Jasa" }, invoices: { visits: { branch_id: "cab-a" } } });
    expect(data[1]).toEqual({ qty: 1.5, harga: 20000, jenis: "obat", items: null, invoices: { visits: { branch_id: "cab-a" } } });
    expect(data[3].items).toEqual({ tindakan_kategori: null, item_type: "Barang" });
    expect(data.reduce((a, r) => a + r.qty * r.harga, 0)).toBe(JUMLAH * (20000 + 30000));
    expect(t.catatan.filter(c => c.table === "invoices")).toHaveLength(1);
    expect(t.catatan.filter(c => c.table === "invoice_items")).toHaveLength(Math.ceil(JUMLAH / 100));
    expect(t.catatan.filter(c => c.table === "items")).toHaveLength(1);
    expect(t.catatan.some(c => c.select.includes("!inner") && c.table === "invoice_items")).toBe(false);
  });

  it("saringan cabang ikut ke query invoice", async () => {
    const t = bikinKlienTiruan({ invoices, invoice_items: baris, items: master });
    await bacaItemRekapKlinik(t.client, "a", "b", "cab-b");
    expect(t.catatan.find(c => c.table === "invoices")?.filters).toContain("visits.branch_id=cab-b");
  });
});
