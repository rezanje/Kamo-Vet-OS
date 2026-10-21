import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { koreksiPembelianAset, previewKoreksiAset } from "@/app/(app)/keuangan/aset/[id]/correction-actions";

function form() {
  const f = new FormData();
  Object.entries({ id: "asset-id", revision: "0", tanggal: "2026-10-21", harga: "10000000", alasan: "Salah nominal",
    draft_key: "durable-asset-key", requestKey: "obsolete", draft_scope: "asset-correct:asset-id" }).forEach(([k,v]) => f.set(k,v));
  return f;
}
beforeEach(() => fixture.rpc.mockReset());
it("previews through the same server rules without acknowledging or committing", async () => {
  fixture.rpc.mockResolvedValue({ data: { allowed: false, blockers: ["Periode terkunci"] }, error: null });
  expect(await previewKoreksiAset(form())).toEqual({ allowed: false, blockers: ["Periode terkunci"] });
  expect(fixture.rpc.mock.calls[0][0]).toBe("preview_fixed_asset_correction");
});
it("retains the draft when a journal or audit result is missing", async () => {
  fixture.rpc.mockResolvedValue({ data: { asset_id: "asset-id", reversal_journal_id: "reversal" }, error: null });
  await expect(koreksiPembelianAset(form())).rejects.toThrow("?error=");
});
it("acknowledges only committed correction with both journals and audit", async () => {
  fixture.rpc.mockResolvedValue({ data: { asset_id: "asset-id", correction_id: "audit", reversal_journal_id: "reversal", replacement_journal_id: "replacement" }, error: null });
  await expect(koreksiPembelianAset(form())).rejects.toThrow("draft_done=durable-asset-key");
  expect(fixture.rpc).toHaveBeenCalledWith("correct_fixed_asset_purchase", expect.objectContaining({p_request_key:"durable-asset-key",p_expected_revision:0,p_harga:10000000}));
});
it("recovers a lost response using the persisted key without reposting", async () => {
  const f=form(); f.set("tindakan","periksa");
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(koreksiPembelianAset(f)).rejects.toThrow("?error=");
  expect(fixture.rpc).toHaveBeenCalledWith("get_fixed_asset_correction_result", { p_asset_id:"asset-id",p_request_key:"durable-asset-key" });
});
it("does not acknowledge rejected access or stale data", async () => {
  fixture.rpc.mockResolvedValue({data:null,error:{message:"Aset sudah berubah"}});
  await expect(koreksiPembelianAset(form())).rejects.toThrow("?error=Aset%20sudah%20berubah");
});
