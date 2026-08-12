import { describe, expect, it } from "vitest";
import { hitungShift, pemasukanShift, tutupShift, type ShiftTutup } from "../tutup-shift";

// Supabase palsu seadanya: cukup untuk rantai yang dipakai tutup-shift.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

type Db = {
  sales?: Any[];
  invoices?: Any[];
  invoice_payments?: Any[];
  expenses?: Any[];
  coa_accounts?: Any[];
  cash_accounts?: Any[];
  payment_account_map?: Any[];
  /** Shift yang boleh ditutup — dikosongkan untuk mensimulasikan "sudah ditutup duluan". */
  shiftTerbuka?: boolean;
  journal?: Any[];
};

function makeClient(db: Db) {
  db.journal ??= [];
  return {
    from(table: string) {
      const f: Record<string, Any> = {};
      // `update(...).select("id")` dipakai untuk membaca berapa baris yang kena;
      // jadi update dilacak terpisah, bukan lewat mode yang bisa ditimpa select().
      let mode = "select";
      const self: Any = {
        select: () => (mode === "update" ? self : ((mode = "select"), self)),
        insert: (v: Any) => {
          if (table === "journal_entries") db.journal!.push(v);
          return { select: () => ({ single: async () => ({ data: { id: `J${db.journal!.length}` }, error: null }) }) };
        },
        update: () => ((mode = "update"), self),
        eq: (k: string, v: Any) => ((f[k] = v), self),
        in: () => self,
        is: () => self,
        not: () => self,
        order: () => self,
        limit: () => self,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (res: Any, rej: Any) => {
          let data: Any = [];
          if (mode === "update" && table === "cashier_shifts") {
            // Meniru `.eq("status","open")`: kalau shiftnya tidak lagi terbuka,
            // tidak ada baris yang kena update.
            data = db.shiftTerbuka === false ? [] : [{ id: f.id }];
          } else if (table === "journal_lines") {
            data = [];
          } else {
            data = (db as Any)[table] ?? [];
          }
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return self;
    },
  };
}

const shift = (o: Partial<ShiftTutup> = {}): ShiftTutup => ({
  id: "S1", shift_type: "petshop", opening_balance: 100_000,
  branch_id: "B1", opened_by: "U1", status: "open", ...o,
});

describe("pemasukanShift", () => {
  it("shift petshop membaca penjualan", async () => {
    const db: Db = { sales: [{ total: 50_000, metode_bayar: "Tunai" }] };
    const rows = await pemasukanShift(makeClient(db), shift());
    expect(rows).toEqual([{ total: 50_000, metode_bayar: "Tunai" }]);
  });

  it("shift klinik membaca invoice, bukan penjualan", async () => {
    // Kalau salah sumber, shift klinik yang ditutup dari backoffice menghasilkan
    // target kas = modal awal saja → selisih sebesar kas sehari.
    const db: Db = {
      sales: [{ total: 999_999, metode_bayar: "Tunai" }],
      invoices: [{ id: "I1", total: 300_000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" }],
      invoice_payments: [],
    };
    const rows = await pemasukanShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(rows).toEqual([{ total: 300_000, metode_bayar: "Tunai" }]);
  });

  it("invoice klinik yang sudah dilunasi belakangan hanya dihitung DP-nya", async () => {
    const db: Db = {
      invoices: [{ id: "I1", total: 500_000, dp_amount: 100_000, paid_status: "Lunas", metode_bayar: "Tunai" }],
      invoice_payments: [{ invoice_id: "I1", amount: 400_000 }],
    };
    const rows = await pemasukanShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(rows[0].total).toBe(100_000);
  });
});

describe("hitungShift", () => {
  it("target kas = modal awal + tunai masuk − pengeluaran tunai", async () => {
    const db: Db = {
      sales: [
        { total: 200_000, metode_bayar: "Tunai" },
        { total: 500_000, metode_bayar: "QRIS" }, // non-tunai tidak menambah laci
      ],
      expenses: [
        { jumlah: 30_000, metode_bayar: "Tunai" },
        { jumlah: 90_000, metode_bayar: "Transfer" }, // keluar dari bank, bukan laci
      ],
    };
    const { expected, breakdown } = await hitungShift(makeClient(db), shift());
    expect(expected).toBe(100_000 + 200_000 - 30_000);
    expect(breakdown.QRIS).toBe(500_000);
  });
});

describe("tutupShift", () => {
  it("menolak shift yang statusnya bukan open", async () => {
    const hasil = await tutupShift(makeClient({}), { shift: shift({ status: "closed" }), closing: 0 });
    expect(hasil).toEqual({ ok: false, error: "Shift sudah ditutup." });
  });

  it("submit dobel tidak menutup dua kali", async () => {
    // Baris tidak kena update karena syarat status=open ikut di UPDATE-nya.
    const db: Db = { sales: [], expenses: [], shiftTerbuka: false };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 100_000 });
    expect(hasil.ok).toBe(false);
    expect(db.journal).toHaveLength(0); // yang penting: jurnal selisih tidak dobel
  });

  it("selisih nol tidak memposting jurnal", async () => {
    const db: Db = { sales: [], expenses: [] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 100_000 });
    expect(hasil).toMatchObject({ ok: true, selisih: 0 });
    expect(db.journal).toHaveLength(0);
  });

  it("force-close (closing null) memaksa selisih 0 dan tanpa jurnal", async () => {
    // Tidak ada kas fisik yang dihitung, jadi tidak ada selisih yang boleh
    // dibebankan ke siapa pun.
    const db: Db = { sales: [{ total: 250_000, metode_bayar: "Tunai" }], expenses: [] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: null });
    expect(hasil).toMatchObject({ ok: true, selisih: 0, expected: 350_000 });
    expect(db.journal).toHaveLength(0);
  });

  it("kas kurang menghasilkan selisih negatif", async () => {
    const db: Db = { sales: [{ total: 200_000, metode_bayar: "Tunai" }], expenses: [] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 250_000 });
    expect(hasil).toMatchObject({ ok: true, expected: 300_000, selisih: -50_000 });
  });
});
