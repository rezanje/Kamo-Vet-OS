import { describe, expect, it } from "vitest";
import { petshopHistory, type PetshopReceiptCancel } from "@/lib/transaction-history";

const base: PetshopReceiptCancel = {
  id: "c1", reason: "Salah metode", created_at: "2026-11-12T03:00:00Z", created_by: "u1", source_shift_status: "open", source_shift_id: "s1", effect_shift_id: "s1",
  before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: [{ method: "QRIS", amount: 100000 }],
  closed_at: "2026-11-12T04:00:00Z", closed_by: "u1", closed_kind: "diterima-ulang",
};
const run = (c: Partial<PetshopReceiptCancel>, online: { effective_date?: string | null } = {}) => petshopHistory({
  names: new Map([["u1", "Rina Owner"]]), corrections: [], cancellation: null, returns: [],
  receiptCancellations: [{ ...base, ...c }],
  onlineCancellations: [{ id: "o1", reason: "Nominal salah", created_at: "2026-11-12T03:00:00Z", created_by: "u1", amount_bank: 90000, amount_fee: 10000, ...online }],
});

describe("riwayat: tanggal efektif", () => {
  it("pembatalan dan terima ulang bertanggal mundur menyebut tanggal pembukuan dan waktu catat; alasan terima ulang ikut", () => {
    const events = run({ effective_date: "2026-11-10", receive_effective_date: "2026-11-10", receive_reason: "Dibayar di hari struk" });
    const cancel = events.find(e => e.key === "batal-terima:c1")!;
    const again = events.find(e => e.key === "terima-ulang:c1")!;
    expect(cancel.detail.join(" ")).toContain("dibukukan di tanggal 10/11/2026 (dicatat 12/11/2026)");
    expect(again.detail.join(" ")).toContain("dibukukan di tanggal 10/11/2026 (dicatat 12/11/2026)");
    expect(again.reason).toBe("Dibayar di hari struk");
  });
  it("tanggal efektif = tanggal catat (WIB) atau kosong (catatan lama): tidak ada keterangan tambahan", () => {
    for (const c of [{ effective_date: "2026-11-12", receive_effective_date: "2026-11-12" }, { effective_date: null, receive_effective_date: null }, {}]) {
      const events = run(c);
      expect(events.find(e => e.key === "batal-terima:c1")!.detail).toHaveLength(1);
      expect(events.find(e => e.key === "terima-ulang:c1")!.detail).toHaveLength(1);
      expect(events.find(e => e.key === "terima-ulang:c1")!.reason).toBeNull();
    }
  });
  it("tengah malam WIB: stempel 2026-11-11T18:00Z = 12 Nov WIB, bukan 11 Nov", () => {
    const events = run({ created_at: "2026-11-11T18:00:00Z", effective_date: "2026-11-12", closed_at: null, closed_kind: null, receive_effective_date: null });
    expect(events.find(e => e.key === "batal-terima:c1")!.detail).toHaveLength(1);
  });
  it("pembalikan pencairan bertanggal mundur menyebut tanggal pembukuan", () => {
    const events = run({}, { effective_date: "2026-11-09" });
    expect(events.find(e => e.key === "batal-cair:o1")!.detail.join(" ")).toContain("dibukukan di tanggal 09/11/2026 (dicatat 12/11/2026)");
    expect(run({}, {}).find(e => e.key === "batal-cair:o1")!.detail).toHaveLength(1);
  });
});
