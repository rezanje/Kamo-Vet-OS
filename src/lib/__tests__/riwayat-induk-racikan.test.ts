import { expect, it } from "vitest";
import {
  adalahIndukRacikan, hrefRiwayatIndukRacikan, parseRiwayatRacikanBaris, readRiwayatIndukRacikan,
  ringkasRiwayat, tautanBaris,
} from "@/lib/riwayat-induk-racikan";

const masuk = (n: number, total: number, extra: Record<string, unknown> = {}) => ({
  id: `masuk:r${n}`, arah: "masuk", waktu: `2026-10-10T0${n % 10}:00:00+00:00`, tanggal: "2026-10-10", qty: 1, satuan: "pcs",
  nomor_racikan: `R/2026/1010/${n}`, recipe_id: `r${n}`, nama_racikan: "Puyer", status_racikan: "handed_over",
  sumber: "Racikan bebas dari rekam medis", visit_id: "visit", pasien: "Pasien", pelanggan: "Pemilik", cabang: "Klinik A",
  invoice_id: null, nomor_invoice: null, invoice_batal: null, bisa_dibuka: true, total_baris: total, ...extra,
});
const keluar = (total: number, extra: Record<string, unknown> = {}) => ({
  ...masuk(1, total), id: "keluar:line", arah: "keluar", qty: "1", satuan: "racikan",
  invoice_id: "inv", nomor_invoice: "INV.2026.10.00001", invoice_batal: false, ...extra,
});

function client(pages: (offset: number, limit: number) => { data: unknown; error: unknown }) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return pages(args.p_offset as number, args.p_limit as number);
    },
  };
}

it("maps RPC rows (numeric strings included) and calls the read-only history RPC", async () => {
  const db = client(() => ({ data: [masuk(1, 2), keluar(2)], error: null }));
  const rows = await readRiwayatIndukRacikan(db, "sku", "2026-10-01", "2026-10-31");
  expect(db.calls).toEqual([{ name: "read_compound_parent_history", p_item_id: "sku", p_dari: "2026-10-01", p_sampai: "2026-10-31", p_offset: 0, p_limit: 500 }]);
  expect(rows.map((r) => [r.id, r.arah, r.qty])).toEqual([["masuk:r1", "masuk", 1], ["keluar:line", "keluar", 1]]);
  expect(rows[1]).toMatchObject({ invoiceId: "inv", nomorInvoice: "INV.2026.10.00001", invoiceBatal: false, nomorRacikan: "R/2026/1010/1" });
  expect(rows[0]).not.toHaveProperty("total");
});

it("reads every page and verifies the count like the stock card", async () => {
  const all = Array.from({ length: 1203 }, (_, i) => masuk(i, 1203));
  const db = client((offset, limit) => ({ data: all.slice(offset, offset + limit), error: null }));
  const rows = await readRiwayatIndukRacikan(db, "sku", "2026-10-01", "2026-10-31");
  expect(rows).toHaveLength(1203);
  expect(db.calls.map((c) => c.p_offset)).toEqual([0, 500, 1000]);
});

it("fails closed when the data changes between pages or a page comes back short", async () => {
  const changed = client((offset) => ({ data: offset === 0 ? Array.from({ length: 500 }, (_, i) => masuk(i, 600)) : [masuk(900, 601)], error: null }));
  await expect(readRiwayatIndukRacikan(changed, "sku", "2026-10-01", "2026-10-31")).rejects.toThrow("data berubah");
  const short = client((offset) => ({ data: offset === 0 ? Array.from({ length: 500 }, (_, i) => masuk(i, 600)) : [], error: null }));
  await expect(readRiwayatIndukRacikan(short, "sku", "2026-10-01", "2026-10-31")).rejects.toThrow("Riwayat racikan");
  const mixed = client(() => ({ data: [masuk(1, 2), keluar(3)], error: null }));
  await expect(readRiwayatIndukRacikan(mixed, "sku", "2026-10-01", "2026-10-31")).rejects.toThrow("belum dapat dimuat lengkap");
});

