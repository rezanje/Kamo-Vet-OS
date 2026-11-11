import { describe, expect, it } from "vitest";
import { loadReceiptCancelPreview, parseReceiptCancelPreview } from "../purchase-cancel-preview";

const base = { receipt_id: "r1", no_terima: "TB-1", po_id: "p1", no_po: "PO-1", tanggal: "2026-11-01", already_cancelled: false, average: false, effects: {} };

describe("pratinjau batal penerimaan", () => {
  it("membaca penghalang dengan dokumen yang harus dibatalkan dulu", () => {
    const p = parseReceiptCancelPreview({ ...base, can_cancel: false, blockers: [{ code: "faktur_aktif", message: "Batalkan faktur dulu", docs: [{ kind: "purchase-invoice", id: "i1", label: "Faktur FB-1" }, { kind: "ngawur", id: "x", label: "x" }], paid: "1000" }] });
    expect(p?.blockers[0].docs).toEqual([{ kind: "purchase-invoice", id: "i1", label: "Faktur FB-1" }]);
    expect(p?.blockers[0].paid).toBe(1000);
  });
  it("menolak pratinjau yang bertentangan (bisa batal tetapi ada penghalang, atau pesan kosong)", () => {
    expect(parseReceiptCancelPreview({ ...base, can_cancel: true, blockers: [{ code: "x", message: "m", docs: [] }] })).toBeNull();
    expect(parseReceiptCancelPreview({ ...base, can_cancel: false, blockers: [] })).toBeNull();
    expect(parseReceiptCancelPreview({ ...base, can_cancel: false, blockers: [{ code: "x", message: " ", docs: [] }] })).toBeNull();
    expect(parseReceiptCancelPreview(null)).toBeNull();
  });
  it("tidak pernah melempar: galat baca menjadi pesan, bukan layar kosong", async () => {
    expect(await loadReceiptCancelPreview({ rpc: () => { throw new Error("x"); } } as never, "r1")).toEqual({ preview: null, error: expect.stringContaining("belum dapat dimuat") });
    expect(await loadReceiptCancelPreview({ rpc: async () => ({ data: null, error: { message: "Akses ditolak" } }) } as never, "r1")).toEqual({ preview: null, error: "Akses ditolak" });
    expect((await loadReceiptCancelPreview({ rpc: async () => ({ data: { ...base, can_cancel: true, blockers: [] }, error: null }) } as never, "r1")).preview?.can_cancel).toBe(true);
  });
});
