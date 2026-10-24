import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { koreksiMetodePembayaran } from "@/app/(app)/penjualan/[id]/actions";
import { revalidatePath } from "next/cache";

const id = "e8700000-0000-4000-8000-000000000001";
function form() {
  const data = new FormData();
  Object.entries({ id, revision: "2", requestKey: "stable-key", alasan: "Kasir salah pilih metode", tunai: "20000.50", transfer: "79999.50" })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => { vi.clearAllMocks(); fixture.rpc.mockResolvedValue({ data: { sale_id: id, revision: 3, audit_id: "audit" }, error: null }); });

it("corrects the same sale with the durable key and exact decimal amounts", async () => {
  await expect(koreksiMetodePembayaran(form())).rejects.toThrow(`/penjualan/${id}?success=payment-corrected`);
  expect(fixture.rpc).toHaveBeenCalledWith("correct_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: 2, p_request_key: "stable-key", p_reason: "Kasir salah pilih metode",
    p_cash_amount: 20000.5, p_transfer_amount: 79999.5,
  });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it.each(["", "-1", "1.001", "NaN", "Infinity", "1e5", "1000000000001"])("rejects invalid money %s before RPC", async value => {
  const data = form(); data.set("tunai", value);
  await expect(koreksiMetodePembayaran(data)).rejects.toThrow(/tidak valid/);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("does not acknowledge an uncertain response or change the retry key", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(koreksiMetodePembayaran(form())).rejects.toThrow(/belum terkonfirmasi/);
  expect(revalidatePath).not.toHaveBeenCalled();
});
