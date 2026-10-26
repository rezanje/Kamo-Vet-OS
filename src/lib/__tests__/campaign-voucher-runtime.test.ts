import { describe, expect, it } from "vitest";
import { campaignVoucherPreview, resolveCampaignVoucher } from "../campaign-voucher-runtime";
import type { VoucherRow } from "../voucher";

const source: VoucherRow = {
  code: "SOURCEV", tipe: "nominal", nilai: 10000, is_active: true,
  valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0,
  boleh_gabung_promo: true,
};

describe("campaign voucher checkout", () => {
  it("previews the existing voucher calculation under the alias while submitting the alias", async () => {
    const db = { rpc: () => ({ range: async () => ({
      data: [{ code: "ALIASV", voucher_code: "SOURCEV" }], count: 1, error: null,
    }) }) };
    const vouchers = await campaignVoucherPreview(db, [source]);
    expect(vouchers.find(v => v.code === "ALIASV")).toMatchObject({
      nilai: 10000, tipe: "nominal", campaign_alias: true,
    });
    expect(vouchers.find(v => v.code === "SOURCEV")?.campaign_alias).toBeUndefined();
  });

  it("resolves only a selected alias to the canonical cap key", async () => {
    const db = { rpc: async () => ({ data: [{ code: "ALIASV", voucher_code: "SOURCEV" }], error: null }) };
    expect(await resolveCampaignVoucher(db, " alias v ")).toEqual({ voucherCode: "SOURCEV", campaignCode: "ALIASV" });
    expect(await resolveCampaignVoucher(db, "")).toEqual({ voucherCode: null, campaignCode: null });
  });

  it("preserves legacy codes and refuses unselected campaign modes", async () => {
    const legacy = { rpc: async () => ({ data: [], error: null }) };
    expect(await resolveCampaignVoucher(legacy, "LEGACY")).toEqual({ voucherCode: "LEGACY", campaignCode: null });
    const blocked = { rpc: async () => ({ data: null, error: { message: "CAMPAIGN_MODE_NOT_AVAILABLE" } }) };
    await expect(resolveCampaignVoucher(blocked, "PRODUCT")).rejects.toThrow("belum tersedia");
  });
});
