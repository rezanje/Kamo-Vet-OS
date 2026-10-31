import { describe, expect, it } from "vitest";
import { BILLING_UNREAD, readInpatientBillingStatuses } from "../inpatient-billing-status";

type Row = Record<string, unknown>;
const stay = { visit_id: "visit-a", branch_id: "branch-a" };
const invoice = (extra: Row = {}) => ({ id: "invoice-a", visit_id: stay.visit_id, created_at: "2026-10-01", total: 100, dp_amount: 100, paid_status: "DP", voided_at: null, ...extra });
function fixture(tables: Record<string, Row[]> = {}, errors: string[] = [], throwOn = "") {
  const calls: { table: string; ids: unknown[]; column: string; start: number; end: number; orders: string[]; fields: string }[] = [];
  const db = { from(table: string) {
    let ids: unknown[] = [], column = "", start = 0, end = 999, fields = "";
    const orders: string[] = [];
    const q = {
      select(s: string) { fields = s; return q; },
      in(c: string, values: unknown[]) { column = c; ids = values; return q; },
      order(c: string) { orders.push(c); return q; },
      range(a: number, b: number) { start = a; end = b; return q; },
      then(resolve: (v: unknown) => unknown, reject: (reason: unknown) => unknown) {
        calls.push({ table, ids, column, start, end, orders, fields });
        if (table === throwOn) return Promise.reject(new Error("transport unavailable")).then(resolve, reject);
        const data = (tables[table] ?? []).filter(r => ids.includes(r[column])).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(start, end + 1);
        return Promise.resolve({ data, error: errors.includes(table) ? { code: "42501" } : null }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { db: db as never, calls };
}
const read = async (tables: Record<string, Row[]>, errors: string[] = []) => {
  const f = fixture(tables, errors);
  return (await readInpatientBillingStatuses(f.db, [stay])).get(stay.visit_id) ?? BILLING_UNREAD;
};

describe("inpatient list billing read model", () => {
 it('withdrawn pending billing source does not make a settled visit look unbilled',async()=>{expect((await read({invoices:[invoice()],medical_records:[{id:'medical-a',visit_id:stay.visit_id}],prescription_items:[{id:'rx-withdrawn',medical_record_id:'medical-a',billing_withdrawn_at:'2026-11-03'}]})).label).toBe('Lunas')});
  it.each([
    ["legacy fully paid header", { paid_status: "Lunas", dp_amount: 0 }, [], "Lunas"],
    ["header DP plus allocation", { dp_amount: 30 }, [{ invoice_id: "invoice-a", amount: 70 }], "Lunas"],
    ["header DP partial", { dp_amount: 30 }, [], "DP"],
    ["stale Lunas with reversed receipt", { dp_amount: 0, paid_status: "Lunas" }, [{ invoice_id: "invoice-a", amount: 100 }, { invoice_id: "invoice-a", amount: -100 }], "Belum lunas"],
    ["cancelled header DP", { dp_amount: 30 }, [{ invoice_id: "invoice-a", amount: -30 }], "Belum lunas"],
    ["reissue uses allocations only", { reissued_from: "old", dp_amount: 100 }, [{ invoice_id: "invoice-a", amount: 20 }], "DP"],
  ])("nets %s through the authoritative money helper", async (_name, header, payments, label) => {
    expect((await read({ invoices: [invoice(header as Row)], invoice_payments: payments as Row[] })).label).toBe(label);
  });

  it("unused advance is not a payment against an unpaid invoice", async () => {
    expect((await read({ invoices: [invoice({ dp_amount: 0 })], clinic_customer_advances: [{ amount: 1000, applied: 0, status: "aktif" }] })).label).toBe("Belum lunas");
  });

  it("void reopens prescriptions; completed replacement counts money and links only once", async () => {
    const tables = { invoices: [invoice({ voided_at: "2026-10-02", correction_pending: true })],
      medical_records: [{ id: "medical-a", visit_id: stay.visit_id }], prescription_items: [{ id: "rx-a", medical_record_id: "medical-a" }],
      invoice_items: [{ id: "line-old", invoice_id: "invoice-a", prescription_item_id: "rx-a" }],
      invoice_payments: [{ id: "pay-old", invoice_id: "invoice-a", amount: 100 }] };
    expect((await read(tables)).label).toBe("Belum ditagih");
    const replacement = invoice({ id: "replacement", dp_amount: 0, reissued_from: "invoice-a" });
    expect((await read({ ...tables, invoices: [...tables.invoices, replacement],
      invoice_items: [...tables.invoice_items, { id: "line-new", invoice_id: "replacement", prescription_item_id: "rx-a" }],
      invoice_payments: [...tables.invoice_payments, { id: "pay-new", invoice_id: "replacement", amount: 100 }],
    })).label).toBe("Lunas");
  });

  it("ordinary initial-DP invoice links close old prescription items too", async () => {
    expect((await read({ invoices: [invoice()], medical_records: [{ id: "medical-a", visit_id: stay.visit_id }],
      prescription_items: [{ id: "rx-a", medical_record_id: "medical-a" }],
      invoice_items: [{ id: "line-a", invoice_id: "invoice-a", prescription_item_id: "rx-a" }],
    })).label).toBe("Lunas");
  });

  it.each(["invoices", "medical_records", "prescription_items", "invoice_items", "invoice_payments"])("%s read failure stays unknown", async table => {
    const tables = { invoices: [invoice()], medical_records: [{ id: "medical-a", visit_id: stay.visit_id }] };
    expect(await read(tables, [table])).toEqual(BILLING_UNREAD);
    const f = fixture(tables, [], table);
    expect((await readInpatientBillingStatuses(f.db, [stay])).size).toBe(0);
  });

  it("empty lists make no financial queries", async () => {
    const f = fixture();
    expect((await readInpatientBillingStatuses(f.db, [])).size).toBe(0);
    expect(f.calls).toEqual([]);
  });

  it("keeps two visits isolated and never requests unrelated visit data", async () => {
    const second = { visit_id: "visit-b", branch_id: "branch-b" };
    const f = fixture({ invoices: [invoice(), invoice({ id: "invoice-b", visit_id: second.visit_id, dp_amount: 0 }), invoice({ id: "secret", visit_id: "outside" })],
      medical_records: [{ id: "medical-a", visit_id: stay.visit_id }, { id: "medical-b", visit_id: second.visit_id }],
      prescription_items: [{ id: "rx-b", medical_record_id: "medical-b" }],
      invoice_payments: [{ id: "pay-secret", invoice_id: "secret", amount: 10000 }],
    });
    const result = await readInpatientBillingStatuses(f.db, [stay, second]);
    expect(result.get(stay.visit_id)?.label).toBe("Lunas");
    expect(result.get(second.visit_id)?.label).toBe("Belum ditagih");
    expect(result.has("outside")).toBe(false);
    expect(f.calls.every(c => !c.ids.includes("outside") && !c.ids.includes("secret"))).toBe(true);
  });

  it("all medical-record and invoice pages are read, including a late unpaid stage", async () => {
    const records = Array.from({ length: 1001 }, (_, n) => ({ id: `medical-${String(n).padStart(4, "0")}`, visit_id: stay.visit_id }));
    const invoices = Array.from({ length: 1001 }, (_, n) => invoice({ id: `invoice-${String(n).padStart(4, "0")}`, dp_amount: n === 1000 ? 0 : 100 }));
    const f = fixture({ invoices, medical_records: records });
    expect((await readInpatientBillingStatuses(f.db, [stay])).get(stay.visit_id)?.label).toBe("Belum lunas");
    expect(f.calls.filter(c => c.table === "invoices")).toHaveLength(3);
    expect(f.calls.filter(c => c.table === "medical_records")).toHaveLength(3);
    expect(f.calls.filter(c => c.table === "invoice_payments")).toHaveLength(21);
    expect(f.calls.filter(c => c.table === "prescription_items")).toHaveLength(21);
  });

  it("all payment pages include a late negative reversal", async () => {
    const payments = Array.from({ length: 1000 }, (_, n) => ({ id: `pay-${String(n).padStart(4, "0")}`, invoice_id: "invoice-a", amount: 1 }));
    payments.push({ id: "pay-9999", invoice_id: "invoice-a", amount: -1000 });
    expect((await read({ invoices: [invoice({ total: 1000, dp_amount: 0, paid_status: "Lunas" })], invoice_payments: payments })).label).toBe("Belum lunas");
  });

  it("correction pending is attention, never Lunas even at zero balance", async () => {
    expect((await read({ invoices: [invoice({ correction_pending: true })] })).label).toBe("Koreksi tagihan");
  });
  it("reads past 1000 rows: the last new prescription must reopen billing", async () => {
    const rx = Array.from({ length: 1001 }, (_, n) => ({ id: `rx-${String(n).padStart(4, "0")}`, medical_record_id: "medical-a" }));
    const f = fixture({ invoices: [invoice()], medical_records: [{ id: "medical-a", visit_id: stay.visit_id }], prescription_items: rx,
      invoice_items: rx.slice(0, 1000).map(r => ({ id: `line-${r.id}`, invoice_id: "invoice-a", prescription_item_id: r.id })) });
    expect((await readInpatientBillingStatuses(f.db, [stay])).get(stay.visit_id)?.label).toBe("Belum ditagih");
    expect(f.calls.filter(c => c.table === "prescription_items").length).toBeGreaterThan(1);
    expect(f.calls.every(c => c.orders.includes("id") && c.end - c.start < 1000)).toBe(true);
  });

  it("chunks scoped visit IDs instead of querying per patient or making long URLs", async () => {
    const stays = Array.from({ length: 121 }, (_, n) => ({ visit_id: `visit-${n}`, branch_id: "branch-a" }));
    const f = fixture({ invoices: stays.map((s, n) => invoice({ id: `invoice-${n}`, visit_id: s.visit_id })) });
    const result = await readInpatientBillingStatuses(f.db, stays);
    expect(result.size).toBe(121);
    expect(f.calls.every(c => c.ids.length <= 50)).toBe(true);
    expect(f.calls.filter(c => c.table === "invoices")).toHaveLength(3);
    expect(f.calls.length).toBeLessThan(stays.length);
    expect(new Set(f.calls.filter(c => c.table === "invoices").flatMap(c => c.ids))).toEqual(new Set(stays.map(s => s.visit_id)));
  });

  it("zero-valued invoices do not prevent a real positive settled invoice being Lunas", async () => {
    expect((await read({ invoices: [invoice(), invoice({ id: "zero", total: 0, dp_amount: 0 })] })).label).toBe("Lunas");
  });

  it("no invoice or zero-only invoice is not a paid stay", async () => {
    expect((await read({})).label).toBe("Belum ada tagihan");
    expect((await read({ invoices: [invoice({ total: 0, dp_amount: 0 })] })).label).toBe("Belum ada tagihan");
  });
});
