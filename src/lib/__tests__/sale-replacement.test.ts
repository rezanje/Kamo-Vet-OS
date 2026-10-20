import { expect, it, vi } from "vitest";
import { loadSaleReplacement, saleReplacementDraft } from "../sale-replacement";
import type { SupabaseClient } from "@supabase/supabase-js";

function client(role = "OWNER", active = true) {
  const source = { id: "sale", branch_id: "branch", channel: null, customer_id: "customer", sale_items: [{ item_id: "item", qty: 2, faktor: 6 }] };
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), not: vi.fn(() => query), single: vi.fn(async () => ({ data: source })) };
  const from = vi.fn((table: string) => table === "profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, is_active: active } }) }) }) } : query);
  const db = { auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from } as unknown as SupabaseClient;
  return { db, from, query, source };
}
it.each([["STAFF", true], ["OWNER", false]])("denies replacement preparation by %s active=%s", async (role, active) => {
 const { db, from } = client(role as string, active as boolean);
 await expect(loadSaleReplacement(db, "sale")).rejects.toThrow("Super Admin aktif");
 expect(from).not.toHaveBeenCalledWith("sales");
});
it("loads only cancelled source history under the user session and preserves units/customer", async () => {
 const { db, query, source } = client();
 await expect(loadSaleReplacement(db, "sale")).resolves.toEqual(source);
 expect(query.not).toHaveBeenCalledWith("voided_at", "is", null);expect(query.eq).toHaveBeenCalledWith("id", "sale");
});
it("rejects missing or inaccessible cancellation without creating replacement", async () => {
 const { db, query } = client(); query.single.mockResolvedValue({ data: null } as never);
 await expect(loadSaleReplacement(db, "sale")).rejects.toThrow("tidak dapat dibaca");
});

it.each(["redeemed-points", "item-discount", "manual-discount"])("never turns original %s into an extra replacement discount", benefit => {
 const source={id:"sale",no_struk:"original",branch_id:"branch",channel:null,customer_id:"customer",salesperson_id:"seller",buyer_name:null,external_ref:null,
  discount:30000,poin_digunakan:benefit==="redeemed-points"?30000:0,voucher_code:"OLD",sale_items:[{
   item_id:"item",nama:"Original item",qty:2,harga:50000,satuan:"box",faktor:6,
   item_discount_type:benefit==="item-discount"?"nominal":null,item_discount_value:benefit==="item-discount"?15000:0,promo_discount:5000,
  }]};
 const draft=saleReplacementDraft(source);
 expect(draft).toMatchObject({customerId:"customer",salespersonId:"seller",diskon:0,poin:0,voucher:"",bayar:0});
 expect(draft.cart[0]).toMatchObject({item_id:"item",qty:2,satuan:"box",faktor:6});
 expect(draft.cart[0]).not.toHaveProperty("item_discount_type");
 expect(draft.cart[0]).not.toHaveProperty("item_discount_value");
 expect(draft.cart[0]).not.toHaveProperty("promo_discount");
});
