import { describe, expect, it } from "vitest";
import { petshopHistory } from "@/lib/transaction-history";

// Batalkan penerimaan petshop: riwayat menjelaskan ke mana uang tunai jatuh (shift pelaku / tanpa shift) supaya Finance tidak menebak.
const base = {
  id: "c1", reason: "Salah nominal", created_at: "2026-11-12T01:00:00Z", created_by: null, source_shift_status: "closed",
  source_shift_id: "s-asal", before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: null, closed_at: null, closed_by: null, closed_kind: null,
};
function detail(c: Record<string, unknown>): string {
  const events = petshopHistory({ corrections: [], cancellation: null, returns: [], receiptCancellations: [{ ...base, ...c } as never], names: new Map(), viewerId: null });
  return events.find(e => e.key === "batal-terima:c1")!.detail.join(" ");
}
describe("riwayat batalkan penerimaan petshop: tempat uang tunai jatuh", () => {
  it("tanpa_shift: ditandai untuk Finance, tidak menyebut shift lain", () => {
    const d = detail({ effect_shift_id: null, shift_mode: "tanpa_shift" });
    expect(d).toContain("TANPA SHIFT");
    expect(d).not.toContain("shift terbuka pelaku");
  });
  it("shift pelaku (berbeda dari shift asal): disebut shift terbuka pelaku", () => {
    expect(detail({ effect_shift_id: "s-pelaku", shift_mode: "shift_pelaku" })).toContain("dicatat di shift terbuka pelaku");
  });
  it("shift asal terbuka atau nonkas: tidak ada keterangan tambahan", () => {
    expect(detail({ effect_shift_id: "s-asal", source_shift_status: "open", shift_mode: "shift_asal_terbuka" })).not.toMatch(/TANPA SHIFT|terbuka pelaku/);
    expect(detail({ effect_shift_id: null, shift_mode: "nonkas" })).not.toMatch(/TANPA SHIFT|terbuka pelaku/);
  });
});
