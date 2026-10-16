import { expect, it } from "vitest";
import { saleMerchandiseTotal, saleRefundMerchantFee, salePaymentRows, salePaymentDescription } from "../sale-payment-reporting";

it("keeps merchandise bases and cumulative refunded fee exact to cents", () => {
  const sale = { total: 101600.01, merchant_fee_total: 1600.01 };
  expect(saleMerchandiseTotal(sale)).toBe(100000);
  expect(saleMerchandiseTotal({ total: 123.45 })).toBe(123.45);
  expect(saleRefundMerchantFee(sale, 50800)).toBe(800);
  expect(saleRefundMerchantFee(sale, 101600.01)).toBe(1600.01);
  expect(saleRefundMerchantFee({ total: 0 }, 0)).toBe(0);
  expect(saleRefundMerchantFee({ total: 123.45 }, 123.45)).toBe(0);
});

it("retains gross bank and cash receipts and excludes pending sale allocations", () => {
  const sale = { total: 101600.01, merchant_fee_total: 1600.01, metode_bayar: "Split",
    payment_plan: [], payments_finalized_at: "2026-10-16T05:00:00Z",
    sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600.01, fee_percent: 2, fee_amount: 1600.01 }] };
  expect(salePaymentRows([sale, { ...sale, payments_finalized_at: null }])).toEqual([
    { metode_bayar: "Tunai", total: 20000 }, { metode_bayar: "Debit", total: 81600.01 },
  ]);
  expect(salePaymentDescription(sale)).toBe("Tunai Rp 20.000 + Debit Rp 81.600,01");
});
