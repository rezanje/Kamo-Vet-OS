import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const s = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: s.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(decodeURIComponent(url)); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/LocalTransactionDraft", () => ({ usePreservedAction: () => ({ save: vi.fn(), failure: "" }) }));
vi.mock("@/components/PostingRequestIdentity", () => ({ PostingRequestIdentity: () => <input type="hidden" name="request_key" value="k" /> }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));

import { ClinicRefundPanel, loadClinicRefundData, type ClinicRefundData } from "@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel";
import { buatRefundKlinik } from "@/app/(app)/klinik/pembayaran/[visitId]/refund-actions";

const visit = "10000000-0000-4000-8000-000000000001", invoice = "20000000-0000-4000-8000-000000000002";
const lines = [
  { id: "med", deskripsi: "Obat fiktif", qty: 2, harga: 100, jenis: "obat", item_id: "item", diskon_persen: 0, compound_recipe_id: null, satuan: "strip" },
  { id: "svc", deskripsi: "Tindakan fiktif", qty: 1, harga: 100, jenis: "jasa", item_id: null, diskon_persen: 0, compound_recipe_id: null, satuan: null },
];
const data: ClinicRefundData = { eligible: true, reason: null, requests: [{ id: "q", status: "pending", quoted_total: 206.67, method: "Transfer", requested_date: "2026-10-28", refund_no: null }],
  refunds: [{ id: "r", no_refund: "RJK.2026.10.00001", tanggal: "2026-10-28", total: 103.33, method: "Tunai", point_delta: -10, keterangan: null,
    clinic_refund_items: [{ invoice_item_id: "med", deskripsi: "Obat fiktif", qty: 1, amount: 103.33, kondisi: "baik", restock: true }] }] };

beforeEach(() => { s.rpc.mockReset(); });

it("J03: shows refund history, open transfer requests and the remaining qty per line", () => {
  const html = renderToStaticMarkup(<ClinicRefundPanel visitId={visit} invoice={{ id: invoice, subtotal: 300, total: 310 }} lines={lines} data={data} />);
  expect(html).toContain("RJK.2026.10.00001");
  expect(html).toContain("kembali ke stok");
  expect(html).toContain("Poin dikurangi 10");
  expect(html).toContain("Permintaan refund transfer belum selesai");
  expect(html).toContain("1 / 2");
  expect(html).toContain("Uang saja (jasa/tindakan/racikan)");
});

it("J03: explains why an invoice cannot be refunded instead of offering a form", () => {
  const html = renderToStaticMarkup(<ClinicRefundPanel visitId={visit} invoice={{ id: invoice, subtotal: 300, total: 310 }} lines={lines}
    data={{ ...data, eligible: false, reason: "Invoice belum lunas" }} />);
  expect(html).toContain("Invoice belum lunas");
  expect(html).not.toContain("Buat refund baru");
});

it("J03: hides the panel when the clinic refund database step is not applied yet", async () => {
  const q = { select: () => q, eq: () => q, order: async () => ({ data: null, error: { code: "PGRST205" } }) };
  await expect(loadClinicRefundData({ from: () => q, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, invoice)).resolves.toBeNull();
});

const form = () => { const f = new FormData(); f.set("visit_id", visit); f.set("invoice_id", invoice); f.set("request_key", "key-1");
  f.set("items", JSON.stringify([{ invoice_item_id: "30000000-0000-4000-8000-000000000003", qty: 1, kondisi: "baik" }])); f.set("tanggal", "2026-10-28"); return f; };

it("J03: refuses a refund without a payout method before any RPC", async () => {
  await expect(buatRefundKlinik(form())).rejects.toThrow(/Tunai atau Transfer/);
  expect(s.rpc).not.toHaveBeenCalled();
});

it("J03: posts one atomic RPC and confirms only a completed receipt", async () => {
  s.rpc.mockResolvedValue({ data: { refund_request_id: "40000000-0000-4000-8000-000000000004", status: "selesai", document_id: "50000000-0000-4000-8000-000000000005", document_no: "RJK.2026.10.00001" }, error: null });
  const f = form(); f.set("refund_method", "Tunai");
  await expect(buatRefundKlinik(f)).rejects.toThrow(/RJK.2026.10.00001 tercatat/);
  expect(s.rpc).toHaveBeenCalledWith("post_clinic_refund", expect.objectContaining({ p_invoice: invoice, p_request_key: "key-1",
    p_header: expect.objectContaining({ refund_method: "Tunai", destination: null }) }));
});

it("J03: an uncertain response never claims success", async () => {
  s.rpc.mockResolvedValue({ data: { refund_request_id: "40000000-0000-4000-8000-000000000004", status: "selesai" }, error: null });
  const f = form(); f.set("refund_method", "Tunai");
  await expect(buatRefundKlinik(f)).rejects.toThrow(/belum terkonfirmasi/);
});
