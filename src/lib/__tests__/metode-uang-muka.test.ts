import { describe, expect, it } from "vitest";
import {
  alokasiUangMuka, komposisiUangMuka, labelMetodeInvoice, muatBagianUangMuka, muatLabelMetodeInvoice, ringkasMetodeInvoice,
  type PembayaranMetode,
} from "@/lib/metode-uang-muka";

// Invoice rawat inap yang dibayar lewat uang muka menyimpan metode_bayar "Tunai" sebagai
// bawaan tahap, sedangkan uang aslinya masuk lewat kwitansi (QRIS/Transfer/dst).
// Tampilan harus mengikuti bagian kwitansi, bukan kolom bawaan itu.

const UM = (id: string, amount: number): PembayaranMetode =>
  ({ id, amount, metode: "Uang Muka", transferred_from: null });
const BAYAR = (id: string, metode: string, amount: number): PembayaranMetode =>
  ({ id, amount, metode, transferred_from: null });

describe("alokasiUangMuka", () => {
  it("satu metode: seluruh nominal ke metode itu", () => {
    expect(alokasiUangMuka(885000, [{ metode: "QRIS", amount: 885000 }]))
      .toEqual([{ metode: "QRIS", amount: 885000 }]);
  });

  it("campuran: dibagi sebanding, jumlahnya persis nominal pemakaian", () => {
    const hasil = alokasiUangMuka(300000, [{ metode: "Tunai", amount: 200000 }, { metode: "QRIS", amount: 100000 }]);
    expect(hasil).toEqual([{ metode: "Tunai", amount: 200000 }, { metode: "QRIS", amount: 100000 }]);
  });

  it("sebagian saja terpakai: pembagian sebanding, sisa pembulatan tidak hilang", () => {
    const hasil = alokasiUangMuka(100, [{ metode: "Tunai", amount: 1 }, { metode: "QRIS", amount: 1 }, { metode: "Transfer", amount: 1 }]);
    expect(hasil.reduce((s, h) => s + h.amount, 0)).toBe(100);
  });

  it("komposisi kosong atau nol: tidak menebak metode", () => {
    expect(alokasiUangMuka(1000, [])).toBeNull();
    expect(alokasiUangMuka(1000, [{ metode: "QRIS", amount: 0 }])).toBeNull();
  });
});

describe("komposisiUangMuka", () => {
  it("bagian kwitansi dikurangi uang yang langsung dialokasikan ke tagihan", () => {
    // Kwitansi QRIS 583.000: 310.000 langsung menutup tagihan, 273.000 jadi uang muka.
    expect(komposisiUangMuka([{ metode: "Transfer", amount: 583000 }], [{ metode: "Transfer", amount: 310000 }]))
      .toEqual([{ metode: "Transfer", amount: 273000 }]);
  });

  it("dua bagian dengan metode sama digabung; metode lain tetap utuh", () => {
    expect(komposisiUangMuka(
      [{ metode: "Tunai", amount: 100000 }, { metode: "QRIS", amount: 50000 }, { metode: "Tunai", amount: 20000 }], []))
      .toEqual([{ metode: "Tunai", amount: 120000 }, { metode: "QRIS", amount: 50000 }]);
  });

  it("tidak pernah negatif", () => {
    expect(komposisiUangMuka([{ metode: "QRIS", amount: 10 }], [{ metode: "QRIS", amount: 99 }])).toEqual([]);
  });
});

