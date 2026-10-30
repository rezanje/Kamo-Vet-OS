import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rpc: vi.fn(), user: true, period: null as string | null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => s.period }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user ? { id: "user" } : null } }) }, rpc: s.rpc }) }));
import { simpanBayar } from "../actions";
const form = () => { const f = new FormData(); f.set("recordId", "record"); f.set("visitId", "visit"); f.set("requestKey", "key"); f.set("parts", JSON.stringify([{ method: "Tunai", amount: 100000 }])); return f; };
beforeEach(() => { s.rpc.mockReset(); s.user = true; s.period = null; });
it("exactly one monetary RPC with trusted IDs not client invoice/price/COA", async () => {
  s.rpc.mockResolvedValue({ data: { status: "SAVED", receipt_id: "receipt", invoice_id: "invoice", record_id: "record", visit_id: "visit" }, error: null });
  await expect(simpanBayar(form())).resolves.toEqual({ status: "SAVED", href: "/klinik/rawat-inap/record/tagihan?success=transaksi&receipt=receipt&invoice=invoice" });
  expect(s.rpc).toHaveBeenCalledTimes(1);
  expect(s.rpc.mock.calls[0]).toEqual(["clinic_bill_and_pay_inpatient", expect.objectContaining({ p_record_id: "record", p_visit_id: "visit", p_parts: [{ method: "Tunai", amount: 100000 }], p_overpayment_ack: null, p_add_owner_credit: false })]);
});
it("backend overpayment confirmation returns exact current quote without success redirect", async () => {
  const quote = { token: "new", excess: 50000, remaining: 50000, amount: 100000 };
  s.rpc.mockResolvedValue({ data: { status: "OVERPAYMENT_CONFIRM_REQUIRED", quote }, error: null });
  expect(await simpanBayar(form())).toEqual({ status: "OVERPAYMENT_CONFIRM_REQUIRED", quote });
});
it("zero money is forwarded as empty parts, not fake receipt", async () => {
  s.rpc.mockResolvedValue({ data: { status: "SAVED", receipt_id: null, invoice_id: "invoice", record_id: "record", visit_id: "visit" }, error: null });
  const f = form(); f.set("parts", "[]");
  await expect(simpanBayar(f)).resolves.toEqual({ status: "SAVED", href: "/klinik/rawat-inap/record/tagihan?success=transaksi&invoice=invoice" });
  expect(s.rpc.mock.calls[0][1].p_parts).toEqual([]);
});
it.each(["bad-json", '[{"method":"Tunai","amount":0}]', '[{"method":"Arbitrary","amount":10}]', '[{"method":"Tunai","amount":-1}]', '[{"method":"Tunai","amount":1.5}]']) ("invalid money %s fails closed", async parts => {
  const f=form(); f.set("parts",parts); expect((await simpanBayar(f)).status).toBe("ERROR"); expect(s.rpc).not.toHaveBeenCalled();
});
it("expired session returns a visible error without a swallowed redirect", async () => {
  s.user = false;
  expect(await simpanBayar(form())).toEqual({ status: "ERROR", error: "Sesi berakhir. Masuk lagi sebelum menyimpan pembayaran." });
  expect(s.rpc).not.toHaveBeenCalled();
});
it("no compatibility fallback on missing/internal function", async () => {
  s.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "internal missing" } });
  expect((await simpanBayar(form())).status).toBe("ERROR"); expect(s.rpc).toHaveBeenCalledTimes(1);
});
it("credit-only success requires real application IDs and binds navigation to them", async () => {
  const id = "fa900000-0000-4000-8000-000000000001";
  s.rpc.mockResolvedValue({ data: { status: "SAVED", receipt_id: null, invoice_id: null, application_ids: [id], record_id: "record", visit_id: "visit" }, error: null });
  const f = form(); f.set("parts", "[]");
  expect(await simpanBayar(f)).toEqual({ status: "SAVED", href: `/klinik/rawat-inap/record/tagihan?success=transaksi&applications=${id}` });
  s.rpc.mockResolvedValue({ data: { status: "SAVED", application_ids: [], record_id: "record", visit_id: "visit" }, error: null });
  expect((await simpanBayar(f)).status).toBe("ERROR");
});
it("wrong returned visit/record cannot produce success feedback", async () => {
  s.rpc.mockResolvedValue({ data: { status: "SAVED", receipt_id: "receipt", visit_id: "other", record_id: "record" }, error: null });
  expect((await simpanBayar(form())).status).toBe("ERROR");
});
