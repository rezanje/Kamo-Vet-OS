import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { correctReturn } from "@/app/(app)/penjualan/retur/corrections";
import { revalidatePath } from "next/cache";

const id = "fc000000-0000-4000-8000-000000000001";
function form(kind = "sales") {
  const data = new FormData();
  Object.entries({ kind, id, revision: "0", requestKey: "stable-key", reason: "Jumlah salah", physical_evidence: "Bukti terima tiga barang TEST-3", physical_checked: "yes", items: "[]", branch_id: "forged", created_by: "forged" }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => { vi.clearAllMocks(); fixture.rpc.mockResolvedValue({ data: { return_id: id, audit_id: "audit" }, error: null }); });

it.each(["sales", "purchase"])("corrects %s only through the atomic reasoned RPC", async kind => {
  await expect(correctReturn(form(kind))).rejects.toThrow(`/${kind === "sales" ? "penjualan" : "pembelian"}/retur/${id}?success=1`);
  expect(fixture.rpc).toHaveBeenCalledWith("correct_return_record", {
    p_kind: kind, p_return_id: id, p_expected_revision: 0, p_request_key: "stable-key",
    p_reason: "Jumlah salah", p_physical_evidence: "Bukti terima tiga barang TEST-3", p_items: [],
  });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it.each(["physical_checked", "physical_evidence", "reason", "requestKey"])("rejects absent %s before mutation", async field => {
  const data = form(); data.delete(field);
  await expect(correctReturn(data)).rejects.toThrow(/error=/);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("retains the key and input when a dependency rejects the correction", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Stok memiliki mutasi lanjutan" } });
  await expect(correctReturn(form())).rejects.toThrow(encodeURIComponent("Stok memiliki mutasi lanjutan"));
  expect(revalidatePath).not.toHaveBeenCalled();
});
it("does not acknowledge an uncertain response", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(correctReturn(form())).rejects.toThrow(encodeURIComponent("Hasil koreksi belum terkonfirmasi"));
});
