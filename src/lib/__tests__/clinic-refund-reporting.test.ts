import { describe, expect, it } from "vitest";
import { clinicRefundPerInvoice, clinicRefundTotalBetween } from "../clinic-refund-reporting";

// Data fiktif: dua invoice klinik, refund parsial bertahap dan satu refund lintas tahun.
const rows = [
  { invoice_id: "inv-fiktif-1", total: 25_000, tanggal: "2026-10-20" },
  { invoice_id: "inv-fiktif-1", total: "10000.10", tanggal: "2026-10-22" },
  { invoice_id: "inv-fiktif-2", total: 0.2, tanggal: "2026-10-22" },
  { invoice_id: "inv-fiktif-2", total: 0.1, tanggal: "2025-12-31" },
];

describe("refund klinik untuk laporan omzet", () => {
  it("menjumlah refund yang sudah diposting per invoice asal, sampai sen", () => {
    const map = clinicRefundPerInvoice(rows);
    expect(map.get("inv-fiktif-1")).toBe(35_000.1);
    expect(map.get("inv-fiktif-2")).toBe(0.3);
    expect(map.get("tidak-ada")).toBeUndefined();
  });

  it("aman untuk data kosong / baris tanpa invoice", () => {
    expect(clinicRefundPerInvoice(null).size).toBe(0);
    expect(clinicRefundPerInvoice([{ invoice_id: "", total: 5 }, { invoice_id: "x", total: null }]).get("x")).toBe(0);
  });

  it("menjumlah refund menurut tanggal refund di dalam rentang (inklusif)", () => {
    expect(clinicRefundTotalBetween(rows, "2026-01-01", "2026-10-28")).toBe(35_000.3);
    expect(clinicRefundTotalBetween(rows, "2026-10-22", "2026-10-22")).toBe(10_000.3);
    expect(clinicRefundTotalBetween(rows, "2025-01-01", "2025-12-31")).toBe(0.1);
    expect(clinicRefundTotalBetween([{ invoice_id: "x", total: 9 }], "2026-01-01", "2026-12-31")).toBe(0);
  });
});
