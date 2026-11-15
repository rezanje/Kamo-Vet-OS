import { describe, expect, it, vi } from "vitest";
import { FULL_PURCHASE_CANCEL, NO_PURCHASE_CANCEL, isActiveOwner, loadPurchaseCancelAccess } from "../purchase-cancel-access";

const client = (result: { data: unknown; error: unknown } | "throw") => ({
  rpc: vi.fn(() => (result === "throw" ? (() => { throw new Error("jaringan") })() : Promise.resolve(result))),
});

describe("akses batal pembelian", () => {
  it("OWNER aktif selalu penuh dan tidak membaca kebijakan (gagal-terbuka)", async () => {
    const c = client("throw");
    expect(await loadPurchaseCancelAccess(c, { role: "OWNER", is_active: true })).toEqual(FULL_PURCHASE_CANCEL);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("OWNER nonaktif atau profil kosong tidak mendapat akses", async () => {
    expect(isActiveOwner({ role: "OWNER", is_active: false })).toBe(false);
    expect(await loadPurchaseCancelAccess(client({ data: null, error: null }), { role: "OWNER", is_active: false })).toEqual(NO_PURCHASE_CANCEL);
    expect(await loadPurchaseCancelAccess(client({ data: null, error: null }), null)).toEqual(NO_PURCHASE_CANCEL);
  });
  it("peran lain hanya sesuai izin eksplisit dari database", async () => {
    const c = client({ data: { batalkan_penerimaan: true, batalkan_faktur: false, batalkan_pembayaran: true, batalkan_uang_muka: "ya" }, error: null });
    expect(await loadPurchaseCancelAccess(c, { role: "ADMIN", is_active: true })).toEqual({ penerimaan: true, faktur: false, pembayaran: true, uangMuka: false });
  });
  it.each([
    ["galat RPC", { data: null, error: { message: "x" } }],
    ["bukan objek", { data: [true], error: null }],
    ["kosong", { data: null, error: null }],
    ["melempar", "throw" as const],
  ])("peran lain gagal-tertutup saat %s", async (_n, result) => {
    expect(await loadPurchaseCancelAccess(client(result as never), { role: "ADMIN", is_active: true })).toEqual(NO_PURCHASE_CANCEL);
  });
});
