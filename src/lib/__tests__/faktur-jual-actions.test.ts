import { beforeEach, expect, it, vi } from "vitest";

const { rpc, redirect } = vi.hoisted(() => ({
  rpc: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(url); }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { hapusPenerimaanJual, pratinjauFakturJual, simpanFakturJual } from "@/app/(app)/penjualan/faktur/[id]/line-actions";

const INVOICE = "invoice-1";
const RECEIPT = "receipt-1";
const hapusForm = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    invoice_id: INVOICE, receipt_id: RECEIPT, revision: "3", draft_key: "kunci-hapus",
    draft_scope: `sales-receipt-cancel:${RECEIPT}:3`, alasan: "  Salah input nominal  ", tindakan: "hapus",
  })) data.set(key, value);
  return data;
};
const editForm = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    invoice_id: INVOICE, revision: "2", request_key: "kunci-edit-panjang", tanggal: "2026-10-28",
    jatuh_tempo: "2026-11-27", catatan: "revisi", alasan: "Salah ketik qty",
    items: JSON.stringify([{ id: "l1", qty: 8, harga: 300000, diskon: 0 }]),
    expected: JSON.stringify({ new_total: 2400000 }),
  })) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { cancellation_id: "audit", reversal_journal_id: "jurnal", receipt_id: RECEIPT, invoice_id: INVOICE, advance_restored: 0 }, error: null });
});

it("membalik penerimaan lewat RPC atomik dengan alasan yang sudah dirapikan", async () => {
  await expect(hapusPenerimaanJual(hapusForm())).rejects.toThrow("success=");
  expect(rpc).toHaveBeenCalledWith("cancel_wholesale_receipt", {
    p_receipt_id: RECEIPT, p_expected_revision: 3, p_request_key: "kunci-hapus", p_reason: "Salah input nominal",
  });
  expect(redirect.mock.calls[0][0]).toContain("draft_done=kunci-hapus");
});

it("tidak pernah menghapus baris jurnal: hanya satu panggilan pembalik", async () => {
  await expect(hapusPenerimaanJual(hapusForm())).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls.every(([name]) => name !== "from")).toBe(true);
});

it("memeriksa hasil terakhir tanpa membalik ulang", async () => {
  const data = hapusForm();
  data.set("tindakan", "periksa");
  await expect(hapusPenerimaanJual(data)).rejects.toThrow("success=");
  expect(rpc).toHaveBeenCalledWith("get_wholesale_operation", { p_invoice_id: INVOICE, p_kind: "receipt-cancel", p_request_key: "kunci-hapus" });
});

it("memberi tahu kalau pemeriksaan tidak menemukan penghapusan terkonfirmasi", async () => {
  const data = hapusForm();
  data.set("tindakan", "periksa");
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(hapusPenerimaanJual(data)).rejects.toThrow("error=");
  expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});

it("meneruskan penolakan database apa adanya tanpa mengaku berhasil", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Penerimaan sudah direkonsiliasi bank; tinjau rekonsiliasi dahulu" } });
  await expect(hapusPenerimaanJual(hapusForm())).rejects.toThrow(encodeURIComponent("direkonsiliasi bank"));
  expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});

it.each([
  { cancellation_id: "audit", reversal_journal_id: "jurnal", receipt_id: "lain", invoice_id: INVOICE },
  { cancellation_id: "audit", receipt_id: RECEIPT, invoice_id: INVOICE },
])("menolak hasil yang tidak lengkap atau bukan milik penerimaan ini", async (data) => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(hapusPenerimaanJual(hapusForm())).rejects.toThrow(/belum terkonfirmasi/);
});

it("pratinjau edit memakai RPC pratinjau, bukan jalur simpan", async () => {
  rpc.mockResolvedValue({ data: { new_total: 2400000 }, error: null });
  const hasil = await pratinjauFakturJual({ invoiceId: INVOICE, tanggal: "2026-10-28", jatuhTempo: "2026-11-27", catatan: "", items: [{ id: "l1", qty: 8, harga: 300000, diskon: 0 }] });
  expect(hasil).toEqual({ ok: true, preview: { new_total: 2400000 } });
  expect(rpc).toHaveBeenCalledWith("preview_wholesale_invoice_lines", expect.objectContaining({ p_invoice_id: INVOICE }));
});

it("simpan edit mengirim seluruh baris, revisi, dan hasil pratinjau sebagai pembanding", async () => {
  rpc.mockResolvedValue({ data: { invoice_id: INVOICE, replacement_id: "invoice-2" }, error: null });
  const hasil = await simpanFakturJual(editForm());
  expect(hasil).toEqual({ ok: true, replacementId: "invoice-2" });
  expect(rpc).toHaveBeenCalledWith("correct_wholesale_invoice_lines", expect.objectContaining({
    p_invoice_id: INVOICE, p_expected_revision: 2, p_items: [{ id: "l1", qty: 8, harga: 300000, diskon: 0 }],
    p_expected: { new_total: 2400000 }, p_reason: "Salah ketik qty",
  }));
});

it("simpan edit mengembalikan pesan gagal ke pop-up, bukan melempar", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Faktur ini sudah punya penerimaan. Hapus penerimaan dulu" } });
  await expect(simpanFakturJual(editForm())).resolves.toEqual({ ok: false, error: "Faktur ini sudah punya penerimaan. Hapus penerimaan dulu" });
});
