import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { koreksiMetodeBayarKlinik } from "@/app/(app)/klinik/pembayaran/[visitId]/payment-correction-actions";
import { clinicCorrectableParts } from "@/lib/clinic-payment-correction";
import { revalidatePath } from "next/cache";

const visitId = "f6000000-0000-4000-8000-000000000001";
const invoiceId = "f7000000-0000-4000-8000-000000000001";
const paymentId = "f9000000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ visitId, invoiceId, paymentId, revision: "1", requestKey: "stable-key", alasan: "Kasir salah pilih metode", metode: "Transfer", ...extra })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("koreksiMetodeBayarKlinik", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.rpc.mockResolvedValue({ data: { invoice_id: invoiceId, payment_id: paymentId, revision: 2, audit_id: "audit" }, error: null });
  });

  it("corrects one payment part with the durable key", async () => {
    await expect(koreksiMetodeBayarKlinik(form())).rejects.toThrow(`/klinik/pembayaran/${visitId}?success=koreksi-metode`);
    expect(fixture.rpc).toHaveBeenCalledWith("correct_clinic_invoice_payment", {
      p_invoice_id: invoiceId, p_payment_id: paymentId, p_expected_revision: 1,
      p_request_key: "stable-key", p_reason: "Kasir salah pilih metode", p_new_method: "Transfer",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"])("accepts %s as the new method", async (metode) => {
    fixture.rpc.mockResolvedValue({ data: { invoice_id: invoiceId, payment_id: paymentId, revision: 2, audit_id: "audit" }, error: null });
    await expect(koreksiMetodeBayarKlinik(form({ metode }))).rejects.toThrow(/success=koreksi-metode/);
    expect(fixture.rpc).toHaveBeenCalledWith("correct_clinic_invoice_payment", expect.objectContaining({ p_new_method: metode }));
  });

  it("sends a null payment id for the invoice's direct payment", async () => {
    fixture.rpc.mockResolvedValue({ data: { invoice_id: invoiceId, payment_id: null, revision: 1, audit_id: "audit" }, error: null });
    await expect(koreksiMetodeBayarKlinik(form({ paymentId: "", revision: "0", metode: "Tunai" }))).rejects.toThrow(/success=koreksi-metode/);
    expect(fixture.rpc).toHaveBeenCalledWith("correct_clinic_invoice_payment", expect.objectContaining({ p_payment_id: null, p_new_method: "Tunai", p_expected_revision: 0 }));
  });

  it.each([["metode", "Kartu"], ["metode", "tunai"], ["revision", "-1"], ["revision", ""], ["alasan", "x"], ["requestKey", ""], ["paymentId", "bukan-uuid"], ["invoiceId", ""]])(
    "rejects invalid %s=%s before RPC", async (field, value) => {
      await expect(koreksiMetodeBayarKlinik(form({ [field]: value }))).rejects.toThrow(/tidak (valid|dikenal)/);
      expect(fixture.rpc).not.toHaveBeenCalled();
    });

  it("surfaces a database refusal without acknowledging", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Hanya Owner atau Finance aktif dapat mengoreksi metode pembayaran" } });
    await expect(koreksiMetodeBayarKlinik(form())).rejects.toThrow(/Hanya Owner atau Finance/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not acknowledge an uncertain or mismatched response", async () => {
    fixture.rpc.mockResolvedValue({ data: { invoice_id: invoiceId, payment_id: paymentId, revision: 1, audit_id: "audit" }, error: null });
    await expect(koreksiMetodeBayarKlinik(form())).rejects.toThrow(/belum terkonfirmasi/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("clinicCorrectableParts", () => {
  const base = { total: 100000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai", reissued_from: null };

  it("offers the direct payment of a single-method paid invoice", () => {
    expect(clinicCorrectableParts(base, [])).toEqual([{ paymentId: null, label: "Pembayaran invoice", method: "Tunai", amount: 100000 }]);
  });

  it("offers each split part of any valid method but not transferred balances, receipt-bound parts or unknown methods", () => {
    const parts = clinicCorrectableParts(base, [
      { id: "a", amount: 30000, metode: "Tunai", transferred_from: null },
      { id: "b", amount: 50000, metode: "QRIS", transferred_from: null },
      { id: "c", amount: 20000, metode: "Transfer", transferred_from: "old" },
      { id: "d", amount: 10000, metode: "E-Wallet", transferred_from: null, receipt_id: "kwitansi-ranap" },
      { id: "e", amount: 5000, metode: "Kartu", transferred_from: null },
    ]);
    expect(parts).toEqual([
      { paymentId: "a", label: "Bagian pembayaran 1", method: "Tunai", amount: 30000 },
      { paymentId: "b", label: "Bagian pembayaran 2", method: "QRIS", amount: 50000 },
    ]);
  });

  it("offers the down payment and later receipts, never a reissued invoice's direct part", () => {
    const dp = { ...base, paid_status: "DP", dp_amount: 40000, metode_bayar: "Transfer" };
    expect(clinicCorrectableParts(dp, []).map(p => [p.paymentId, p.label, p.amount])).toEqual([[null, "Uang muka", 40000]]);
    expect(clinicCorrectableParts({ ...base, reissued_from: "old" }, [])).toEqual([]);
    expect(clinicCorrectableParts({ ...base, metode_bayar: "Debit" }, []).map(p => p.method)).toEqual(["Debit"]);
    expect(clinicCorrectableParts({ ...base, metode_bayar: "Kartu" }, [])).toEqual([]);
  });
});
