import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[], replies: {} as Record<string, { data: unknown; error: unknown }>, revalidated: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { s.calls.push({ name, args }); return s.replies[name] ?? { data: null, error: { code: "P0001", message: "unexpected" } }; },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { s.revalidated.push(path); } }));
import { simpanBayar } from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions";

const floor = { code: "P0001", message: "PRICE_BELOW_HPP: Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Naikkan harga atau kurangi diskon." };
const draftOk = { data: { status: "DRAFT_SAVED", visit_id: "visit", record_id: "stay", snapshot: "new" }, error: null };
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ recordId: "stay", visitId: "visit", requestKey: "req-1", parts: "[]", pending_snapshot: "snap", pending_rows: '[{"id":"a","qty":1,"harga":10}]', cart_reason: "Alasan Fiktif", ...extra })) f.set(k, v);
  return f;
};
beforeEach(() => { s.calls = []; s.replies = {}; s.revalidated = []; });

it("rejected money step (database SQLSTATE) -> the SAME snapshot/rows/reason are saved as a draft and the cashier still sees the rejection", async () => {
  s.replies = { clinic_save_inpatient_cashier: { data: null, error: floor }, clinic_save_inpatient_cart_draft: draftOk };
  const result = await simpanBayar(form());
  expect(s.calls.map(c => c.name)).toEqual(["clinic_save_inpatient_cashier", "clinic_save_inpatient_cart_draft"]);
  expect(s.calls[1].args).toEqual({ p_record_id: "stay", p_visit_id: "visit", p_request_key: "req-1", p_snapshot: "snap", p_rows: [{ id: "a", qty: 1, harga: 10 }], p_reason: "Alasan Fiktif" });
  expect(result).toMatchObject({ status: "DRAFT_SAVED", message: expect.stringContaining("Infus Refill") });
  const href = (result as { href: string }).href;
  expect(href.startsWith("/klinik/pembayaran/visit?error=")).toBe(true);
  expect(decodeURIComponent(href)).toContain("Infus Refill"); expect(decodeURIComponent(href)).toContain("sudah disimpan sebagai draft");
  expect(s.revalidated).toContain("/klinik/pembayaran/visit");
});
it("success path is untouched: one RPC, no draft call", async () => {
  s.replies = { clinic_save_inpatient_cashier: { data: { status: "SAVED", visit_id: "visit", record_id: "stay", invoice_id: "inv" }, error: null } };
  const result = await simpanBayar(form());
  expect(s.calls.map(c => c.name)).toEqual(["clinic_save_inpatient_cashier"]);
  expect(result).toMatchObject({ status: "SAVED" });
});
it("rejection AND draft refused (e.g. CART_STALE): the original message is shown, nothing claimed as saved", async () => {
  s.replies = { clinic_save_inpatient_cashier: { data: null, error: { code: "P0001", message: "CART_STALE: muat ulang" } }, clinic_save_inpatient_cart_draft: { data: null, error: { code: "P0001", message: "CART_STALE: muat ulang" } } };
  const result = await simpanBayar(form());
  expect(result.status).toBe("ERROR");
  expect(JSON.stringify(result)).not.toContain("draft");
});
it.each([["gateway timeout", { code: "504", message: "Gateway timeout" }], ["PostgREST code", { code: "PGRST202", message: "function not found" }], ["no code", { message: "network" }]])(
  "uncertain transport failure (%s): no second write is attempted", async (_label, error) => {
    s.replies = { clinic_save_inpatient_cashier: { data: null, error } };
    const result = await simpanBayar(form());
    expect(s.calls.map(c => c.name)).toEqual(["clinic_save_inpatient_cashier"]);
    expect(result.status).toBe("ERROR");
  });
it("OVERPAYMENT_CONFIRM_REQUIRED keeps the cart in the browser: no draft write, confirmation returned", async () => {
  s.replies = { clinic_save_inpatient_cashier: { data: { status: "OVERPAYMENT_CONFIRM_REQUIRED", quote: { token: "t", excess: 5 } }, error: null } };
  const result = await simpanBayar(form());
  expect(s.calls.map(c => c.name)).toEqual(["clinic_save_inpatient_cashier"]);
  expect(result.status).toBe("OVERPAYMENT_CONFIRM_REQUIRED");
});
it("draft_only calls ONLY the draft RPC (never the money engine) and lands on the draft notice", async () => {
  s.replies = { clinic_save_inpatient_cart_draft: draftOk };
  const result = await simpanBayar(form({ draft_only: "1", parts: '[{"method":"Tunai","amount":5000}]' }));
  expect(s.calls.map(c => c.name)).toEqual(["clinic_save_inpatient_cart_draft"]);
  expect(result).toEqual({ status: "DRAFT_SAVED", href: "/klinik/pembayaran/visit?success=draft" });
});
it("draft_only refused by the database -> parsed error, nothing claimed; malformed draft reply -> uncertain message", async () => {
  s.replies = { clinic_save_inpatient_cart_draft: { data: null, error: { code: "P0001", message: "COMPOUND_LOCKED: gunakan pengembalian/koreksi racikan asli" } } };
  expect(await simpanBayar(form({ draft_only: "1" }))).toMatchObject({ status: "ERROR", error: expect.stringContaining("Racikan") });
  s.replies = { clinic_save_inpatient_cart_draft: { data: { status: "DRAFT_SAVED", visit_id: "OTHER", record_id: "stay" }, error: null } };
  expect(await simpanBayar(form({ draft_only: "1" }))).toMatchObject({ status: "ERROR", error: expect.stringContaining("belum dapat dipastikan") });
});
it("a form without a cashier cart (plain DP admission style) never uses the draft RPC", async () => {
  s.replies = { clinic_bill_and_pay_inpatient: { data: null, error: floor } };
  const f = new FormData(); for (const [k, v] of Object.entries({ recordId: "stay", visitId: "visit", requestKey: "req-1", parts: "[]", draft_only: "1" })) f.set(k, v);
  const result = await simpanBayar(f);
  expect(s.calls.map(c => c.name)).toEqual(["clinic_bill_and_pay_inpatient"]);
  expect(result.status).toBe("ERROR");
});
