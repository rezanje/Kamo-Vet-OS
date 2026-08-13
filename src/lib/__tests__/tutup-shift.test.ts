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
  employees?: Any[];
  cash_advances_inserted?: Any[];
  journalLines?: Any[];
};

function makeClient(db: Db) {
  db.journal ??= [];
  // postJournal mencari akun lewat kodenya; tanpa daftar ini ia berhenti diam-diam.
  db.coa_accounts ??= [
    { id: "a1101", code: "1101" }, { id: "a1203", code: "1203" }, { id: "a5901", code: "5901" }, { id: "a4303", code: "4303" },
  ];
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
          if (table === "cash_advances") (db.cash_advances_inserted ??= []).push(v);
          if (table === "journal_lines") (db.journalLines ??= []).push(...(Array.isArray(v) ? v : [v]));
          return { select: () => ({ single: async () => ({ data: { id: `X${db.journal!.length}` }, error: null }) }) };
        },
        update: () => ((mode = "update"), self),
        eq: (k: string, v: Any) => ((f[k] = v), self),
        in: () => self,
        is: () => self,
        not: () => self,
        order: () => self,
        limit: () => self,
        like: () => self,
        maybeSingle: async () => {
          if (table === "employees") return { data: (db.employees ?? [])[0] ?? null, error: null };
          if (table === "journal_entries") return { data: db.journal!.length ? { id: "J1" } : null, error: null };
          return { data: null, error: null };
        },
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

describe("selisih kas kurang jadi piutang kasir", () => {
  const dbDasar = (): Db => ({
    sales: [{ total: 200_000, metode_bayar: "Tunai" }],
    expenses: [],
    employees: [{ id: "E1", nama: "Siti" }],
  });

  it("kasir yang punya kartu karyawan: utangnya tercatat atas namanya", async () => {
    const db = dbDasar();
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 250_000 });
    expect(hasil).toMatchObject({ ok: true, selisih: -50_000, dibebankanKe: "Siti" });
    expect(db.cash_advances_inserted).toHaveLength(1);
    expect(db.cash_advances_inserted![0]).toMatchObject({ employee_id: "E1", jumlah: 50_000, status: "Disetujui" });
    // Jurnalnya ke Piutang Karyawan, bukan Selisih Kas.
    const akun = (db.journalLines ?? []).map((l: Any) => l.account_id);
    expect(akun).toContain("a1203");
    expect(akun).not.toContain("a5901");
  });

  it("kasir tanpa kartu karyawan: tetap ke Selisih Kas, tidak hilang", async () => {
    const db = { ...dbDasar(), employees: [] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 250_000 });
    expect(hasil).toMatchObject({ ok: true, dibebankanKe: null });
    expect(db.cash_advances_inserted ?? []).toHaveLength(0);
    expect((db.journalLines ?? []).map((l: Any) => l.account_id)).toContain("a5901");
  });

  it("kas LEBIH tidak pernah jadi piutang siapa pun", async () => {
    const db = dbDasar();
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 400_000 });
    expect(hasil).toMatchObject({ ok: true, selisih: 100_000, dibebankanKe: null });
    expect(db.cash_advances_inserted ?? []).toHaveLength(0);
    expect((db.journalLines ?? []).map((l: Any) => l.account_id)).toContain("a4303");
  });

  // Kalau kas lebih dikreditkan ke akun BEBAN (5901), Laba Rugi menampilkannya
  // sebagai beban minus dan laba bersih bisa melebihi laba kotor.
  it("kas LEBIH masuk Pendapatan Lain-lain, BUKAN mengurangi beban", async () => {
    const db = dbDasar();
    await tutupShift(makeClient(db), { shift: shift(), closing: 400_000 });
    const akun = (db.journalLines ?? []).map((l: Any) => l.account_id);
    expect(akun).toContain("a4303");
    expect(akun).not.toContain("a5901");
  });

  it("kas KURANG tetap ke Selisih Kas — itu memang kerugian perusahaan", async () => {
    const db = { ...dbDasar(), employees: [] };
    await tutupShift(makeClient(db), { shift: shift(), closing: 250_000 });
    const akun = (db.journalLines ?? []).map((l: Any) => l.account_id);
    expect(akun).toContain("a5901");
    expect(akun).not.toContain("a4303");
  });
});
