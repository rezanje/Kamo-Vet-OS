import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-21" }));
import { activateAverage, closeInventoryMonth } from "@/app/(app)/keuangan/closing-hpp/actions";
beforeEach(() => vi.clearAllMocks());
const form = (month: string) => { const data = new FormData(); data.set("month", month); return data; };
it("posts a completed month as its first day and refreshes current reports", async () => {
  state.rpc.mockResolvedValue({ data: { close_id: "c" }, error: null });
  await expect(closeInventoryMonth(form("2026-09"))).rejects.toThrow("?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("close_inventory_month", { p_month: "2026-09-01" });
  expect(state.revalidate).toHaveBeenCalledWith("/keuangan/closing-hpp");
});
it.each(["2026-10", "2026-11", "2026-13", "", "2026-02-30"])("rejects invalid or incomplete month %s before writing", async month => {
  await expect(closeInventoryMonth(form(month))).rejects.toThrow("?error=");
  expect(state.rpc).not.toHaveBeenCalled();
});
it.each(["Scope ditolak", "Nilai persediaan belum cocok dengan GL 1301 per cabang; selesaikan rekonsiliasi", "Ada transaksi yang masih berjalan; muat ulang status lalu coba lagi"])("surfaces activation failure without announcing success: %s", async message => {
  state.rpc.mockResolvedValue({ data: null, error: { message } });
  await expect(activateAverage()).rejects.toThrow(`?error=${encodeURIComponent(message)}`);
  expect(state.revalidate).not.toHaveBeenCalled();
});
