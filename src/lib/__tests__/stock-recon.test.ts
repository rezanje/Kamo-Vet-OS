import { describe, expect, it } from "vitest";
import { canApprove, canTransitionRequest, receiptSummary } from "../stock-recon";

describe("canTransitionRequest", () => {
  it("allows only linear forward steps", () => {
    expect(canTransitionRequest("Menunggu Persetujuan", "Disetujui")).toBe(true);
    expect(canTransitionRequest("Disetujui", "Dikirim")).toBe(true);
    expect(canTransitionRequest("Dikirim", "Selesai")).toBe(true);
  });
  it("rejects skips and backward moves", () => {
    expect(canTransitionRequest("Menunggu Persetujuan", "Dikirim")).toBe(false);
    expect(canTransitionRequest("Dikirim", "Disetujui")).toBe(false);
    expect(canTransitionRequest("Selesai", "Dikirim")).toBe(false);
  });
  it("Ditolak only from Menunggu Persetujuan", () => {
    expect(canTransitionRequest("Menunggu Persetujuan", "Ditolak")).toBe(true);
    expect(canTransitionRequest("Disetujui", "Ditolak")).toBe(false);
    expect(canTransitionRequest("Ditolak", "Disetujui")).toBe(false);
  });
});

describe("canApprove", () => {
  it("only OWNER/ADMIN", () => {
    expect(canApprove("OWNER")).toBe(true);
    expect(canApprove("ADMIN")).toBe(true);
    expect(canApprove("STAFF")).toBe(false);
    expect(canApprove("DOCTOR")).toBe(false);
  });
});

describe("receiptSummary", () => {
  it("totals ordered/received and signed selisih", () => {
    const s = receiptSummary([
      { qty_ordered: 10, qty_received: 8 },
      { qty_ordered: 5, qty_received: 5 },
    ]);
    expect(s).toEqual({ ordered: 15, received: 13, selisih: -2 });
  });
  it("over-delivery positive selisih", () => {
    expect(receiptSummary([{ qty_ordered: 2, qty_received: 3 }]).selisih).toBe(1);
  });
});