it("shows an explicit message on denial and on read errors, never an empty history", async () => {
  const denied = client(() => ({ data: null, error: { code: "42501", message: "Akses riwayat racikan ditolak" } }));
  await expect(readRiwayatIndukRacikan(denied, "sku", "2026-10-01", "2026-10-31")).rejects.toThrow("tidak punya akses");
  const broken = client(() => ({ data: null, error: { code: "PGRST", message: "down" } }));
  await expect(readRiwayatIndukRacikan(broken, "sku", "2026-10-01", "2026-10-31")).rejects.toThrow("belum dapat dimuat lengkap");
  const empty = client(() => ({ data: [], error: null }));
  await expect(readRiwayatIndukRacikan(empty, "sku", "2026-10-01", "2026-10-31")).resolves.toEqual([]);
});

it("rejects malformed rows and rows that leak links or names without branch access", () => {
  expect(() => parseRiwayatRacikanBaris({ ...masuk(1, 1), arah: "lain" })).toThrow("tidak valid");
  expect(() => parseRiwayatRacikanBaris({ ...masuk(1, 1), qty: "x" })).toThrow("tidak valid");
  expect(() => parseRiwayatRacikanBaris({ ...keluar(1), invoice_id: null, nomor_invoice: null })).toThrow("tidak valid");
  expect(() => parseRiwayatRacikanBaris({ ...masuk(1, 1), bisa_dibuka: false })).toThrow("tidak valid");
  const tertutup = parseRiwayatRacikanBaris({ ...keluar(1), bisa_dibuka: false, recipe_id: null, visit_id: null, invoice_id: null, pasien: null, pelanggan: null, nama_racikan: null });
  expect(tertutup.nomorInvoice).toBe("INV.2026.10.00001");
  expect(tautanBaris(tertutup)).toEqual({ racikan: null, kunjungan: null, invoice: null });
});

it("links own-branch rows to the racikan, the visit and the invoice", () => {
  const row = parseRiwayatRacikanBaris(keluar(1));
  expect(tautanBaris(row)).toEqual({
    racikan: "/klinik/racik/r1", kunjungan: "/klinik/rekam-medis/visit",
    invoice: "/klinik/pembayaran/visit/invoice?invoice_id=inv",
  });
  expect(hrefRiwayatIndukRacikan("sku")).toBe("/pos/sku/sku/riwayat-racikan");
  expect(hrefRiwayatIndukRacikan("a b", { dari: "2026-10-01" })).toBe("/pos/sku/a%20b/riwayat-racikan?dari=2026-10-01");
});

it("counts made and sold racikan, leaving void racikan and cancelled invoices out", () => {
  const rows = [masuk(1, 4), masuk(2, 4, { status_racikan: "void" }), keluar(4), keluar(4, { id: "keluar:x", invoice_batal: true })]
    .map(parseRiwayatRacikanBaris);
  expect(ringkasRiwayat(rows)).toEqual({ dibuat: 1, ditagih: 1, racikanVoid: 1, invoiceBatal: 1 });
});

it("recognises racikan parent SKUs with the database rule", () => {
  const cats = [{ id: "c1", name: " obat  racikan " }, { id: "c2", name: "Pakan" }];
  expect(adalahIndukRacikan({ name: "Obat Racik Puyer", item_type: "Persediaan", category_id: null }, cats)).toBe(true);
  expect(adalahIndukRacikan({ name: "Puyer Batuk", item_type: "Persediaan", category_id: "c1" }, cats)).toBe(true);
  expect(adalahIndukRacikan({ name: "Pakan Kucing", item_type: "Persediaan", category_id: "c2" }, cats)).toBe(false);
  expect(adalahIndukRacikan({ name: "Obat Racik Jasa", item_type: "Jasa", category_id: null }, cats)).toBe(false);
});
