import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from }) }));
import { koreksiHargaFaktur } from "@/app/(app)/pembelian/faktur/[id]/koreksi/actions";

const expected = { remaining_qty: 30, sold_qty: 70, removed_qty: 0, ap_delta: 20000, ppn_delta: 0, inventory_delta: 6000, hpp_delta: 14000 };
const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ draft_key: "durable-key-1", draft_scope: "purchase-invoice-reprice:line", invoice_id: "inv", line_id: "line", revision: "0", qty: "100", harga: "1200", tanggal: "2026-10-28", alasan: "Harga pemasok naik", expected: JSON.stringify(expected), ...overrides })) data.set(key, value);
  return data;
};
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => { throw new Error("Nonatomic write attempted"); }); });

it("posts one atomic correction carrying the previewed impact and durable key", async () => {
  state.rpc.mockResolvedValue({ data: { correction_id: "c1", invoice_id: "inv", line_id: "line", no_jurnal: "JRN-202610-0001" }, error: null });
  await expect(koreksiHargaFaktur(form())).rejects.toThrow("REDIRECT:/pembelian/faktur/inv?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("correct_purchase_invoice_line", {
    p_request_key: "durable-key-1", p_line_id: "line", p_expected_revision: 0, p_qty: 100, p_harga: 1200,
    p_tanggal: "2026-10-28", p_reason: "Harga pemasok naik", p_expected: expected,
  });
  expect(state.from).not.toHaveBeenCalled();
  expect(state.revalidate).toHaveBeenCalledWith("/keuangan/hutang");
});

it("refuses without a complete preview and returns to the preview", async () => {
  await expect(koreksiHargaFaktur(form({ expected: "{}" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/inv/koreksi?baris=line&qty=100&harga=1200&tanggal=2026-10-28&error=");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("shows the database refusal on the preview page and never acknowledges a partial result", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Total faktur baru Rp 90.000 lebih kecil dari pembayaran" } });
  await expect(koreksiHargaFaktur(form())).rejects.toThrow("koreksi?baris=line");
  expect(state.revalidate).not.toHaveBeenCalled();
  state.rpc.mockResolvedValue({ data: { invoice_id: "inv" }, error: null });
  await expect(koreksiHargaFaktur(form())).rejects.toThrow("belum terkonfirmasi");
  expect(state.revalidate).not.toHaveBeenCalled();
});
