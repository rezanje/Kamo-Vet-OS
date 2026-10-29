// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], rpcError: null as null | { code: string; message: string },
  item: { id: "sku", code: "RCK-1", name: "Obat Racik Puyer", unit: "pcs" } as Record<string, unknown> | null,
  calls: [] as Record<string, unknown>[],
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-29" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, ...args });
    if (fixture.rpcError) return { data: null, error: fixture.rpcError };
    return { data: fixture.rows.slice(args.p_offset as number, (args.p_offset as number) + (args.p_limit as number)), error: null };
  },
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: fixture.item, error: null }) };
    return query;
  },
}) }));
import Page from "@/app/(app)/pos/sku/[id]/riwayat-racikan/page";

const base = { qty: 1, satuan: "pcs", status_racikan: "handed_over", sumber: "Resep resmi: Puyer Batuk v2", cabang: "Klinik A", invoice_batal: null, total_baris: 4 };
beforeEach(() => {
  fixture.calls = []; fixture.rpcError = null;
  fixture.item = { id: "sku", code: "RCK-1", name: "Obat Racik Puyer", unit: "pcs" };
  fixture.rows = [
    { ...base, id: "masuk:r1", arah: "masuk", waktu: "2026-10-10T03:00:00Z", tanggal: "2026-10-10", nomor_racikan: "R/2026/1010/AAA", recipe_id: "r1",
      nama_racikan: "Puyer batuk", visit_id: "v1", pasien: "Milo", pelanggan: "Bu Ani", invoice_id: null, nomor_invoice: null, bisa_dibuka: true },
    { ...base, id: "keluar:l1", arah: "keluar", waktu: "2026-10-10T05:00:00Z", tanggal: "2026-10-10", satuan: "racikan", nomor_racikan: "R/2026/1010/AAA", recipe_id: "r1",
      nama_racikan: "Puyer batuk", visit_id: "v1", pasien: "Milo", pelanggan: "Bu Ani", invoice_id: "i1", nomor_invoice: "INV.2026.10.00001", invoice_batal: false, bisa_dibuka: true },
    { ...base, id: "masuk:r2", arah: "masuk", waktu: "2026-10-11T03:00:00Z", tanggal: "2026-10-11", nomor_racikan: "R/2026/1011/BBB", recipe_id: null,
      nama_racikan: null, visit_id: null, pasien: null, pelanggan: null, cabang: "Klinik B", invoice_id: null, nomor_invoice: null, bisa_dibuka: false },
    { ...base, id: "keluar:l2", arah: "keluar", waktu: "2026-10-11T05:00:00Z", tanggal: "2026-10-11", satuan: "racikan", nomor_racikan: "R/2026/1011/BBB", recipe_id: null,
      nama_racikan: null, visit_id: null, pasien: null, pelanggan: null, cabang: "Klinik B", invoice_id: null, nomor_invoice: "INV.2026.10.00002", invoice_batal: true, bisa_dibuka: false },
  ];
});
async function render(sp: Record<string, string> = {}) {
  document.body.innerHTML = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "sku" }), searchParams: Promise.resolve(sp) }));
  return document;
}

it("lists racikan made (Masuk) and sold (Keluar) for the parent SKU with links, without prices or stock", async () => {
  const doc = await render();
  expect(fixture.calls[0]).toMatchObject({ name: "read_compound_parent_history", p_item_id: "sku", p_dari: "2026-10-01", p_sampai: "2026-10-29", p_offset: 0 });
  expect(doc.querySelector('a[href="/klinik/racik/r1"]')?.textContent).toBe("R/2026/1010/AAA");
  expect(doc.querySelector('a[href="/klinik/rekam-medis/v1"]')?.textContent).toBe("Milo · Bu Ani");
  expect(doc.querySelector('a[href="/klinik/pembayaran/v1/invoice?invoice_id=i1"]')?.textContent).toBe("INV.2026.10.00001");
  expect(doc.body.textContent).toContain("Resep resmi: Puyer Batuk v2");
  expect(doc.body.textContent).toContain("Racikan dibuat2");
  expect(doc.body.textContent).toContain("Racikan ditagih1");
  expect(doc.body.textContent).toContain("Invoice dibatalkan (tidak dihitung)1");
  expect(doc.body.textContent).not.toMatch(/Rp|harga|Saldo/i);
  expect(doc.querySelector('a[href*="kartu-stok"]')).toBeNull();
});

it("shows other-branch numbers without links or patient names", async () => {
  const doc = await render();
  const rows = [...doc.querySelectorAll("tbody tr")];
  const other = rows.filter((tr) => tr.textContent?.includes("R/2026/1011/BBB"));
  expect(other).toHaveLength(2);
  for (const tr of other) {
    expect(tr.querySelector("a")).toBeNull();
    expect(tr.textContent).toContain("Cabang lain");
  }
  expect(other[1].textContent).toContain("INV.2026.10.00002");
  expect(other[1].textContent).toContain("Dibatalkan");
});

it("passes the chosen date range and refuses a reversed range without reading", async () => {
  await render({ dari: "2026-09-01", sampai: "2026-09-30" });
  expect(fixture.calls[0]).toMatchObject({ p_dari: "2026-09-01", p_sampai: "2026-09-30" });
  fixture.calls = [];
  const doc = await render({ dari: "2026-10-30", sampai: "2026-10-01" });
  expect(fixture.calls).toHaveLength(0);
  expect(doc.querySelector('[role="alert"]')?.textContent).toContain("tidak boleh setelah");
});

it("shows an explicit error instead of an empty history when the read fails or is denied", async () => {
  fixture.rpcError = { code: "42501", message: "Akses riwayat racikan ditolak" };
  let doc = await render();
  expect(doc.querySelector('[role="alert"]')?.textContent).toContain("tidak punya akses");
  expect(doc.body.textContent).not.toContain("Tidak ada racikan");
  fixture.rpcError = { code: "XX000", message: "down" };
  doc = await render();
  expect(doc.querySelector('[role="alert"]')?.textContent).toContain("belum dapat dimuat lengkap");
});

it("returns not found for an unknown SKU", async () => {
  fixture.item = null;
  await expect(render()).rejects.toThrow("NOT_FOUND");
});