describe("ringkasMetodeInvoice", () => {
  const bagian = (map: Record<string, { metode: string; amount: number }[]>) =>
    new Map(Object.entries(map));

  it("invoice biasa tanpa uang muka: perilaku lama (metode kepala / Campuran)", () => {
    expect(ringkasMetodeInvoice({ metode_bayar: "Transfer", dp_amount: 0 }, [BAYAR("p1", "Transfer", 100)], new Map()).judul).toBe("Transfer");
    expect(ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [BAYAR("p1", "Tunai", 50), BAYAR("p2", "QRIS", 50)], new Map()).judul).toBe("Campuran");
    expect(ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [], new Map()).judul).toBe("Tunai");
    expect(ringkasMetodeInvoice({ metode_bayar: null, dp_amount: 0 }, [], new Map()).judul).toBe("-");
  });

  it("tagihan tahap dibayar langsung lewat kwitansi QRIS: QRIS, bukan 'Tunai' bawaan tahap", () => {
    expect(ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [BAYAR("p1", "QRIS", 595000)], new Map()).judul).toBe("QRIS");
    expect(ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [BAYAR("p1", "QRIS", 1), BAYAR("p2", "QRIS", 2)], new Map()).judul).toBe("QRIS");
  });

  it("DP di kepala (Tunai) lalu pelunasan Transfer: Campuran dengan dua baris", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 100000 }, [BAYAR("p1", "Transfer", 200000)], new Map());
    expect(r.judul).toBe("Campuran");
    expect(r.baris).toEqual([{ label: "Tunai", amount: 100000 }, { label: "Transfer", amount: 200000 }]);
  });

  it("satu uang muka QRIS: 'Uang Muka (QRIS)', bukan Tunai", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 885000)],
      bagian({ p1: [{ metode: "QRIS", amount: 885000 }] }));
    expect(r.judul).toBe("Uang Muka (QRIS)");
    expect(r.baris).toEqual([{ label: "Uang Muka (QRIS)", amount: 885000 }]);
  });

  it("satu uang muka dari kwitansi campuran: rincian per metode", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 885000)],
      bagian({ p1: [{ metode: "Tunai", amount: 600000 }, { metode: "QRIS", amount: 285000 }] }));
    expect(r.judul).toBe("Uang Muka (Tunai Rp 600.000 + QRIS Rp 285.000)");
    expect(r.baris.map((b) => b.label)).toEqual(["Uang Muka (Tunai)", "Uang Muka (QRIS)"]);
  });

  it("beberapa uang muka untuk satu invoice: digabung per metode", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 400000), UM("p2", 485000)],
      bagian({ p1: [{ metode: "QRIS", amount: 400000 }], p2: [{ metode: "QRIS", amount: 285000 }, { metode: "Tunai", amount: 200000 }] }));
    expect(r.judul).toBe("Uang Muka (QRIS Rp 685.000 + Tunai Rp 200.000)");
  });

  it("uang muka dua kali dengan metode sama tetap satu metode", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 400000), UM("p2", 485000)],
      bagian({ p1: [{ metode: "QRIS", amount: 400000 }], p2: [{ metode: "QRIS", amount: 485000 }] }));
    expect(r.judul).toBe("Uang Muka (QRIS)");
    expect(r.baris).toEqual([{ label: "Uang Muka (QRIS)", amount: 885000 }]);
  });

  it("uang muka sebagian + sisa tunai langsung: Campuran dengan rincian", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 },
      [UM("p1", 500000), BAYAR("p2", "Tunai", 385000)], bagian({ p1: [{ metode: "QRIS", amount: 500000 }] }));
    expect(r.judul).toBe("Campuran");
    expect(r.baris).toEqual([{ label: "Uang Muka (QRIS)", amount: 500000 }, { label: "Tunai", amount: 385000 }]);
  });

  it("bagian kwitansi tidak terbaca: tulis 'Uang Muka' saja, JANGAN klaim Tunai", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 885000)], new Map());
    expect(r.judul).toBe("Uang Muka");
    expect(r.baris).toEqual([{ label: "Uang Muka", amount: 885000 }]);
  });

  it("uang muka dilepas/dikembalikan (baris pembalik negatif): tidak dihitung sebagai metode", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 },
      [UM("p1", 875000), UM("p1r", -875000), BAYAR("p2", "Transfer", 875000)], new Map());
    expect(r.judul).toBe("Transfer");
  });

  it("pembayaran dialihkan tidak ikut dihitung", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 },
      [UM("p1", 100), { id: "p2", amount: 50, metode: "Tunai", transferred_from: "x" }],
      bagian({ p1: [{ metode: "QRIS", amount: 100 }] }));
    expect(r.judul).toBe("Uang Muka (QRIS)");
  });

  it("DP di kepala invoice + uang muka: Campuran, metode DP mengikuti kepala", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Transfer", dp_amount: 200000 }, [UM("p1", 100000)],
      bagian({ p1: [{ metode: "QRIS", amount: 100000 }] }));
    expect(r.judul).toBe("Campuran");
    expect(r.baris).toEqual([{ label: "Transfer", amount: 200000 }, { label: "Uang Muka (QRIS)", amount: 100000 }]);
  });

  it("semua uang muka dilepas dan belum ada bayar lain: strip, bukan Tunai", () => {
    const r = ringkasMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 5), UM("p1r", -5)], new Map());
    expect(r.judul).toBe("-");
  });
});

describe("labelMetodeInvoice (daftar/dokumen)", () => {
  it("memakai ringkasan yang sama untuk satu invoice", () => {
    expect(labelMetodeInvoice({ metode_bayar: "Tunai", dp_amount: 0 }, [UM("p1", 10)], new Map([["p1", [{ metode: "Debit", amount: 10 }]]])))
      .toBe("Uang Muka (Debit)");
  });
});

// --- loader -------------------------------------------------------------------------------

type Rows = Record<string, { data: unknown[] | null; error: { message: string } | null }>;
function fakeDb(rows: Rows, calls: string[] = []) {
  return {
    from(table: string) {
      calls.push(table);
      const result = rows[table] ?? { data: [], error: null };
      const q = { select: () => q, in: () => q, not: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok) };
      return q;
    },
  };
}
const APP = (o: Partial<Record<string, unknown>>) => ({
  id: "a1", invoice_id: "inv1", payment_id: "p1", amount: 885000, released_at: null,
  clinic_customer_advances: { id: "adv1", amount: 885000, receipt_id: "r1" }, ...o,
});

