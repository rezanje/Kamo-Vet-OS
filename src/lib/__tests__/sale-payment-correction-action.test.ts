import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { koreksiMetodePembayaran } from "@/app/(app)/penjualan/[id]/actions";
import { revalidatePath } from "next/cache";

const id = "e8700000-0000-4000-8000-000000000001";
// Form shows one box per correctable method; a blank box means "not paid that way".
function form(boxes: Record<string, string> = { Tunai: "20000.50", Transfer: "", Debit: "", Kredit: "", QRIS: "79999.50", "E-Wallet": "" }) {
  const data = new FormData();
  Object.entries({ id, revision: "2", requestKey: "stable-key", alasan: "Kasir salah pilih metode" }).forEach(([key, value]) => data.set(key, value));
  Object.entries(boxes).forEach(([method, value]) => data.set(`bayar_${method}`, value));
  return data;
}
beforeEach(() => { vi.clearAllMocks(); fixture.rpc.mockResolvedValue({ data: { sale_id: id, revision: 3, audit_id: "audit" }, error: null }); });

it("sends every filled method with exact decimal amounts and the durable key", async () => {
  await expect(koreksiMetodePembayaran(form())).rejects.toThrow(`/penjualan/${id}?success=payment-corrected`);
  expect(fixture.rpc).toHaveBeenCalledWith("correct_pos_sale_payment_methods", {
    p_sale_id: id, p_expected_revision: 2, p_request_key: "stable-key", p_reason: "Kasir salah pilih metode",
    p_payments: [{ method: "Tunai", amount: 20000.5 }, { method: "QRIS", amount: 79999.5 }],
  });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it("moves a whole cash bill to Debit", async () => {
  await expect(koreksiMetodePembayaran(form({ Tunai: " ", Debit: "100000", QRIS: "" }))).rejects.toThrow("payment-corrected");
  expect(fixture.rpc).toHaveBeenCalledWith("correct_pos_sale_payment_methods",
    expect.objectContaining({ p_payments: [{ method: "Debit", amount: 100000 }] }));
});
it("ignores methods without a box (fee-bearing parts stay fixed server-side)", async () => {
  await expect(koreksiMetodePembayaran(form({ Tunai: "45000" }))).rejects.toThrow("payment-corrected");
  expect(fixture.rpc).toHaveBeenCalledWith("correct_pos_sale_payment_methods",
    expect.objectContaining({ p_payments: [{ method: "Tunai", amount: 45000 }] }));
});
it.each(["-1", "1.001", "NaN", "Infinity", "1e5", "1000000000001"])("rejects invalid money %s before RPC", async value => {
  await expect(koreksiMetodePembayaran(form({ Tunai: value, QRIS: "1" }))).rejects.toThrow(/tidak valid/);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("rejects an all-empty allocation before RPC", async () => {
  await expect(koreksiMetodePembayaran(form({ Tunai: "", QRIS: "0" }))).rejects.toThrow(/minimal satu metode/);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("does not acknowledge an uncertain response or change the retry key", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(koreksiMetodePembayaran(form())).rejects.toThrow(/belum terkonfirmasi/);
  expect(revalidatePath).not.toHaveBeenCalled();
});
it("shows the database reason when the correction is refused", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Metode yang memakai fee merchant tidak bisa dipakai lagi" } });
  await expect(koreksiMetodePembayaran(form())).rejects.toThrow(/fee merchant/);
});
