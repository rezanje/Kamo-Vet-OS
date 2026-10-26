import { describe, expect, it } from "vitest";
import { campaignBindingReadiness, parseCampaignBinding } from "../campaign-binding";

const target = "fa100000-0000-4000-8000-000000000001";
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("C05 campaign binding configuration", () => {
  it("saves a normalized transaction voucher alias with the existing calculation chosen", () => {
    expect(parseCampaignBinding(form({ code: "hemat 10", binding_type: "transaction_voucher", target_id: target, calculation_mode: "existing_voucher" })))
      .toEqual({ code: "HEMAT10", bindingType: "transaction_voucher", targetId: target, calculationMode: "existing_voucher" });
  });
  it("allows a product promo relation without a monetary decision and warns it cannot redeem", () => {
    const draft = parseCampaignBinding(form({ code: "PRODUK10", binding_type: "product_promo", target_id: target, calculation_mode: "" }));
    expect(draft.calculationMode).toBeNull();
    expect(campaignBindingReadiness(draft.calculationMode)).toMatch(/tidak dapat diredeem/);
  });
  it("rejects mismatched calculation, invalid target and truncated code", () => {
    expect(() => parseCampaignBinding(form({ code: "PRODUK10", binding_type: "product_promo", target_id: target, calculation_mode: "existing_voucher" }))).toThrow(/tidak cocok/);
    expect(() => parseCampaignBinding(form({ code: "PRODUK10", binding_type: "product_promo", target_id: "fake", calculation_mode: "" }))).toThrow(/sumber/);
    expect(() => parseCampaignBinding(form({ code: "A".repeat(25), binding_type: "product_promo", target_id: target, calculation_mode: "" }))).toThrow(/1–24/);
  });
});
