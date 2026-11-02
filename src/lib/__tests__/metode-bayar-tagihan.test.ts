import { describe, expect, it } from "vitest";
import {
  labelMetodeBayar, metodeBayarTagihanBertahap, metodeTampil, susunMetodeTagihan,
} from "../metode-bayar-tagihan";

describe("labelMetodeBayar", () => {
  it("satu metode, campuran, kosong", () => {
    expect(labelMetodeBayar(["Kredit"])).toBe("Kredit");
    expect(labelMetodeBayar(["Kredit", "Kredit"])).toBe("Kredit");
    expect(labelMetodeBayar(["Tunai", "Debit"])).toBe("Campuran");
    expect(labelMetodeBayar([null, "", undefined])).toBeNull();
  });
});

describe("susunMetodeTagihan", () => {
  it("kasus Chloe: tagihan dilunasi uang muka dari kwitansi kartu -> Kredit, bukan Tunai", () => {
    const hasil = susunMetodeTagihan(
      ["inv-chloe"],
      [{ invoice_id: "inv-chloe", amount: 919000, metode: "Uang Muka" }],
      [{ invoice_id: "inv-chloe", advance_id: "umk-8", released_at: null }],
      [{ id: "umk-8", receipt_id: "kwt-8" }],
      [{ id: "kwt-8", status: "aktif", clinic_payment_receipt_parts: [{ metode: "Kredit" }] }],
    );
    expect(hasil.get("inv-chloe")).toBe("Kredit");
  });

  it("kwitansi campuran -> Campuran; bayar langsung ikut dihitung", () => {
    const hasil = susunMetodeTagihan(
      ["a", "b"],
      [
        { invoice_id: "a", amount: 100, metode: "Uang Muka" },
        { invoice_id: "b", amount: 50, metode: "QRIS" },
      ],
      [{ invoice_id: "a", advance_id: "u", released_at: null }],
      [{ id: "u", receipt_id: "k" }],
      [{ id: "k", status: "aktif", clinic_payment_receipt_parts: [{ metode: "Tunai" }, { metode: "Debit" }] }],
    );
    expect(hasil.get("a")).toBe("Campuran");
    expect(hasil.get("b")).toBe("QRIS");
  });

  it("kwitansi dibatalkan / penerapan dilepas / bayar yang dibalik tidak menyebut metodenya", () => {
    const hasil = susunMetodeTagihan(
      ["a", "b", "c"],
      [
        { invoice_id: "c", amount: 70, metode: "Transfer" },
        { invoice_id: "c", amount: -70, metode: "Transfer" },
      ],
      [
        { invoice_id: "a", advance_id: "u1", released_at: null },
        { invoice_id: "b", advance_id: "u2", released_at: "2026-11-02T10:00:00Z" },
      ],
      [{ id: "u1", receipt_id: "k1" }, { id: "u2", receipt_id: "k2" }],
      [
        { id: "k1", status: "batal", clinic_payment_receipt_parts: [{ metode: "Debit" }] },
        { id: "k2", status: "aktif", clinic_payment_receipt_parts: [{ metode: "Debit" }] },
      ],
    );
    expect(hasil.size).toBe(0);
  });

  it("tagihan di luar daftar diabaikan", () => {
    const hasil = susunMetodeTagihan(["a"], [{ invoice_id: "x", amount: 1, metode: "QRIS" }], [], [], []);
    expect(hasil.size).toBe(0);
  });
});

describe("metodeTampil", () => {
  const telusur = new Map([["s", "Kredit"]]);
  it("hanya tagihan bertahap yang labelnya diganti; selain itu label kepala", () => {
    expect(metodeTampil({ id: "s", metode_bayar: "Tunai", stage_billing: true }, telusur)).toBe("Kredit");
    expect(metodeTampil({ id: "s", metode_bayar: "Tunai", stage_billing: false }, telusur)).toBe("Tunai");
    expect(metodeTampil({ id: "t", metode_bayar: "Tunai", stage_billing: true }, telusur)).toBe("Tunai");
  });
});

type Hasil = { data: unknown; error: unknown };
function fakeDb(tables: Record<string, Hasil>, calls: string[] = []) {
  return {
    from(table: string) {
      calls.push(table);
      const res = tables[table] ?? { data: [], error: null };
      const chain = { select: () => chain, in: () => Promise.resolve(res) };
      return chain;
    },
  };
}

describe("metodeBayarTagihanBertahap", () => {
  it("menelusuri invoice -> uang muka -> kwitansi", async () => {
    const db = fakeDb({
      invoice_payments: { data: [{ invoice_id: "i", amount: 919000, metode: "Uang Muka" }], error: null },
      clinic_advance_applications: { data: [{ invoice_id: "i", advance_id: "u", released_at: null }], error: null },
      clinic_customer_advances: { data: [{ id: "u", receipt_id: "k" }], error: null },
      clinic_payment_receipts: { data: [{ id: "k", status: "aktif", clinic_payment_receipt_parts: [{ metode: "Kredit" }] }], error: null },
    });
    expect((await metodeBayarTagihanBertahap(db, ["i"])).get("i")).toBe("Kredit");
  });

  it("tanpa tagihan bertahap tidak membaca apa pun", async () => {
    const calls: string[] = [];
    expect((await metodeBayarTagihanBertahap(fakeDb({}, calls), [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("gagal baca -> kosong (pemanggil memakai label kepala)", async () => {
    const db = fakeDb({ invoice_payments: { data: null, error: { message: "x" } } });
    expect((await metodeBayarTagihanBertahap(db, ["i"])).size).toBe(0);
  });
});
