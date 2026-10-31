import { describe, expect, it } from "vitest";
import {
  BATAS_SELISIH_KAS, PESAN_KAS_FISIK_TIDAK_WAJAR, cekKasFisikWajar, hitungShift, pemasukanShift, tutupShift, type ShiftTutup,
} from "../tutup-shift";

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
  clinic_payment_receipts?: Any[];
  /** Tabel yang bacaannya gagal — untuk menguji gagal-tertutup. */
  gagal?: Record<string, { code?: string; message: string }>;
};

function makeClient(db: Db) {
  db.journal ??= [];
  // postJournal mencari akun lewat kodenya; tanpa daftar ini ia berhenti diam-diam.
  db.coa_accounts ??= [
    { id: "a1101", code: "110003" }, { id: "a1203", code: "182001" }, { id: "a5901", code: "760002" }, { id: "a4303", code: "810004" },
  ];
  return {
    // Kasbon selisih kas dibuat fungsi database (record_shift_cash_shortage) yang
    // menautkan pembuka shift ke kartu karyawannya; tiruannya memakai db.employees.
    async rpc(name: string, args: Any) {
      if (name === "record_shift_cash_shortage") {
        const emp = (db.employees ?? [])[0];
        if (!emp) return { data: [], error: null };
        (db.cash_advances_inserted ??= []).push({ employee_id: emp.id, shift_id: args.p_shift_id, status: "Disetujui" });
        return { data: [{ advance_id: "ADV1", employee_id: emp.id, employee_name: emp.nama }], error: null };
      }
      if (name === "cancel_shift_cash_shortage") {
        db.cash_advances_inserted = [];
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
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
        or: () => self,
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
          const gagal = db.gagal?.[table];
          if (gagal && mode !== "update") return Promise.resolve({ data: null, error: gagal }).then(res, rej);
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
  it("includes merchant fee in gross bank receipts without increasing cash drawer or counting the bill twice", async () => {
    const sale = { total: 101600, merchant_fee_total: 1600, metode_bayar: "Split", bayar: 131600, kembali: 30000,
      payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600, fee_percent: 2, fee_amount: 1600 }],
      payments_finalized_at: "2026-10-16T05:00:01Z",
      sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600, fee_percent: 2, fee_amount: 1600 }] };
    const result = await hitungShift(makeClient({ sales: [sale, { ...sale, payments_finalized_at: null }] }), shift());
    expect(result.breakdown).toMatchObject({ Tunai: 20000, Debit: 81600 });
    expect(Object.values(result.breakdown).reduce((sum, value) => sum + value, 0)).toBe(101600);
    expect(result.expected).toBe(120000);
  });
  it("does not count an unfinished planned sale in shift cash", async () => {
    const db: Db = { sales: [{ total: 100000, metode_bayar: "Split", payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }],
      payments_finalized_at: null, sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] }] };
    expect(await pemasukanShift(makeClient(db), shift())).toEqual([]);
  });

  it("flattens POS allocations so a split sale only contributes its cash share to the drawer", async () => {
    const db: Db = { sales: [{ total: 100000, metode_bayar: "Split", bayar: 110000, kembali: 10000,
      sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] }],
      expenses: [{ jumlah: 2000, metode_bayar: "Tunai" }, { jumlah: 8000, metode_bayar: "Transfer" }] };
    expect(await pemasukanShift(makeClient(db), shift())).toEqual([
      { total: 20000, metode_bayar: "Tunai" }, { total: 80000, metode_bayar: "Transfer" },
    ]);
    const result = await hitungShift(makeClient(db), shift());
    expect(result.expected).toBe(118000);
    expect(result.breakdown.Transfer).toBe(80000);
  });

  // Tagihan berjalan rawat inap (Andri, 29 Oktober 2026): uangnya masuk lewat kwitansi
  // per kunjungan, bukan lewat kepala invoice, jadi kas fisik shift harus ikut membacanya.
  it("counts inpatient receipt parts per method in the clinic drawer", async () => {
    const db: Db = {
      invoices: [{ id: "tahap-1", total: 300000, dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "Tunai" }],
      invoice_payments: [{ invoice_id: "tahap-1", amount: 250000, metode: "Tunai", transferred_from: null }],
      clinic_payment_receipts: [{
        id: "kwt-1", status: "aktif", shift_id: "S1", void_shift_id: null,
        clinic_payment_receipt_parts: [{ metode: "Tunai", amount: 120000 }, { metode: "QRIS", amount: 130000 }],
      }],
    };
    const result = await hitungShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(result.breakdown).toMatchObject({ Tunai: 120000, QRIS: 130000 });
    // Tagihan tahapnya sendiri tidak menambah laci: uangnya sudah dihitung dari kwitansi.
    expect(result.expected).toBe(220000);
  });

  it("does not treat an applied customer advance as cash received", async () => {
    const db: Db = {
      invoices: [{ id: "tahap-2", total: 50000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" }],
      invoice_payments: [{ invoice_id: "tahap-2", amount: 50000, metode: "Uang Muka", kas_code: "314001", transferred_from: null }],
      clinic_payment_receipts: [],
    };
    const result = await hitungShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(result.breakdown.Tunai).toBe(0);
    expect(result.expected).toBe(100000);
  });

  it("removes a voided receipt from the drawer that gave the money back", async () => {
    const parts = [{ metode: "Tunai", amount: 80000 }];
    const sama: Db = { clinic_payment_receipts: [{ id: "kwt-2", status: "batal", shift_id: "S1", void_shift_id: "S1", clinic_payment_receipt_parts: parts }] };
    expect((await hitungShift(makeClient(sama), shift({ shift_type: "klinik" }))).breakdown.Tunai).toBe(0);

    const lain: Db = { clinic_payment_receipts: [{ id: "kwt-3", status: "batal", shift_id: "S0", void_shift_id: "S1", clinic_payment_receipt_parts: parts }] };
    const hasil = await hitungShift(makeClient(lain), shift({ shift_type: "klinik" }));
    expect(hasil.breakdown.Tunai).toBe(-80000);
    expect(hasil.expected).toBe(20000);
  });

  it("counts original mixed checkout parts separately in the clinic shift", async () => {
    const db: Db = {
      invoices: [{ id: "mixed", total: 1000000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" }],
      invoice_payments: [
        { invoice_id: "mixed", amount: 500000, metode: "Tunai", checkout_payment: true, transferred_from: null },
        { invoice_id: "mixed", amount: 500000, metode: "Transfer", checkout_payment: true, transferred_from: null },
      ],
    };
    const result = await hitungShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(result.expected).toBe(600000);
    expect(result.breakdown.Tunai).toBe(500000);
    expect(result.breakdown.Transfer).toBe(500000);
  });
  it("preserves the original mixed breakdown through transferred reissue credit", async () => {
    const result = await hitungShift(makeClient({
      invoices: [{ id: "reissue", total: 1000000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai", shift_cash_carry: 0 }],
      invoice_payments: [
        { invoice_id: "reissue", amount: 500000, metode: "Tunai", checkout_payment: true, transferred_from: "original" },
        { invoice_id: "reissue", amount: 500000, metode: "Transfer", checkout_payment: true, transferred_from: "original" },
      ],
    }), shift({ shift_type: "klinik" }));
    expect(result.expected).toBe(600000);
    expect(result.breakdown.Transfer).toBe(500000);
  });
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
  it("does not create a shortage receivable or journal when fractional payments match counted cash", async () => {
    const db: Db = {
      sales: [
        { total: 0.2, metode_bayar: "Split", sale_payments: [{ method: "Tunai", amount: 0.1 }, { method: "Transfer", amount: 0.1 }] },
        { total: 0.3, metode_bayar: "Split", sale_payments: [{ method: "Tunai", amount: 0.2 }, { method: "Transfer", amount: 0.1 }] },
      ],
      expenses: [], employees: [{ id: "E1", nama: "Siti" }],
    };
    const result = await tutupShift(makeClient(db), { shift: shift({ opening_balance: 0 }), closing: 0.3 });
    expect(result).toMatchObject({ ok: true, expected: 0.3, selisih: 0, dibebankanKe: null });
    expect(db.cash_advances_inserted ?? []).toHaveLength(0);
    expect(db.journal).toHaveLength(0);
  });

  it("refuses to close when a split sale has no reliable allocation", async () => {
    const db: Db = { sales: [{ total: 100000, metode_bayar: "Split", sale_payments: [] }] };
    const result = await tutupShift(makeClient(db), { shift: shift(), closing: 100000 });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/pembayaran/i) });
    expect(db.journal).toHaveLength(0);
  });

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

  // 31 Okt 2026: "8098098980809" diketik sebagai uang fisik → Rp 8.113 M masuk
  // Pendapatan Lain-lain dan dashboard menampilkan laba triliunan.
  it("menolak uang fisik salah ketik yang membuat kas lebih tidak wajar — tanpa jurnal, shift tetap terbuka", async () => {
    const db: Db = { sales: [], expenses: [] };
    for (const closing of [8_098_098_980_809, 1_000_000_000, 100_000 + 5_000_000.01]) {
      const hasil = await tutupShift(makeClient(db), { shift: shift(), closing });
      expect(hasil).toEqual({ ok: false, error: PESAN_KAS_FISIK_TIDAK_WAJAR });
    }
    expect(db.journal).toHaveLength(0);
  });

  it("menolak kas kurang tidak wajar supaya kasir tidak dibebani kasbon dari salah ketik", async () => {
    const db: Db = { sales: [{ total: 7_053_500, metode_bayar: "Tunai" }], expenses: [], employees: [{ id: "E1", nama: "Siti" }] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 100_000 });
    expect(hasil).toEqual({ ok: false, error: PESAN_KAS_FISIK_TIDAK_WAJAR });
    expect(db.cash_advances_inserted ?? []).toHaveLength(0);
    expect(db.journal).toHaveLength(0);
  });

  it("selisih tepat di batas masih boleh ditutup dan dijurnal", async () => {
    const db: Db = { sales: [], expenses: [] };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 100_000 + BATAS_SELISIH_KAS });
    expect(hasil).toMatchObject({ ok: true, selisih: BATAS_SELISIH_KAS });
    expect(db.journal).toHaveLength(1);
  });

  it("pesan penolakan tidak membocorkan target kas (kasir buta)", () => {
    expect(cekKasFisikWajar(9_999_999, 1_234_567)).toBe(PESAN_KAS_FISIK_TIDAK_WAJAR);
    expect(PESAN_KAS_FISIK_TIDAK_WAJAR).not.toMatch(/\d/);
    expect(cekKasFisikWajar(Number.NaN, 0)).toBe(PESAN_KAS_FISIK_TIDAK_WAJAR);
    expect(cekKasFisikWajar(-1, 0)).toBe(PESAN_KAS_FISIK_TIDAK_WAJAR);
    expect(cekKasFisikWajar(1_300_000, 1_234_567)).toBeNull();
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
    expect(db.cash_advances_inserted![0]).toMatchObject({ employee_id: "E1", shift_id: "S1", status: "Disetujui" });
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

// FIN-09/UF-09: pembacaan uang yang gagal TIDAK boleh menjadi nol. Shift yang ditutup
// dengan target kas terlalu rendah membukukan penerimaan nyata sebagai kas lebih
// (Pendapatan Lain-lain) — uang hilang dari piutang dan tidak pernah ketahuan.
describe("pembacaan uang shift gagal-tertutup", () => {
  const dbKlinik = (): Db => ({
    invoices: [{ id: "tahap-1", total: 300000, dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "Tunai" }],
    invoice_payments: [],
    clinic_payment_receipts: [{
      id: "kwt-1", status: "aktif", shift_id: "S1", void_shift_id: null,
      clinic_payment_receipt_parts: [{ metode: "Tunai", amount: 120000 }],
    }],
  });

  it.each([
    ["clinic_payment_receipts", { code: "PGRST201", message: "embed ambigu" }],
    ["invoices", { code: "57014", message: "statement timeout" }],
    ["invoice_payments", { code: "42501", message: "permission denied" }],
    ["expenses", { code: "57014", message: "statement timeout" }],
  ])("gagal baca %s membatalkan tutup shift klinik", async (tabel, error) => {
    const db = { ...dbKlinik(), gagal: { [tabel]: error } };
    const hasil = await tutupShift(makeClient(db), { shift: shift({ shift_type: "klinik" }), closing: 100_000 });
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.error).toMatch(/belum dapat dibaca lengkap/);
    // Tidak ada jurnal selisih kas yang terlanjur diposting.
    expect(db.journal ?? []).toEqual([]);
  });

  it("tabel kwitansi yang memang belum ada tetap boleh ditutup dengan rumus lama", async () => {
    const db: Db = {
      ...dbKlinik(),
      clinic_payment_receipts: [],
      gagal: { clinic_payment_receipts: { code: "42P01", message: 'relation "clinic_payment_receipts" does not exist' } },
    };
    const hasil = await hitungShift(makeClient(db), shift({ shift_type: "klinik" }));
    expect(hasil.expected).toBe(100_000);
  });

  it("gagal baca penjualan juga menahan tutup shift petshop", async () => {
    const db: Db = { sales: [], gagal: { sales: { code: "57014", message: "statement timeout" } } };
    const hasil = await tutupShift(makeClient(db), { shift: shift(), closing: 100_000 });
    expect(hasil.ok).toBe(false);
    expect(db.journal ?? []).toEqual([]);
  });
});