describe("muatBagianUangMuka", () => {
  it("tanpa pembayaran Uang Muka: tidak membaca database sama sekali", async () => {
    const calls: string[] = [];
    const out = await muatBagianUangMuka(fakeDb({}, calls) as never, [{ id: "inv1", payments: [BAYAR("p", "Tunai", 10)] }]);
    expect(out.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("satu metode dari kwitansi QRIS", async () => {
    const db = fakeDb({
      clinic_advance_applications: { data: [APP({})], error: null },
      clinic_payment_receipt_parts: { data: [{ receipt_id: "r1", metode: "QRIS", amount: 885000 }], error: null },
      invoice_payments: { data: [], error: null },
    });
    const out = await muatBagianUangMuka(db as never, [{ id: "inv1", payments: [UM("p1", 885000)] }]);
    expect(out.get("p1")).toEqual([{ metode: "QRIS", amount: 885000 }]);
  });

  it("kwitansi campuran: dua metode", async () => {
    const db = fakeDb({
      clinic_advance_applications: { data: [APP({})], error: null },
      clinic_payment_receipt_parts: { data: [
        { receipt_id: "r1", metode: "Tunai", amount: 600000 }, { receipt_id: "r1", metode: "QRIS", amount: 285000 }], error: null },
      invoice_payments: { data: [], error: null },
    });
    const out = await muatBagianUangMuka(db as never, [{ id: "inv1", payments: [UM("p1", 885000)] }]);
    expect(out.get("p1")).toEqual([{ metode: "Tunai", amount: 600000 }, { metode: "QRIS", amount: 285000 }]);
  });

  it("uang muka lebih kecil dari kwitansi: bagian yang langsung dialokasikan tidak dihitung", async () => {
    const db = fakeDb({
      clinic_advance_applications: { data: [APP({ amount: 273000, clinic_customer_advances: { id: "adv1", amount: 273000, receipt_id: "r1" } })], error: null },
      clinic_payment_receipt_parts: { data: [{ receipt_id: "r1", metode: "Transfer", amount: 583000 }], error: null },
      invoice_payments: { data: [{ receipt_id: "r1", metode: "Transfer", amount: 310000 }], error: null },
    });
    const out = await muatBagianUangMuka(db as never, [{ id: "inv1", payments: [UM("p1", 273000)] }]);
    expect(out.get("p1")).toEqual([{ metode: "Transfer", amount: 273000 }]);
  });

  it("pemakaian yang sudah dilepas tidak diberi metode", async () => {
    const db = fakeDb({
      clinic_advance_applications: { data: [APP({ released_at: "2026-11-10T00:00:00Z" })], error: null },
      clinic_payment_receipt_parts: { data: [{ receipt_id: "r1", metode: "QRIS", amount: 885000 }], error: null },
      invoice_payments: { data: [], error: null },
    });
    const out = await muatBagianUangMuka(db as never, [{ id: "inv1", payments: [UM("p1", 885000)] }]);
    expect(out.has("p1")).toBe(false);
  });

  it("gagal baca (error / tabel hilang): kosong, tidak melempar, tidak menebak", async () => {
    const db = fakeDb({ clinic_advance_applications: { data: null, error: { message: "boom" } } });
    const out = await muatBagianUangMuka(db as never, [{ id: "inv1", payments: [UM("p1", 1)] }]);
    expect(out.size).toBe(0);
    const db2 = fakeDb({
      clinic_advance_applications: { data: [APP({})], error: null },
      clinic_payment_receipt_parts: { data: null, error: { message: "denied" } },
    });
    expect((await muatBagianUangMuka(db2 as never, [{ id: "inv1", payments: [UM("p1", 1)] }])).size).toBe(0);
  });
});

describe("muatLabelMetodeInvoice (laporan banyak invoice)", () => {
  const inv = (id: string) => ({ id, metode_bayar: "Tunai", dp_amount: 0 });
  it("uang muka QRIS, bayar langsung Transfer, dan nota tanpa baris bayar", async () => {
    const db = fakeDb({
      invoice_payments: { data: [
        { id: "p1", invoice_id: "i1", amount: 885000, metode: "Uang Muka", transferred_from: null },
        { id: "p2", invoice_id: "i2", amount: 595000, metode: "Transfer", transferred_from: null }], error: null },
      clinic_advance_applications: { data: [APP({ invoice_id: "i1" })], error: null },
      clinic_payment_receipt_parts: { data: [{ receipt_id: "r1", metode: "QRIS", amount: 885000 }], error: null },
    });
    const out = await muatLabelMetodeInvoice(db as never, [inv("i1"), inv("i2"), inv("i3")]);
    expect(out.get("i1")).toBe("Uang Muka (QRIS)");
    expect(out.get("i2")).toBe("Transfer");
    expect(out.has("i3")).toBe(false);
  });
  it("bacaan pembayaran gagal: kosong (label kepala dipakai pemanggil), tidak melempar", async () => {
    const db = fakeDb({ invoice_payments: { data: null, error: { message: "x" } } });
    expect((await muatLabelMetodeInvoice(db as never, [inv("i1")])).size).toBe(0);
  });
  it("tanpa invoice: tidak membaca apa pun", async () => {
    const calls: string[] = [];
    await muatLabelMetodeInvoice(fakeDb({}, calls) as never, []);
    expect(calls).toEqual([]);
  });
});
