import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  filters: [] as { table: string; op: string; args: unknown[] }[],
  counterRows: [] as { condition_status: string; admitted_at: string; discharged_at: string | null }[],
  listRows: [] as Record<string, unknown>[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  errors: [] as string[],
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/operational-branch", () => ({ availableOperationalBranches: async () => [{ id: "b1", code: "K1", name: "Klinik", type: "KLINIK" }] }));
vi.mock("@/lib/inpatient-stay", () => ({ readStayTypes: async () => new Map(), STAY_TYPE_LABEL: { sakit: "Rawat inap", hotel: "Pet hotel" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from(table: string) {
      let counter = false;
      const constraints: [string, unknown[]][] = [];
      let start = 0, end = 999;
      const q = {
        select: (cols: string) => { counter = cols === "condition_status, admitted_at, discharged_at"; return q; },
        eq: (...args: unknown[]) => { state.filters.push({ table, op: "eq", args }); return q; },
        in: (col: string, ids: unknown[]) => { constraints.push([col, ids]); state.filters.push({ table, op: "in", args: [col, ids] }); return q; },
        is: () => q, order: () => q,
        range: (from: number, to: number) => { start = from; end = to; return q; },
        or: (...args: unknown[]) => { state.filters.push({ table, op: "or", args }); return q; },
        then: (resolve: (v: unknown) => unknown) => {
          state.calls.push(table);
          const rows = table === "inpatient_records" ? (counter ? state.counterRows : state.listRows)
            : (state.tables[table] ?? []).filter(row => constraints.every(([col, ids]) => ids.includes(row[col])));
          return Promise.resolve({ data: rows.slice(start, end + 1), error: state.errors.includes(table) ? { code: "42501" } : null }).then(resolve);
        },
      };
      return q;
    },
  }),
}));

import RawatInapPage from "./page";

describe("Status Rawat Inap — kartu penghitung", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00Z")); // 10.00 WIB
    state.filters = [];
    state.counterRows = [];
    state.listRows = [];
  });
  afterEach(() => vi.useRealTimers());

  it("hanya membaca pasien yang masih dirawat atau masuk sejak tengah malam WIB", async () => {
    await RawatInapPage({ searchParams: Promise.resolve({}) });
    expect(state.filters).toContainEqual({ table: "inpatient_records", op: "or", args: ['discharged_at.is.null,admitted_at.gte."2026-10-28T17:00:00.000Z"'] });
  });

  it("menghitung kartu dari baris yang dibaca", async () => {
    state.counterRows = [
      { condition_status: "kritis", admitted_at: "2026-10-20T02:00:00Z", discharged_at: null },
      { condition_status: "sembuh", admitted_at: "2026-10-28T18:00:00Z", discharged_at: null },
      { condition_status: "sembuh", admitted_at: "2026-10-28T20:00:00Z", discharged_at: "2026-10-29T01:00:00Z" },
    ];
    const text = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) })).replace(/<[^>]+>/g, "|");
    const kartu = (label: string) => text.split(label)[1]?.split("|").find(Boolean);
    // Masih dirawat 2, masuk hari ini (WIB) 2, sembuh belum pulang 1, kritis 1.
    expect([kartu("TOTAL RAWAT INAP"), kartu("RAWAT INAP HARI INI"), kartu("SEMBUH / BOLEH PULANG"), kartu("KRITIS")]).toEqual(["2", "2", "1", "1"]);
  });
});

// Tagihan berjalan rawat inap (Andri, 29 Oktober 2026): kasir tidak perlu membuka
// rekam medis dulu untuk menagih tahap berikutnya atau menerima uang.
describe("Status Rawat Inap — kolom tagihan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00Z"));
    state.filters = [];
    state.counterRows = [];
    state.tables = { invoices: [{ id: "inv-1", visit_id: "visit-1", total: 100, dp_amount: 100, paid_status: "DP", voided_at: null, created_at: "2026-10-27" }] };
    state.errors = [];
    state.calls = [];
    state.listRows = [{
      id: "rec-1", visit_id: "visit-1", branch_id: "b1", condition_status: "stabil", admitted_at: "2026-10-27T02:00:00Z",
      discharged_at: null, doctor_name: "drh. A", treatment_plan: "Infus",
      branches: { name: "Klinik" },
      visits: { pets: { name: "Bimo", species: "Kucing", breed: null, dob: null, photo_url: null }, customers: { name: "Reza", phone: "08" } },
    }];
  });
  afterEach(() => vi.useRealTimers());

  it("tagihan terbayar menampilkan Lunas dan tetap membuka riwayat", async () => {
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('>Lunas</span>');
    expect(html).toContain("Lihat tagihan");
    expect(html).toContain("/klinik/pembayaran/visit-1");
  });

  it("menampilkan tombol Bayar tagihan ke layar tagihan rawat inap berjalan", async () => {
    state.tables.invoices[0].dp_amount = 0;
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("/klinik/pembayaran/visit-1");
    expect(html).toContain("Bayar tagihan");
  });

  it("Lunas → item baru → terbit belum lunas → DP → Lunas tanpa mengubah kondisi", async () => {
    const status = async (label: string, action: string) => {
      const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
      expect(html).toContain(`>${label}</span>`);
      expect(html).toContain(action);
      expect(html).toContain('>Stabil</span>');
      expect(html).toContain('/klinik/pembayaran/visit-1');
    };
    await status("Lunas", "Lihat tagihan");
    state.tables.medical_records = [{ id: "mr-1", visit_id: "visit-1" }];
    state.tables.prescription_items = [{ id: "rx-1", medical_record_id: "mr-1" }];
    await status("Belum ditagih", "Buka tagihan");
    state.tables.invoices.push({ id: "inv-2", visit_id: "visit-1", total: 60, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null, created_at: "2026-10-28" });
    state.tables.invoice_items = [{ id: "line-1", invoice_id: "inv-2", prescription_item_id: "rx-1" }];
    await status("Belum lunas", "Bayar tagihan");
    state.tables.invoice_payments = [{ id: "pay-1", invoice_id: "inv-2", amount: 20 }];
    await status("DP", "Bayar tagihan");
    state.tables.invoice_payments.push({ id: "pay-2", invoice_id: "inv-2", amount: 40 });
    await status("Lunas", "Lihat tagihan");
  });

  it("pasien pulang tetap memiliki tautan riwayat tagihan tanpa laporan harian", async () => {
    state.listRows[0].discharged_at = "2026-10-28T03:00:00Z";
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({ filter: "semua", branch: "b1" }) }));
    expect(html).toContain('>Lunas</span>');
    expect(html).toContain("Lihat tagihan");
    expect(html).toContain("/klinik/pembayaran/visit-1");
    expect(html).not.toContain("Isi laporan harian");
    expect(state.filters).toContainEqual({ table: "inpatient_records", op: "in", args: ["branch_id", ["b1"]] });
    expect(state.filters).toContainEqual({ table: "inpatient_records", op: "eq", args: ["branch_id", "b1"] });
    expect(state.filters).toContainEqual({ table: "invoices", op: "in", args: ["visit_id", ["visit-1"]] });
  });

  it("catatan klinis baru saja tidak otomatis menjadi tagihan baru", async () => {
    state.listRows[0].condition_status = "kritis";
    state.listRows[0].treatment_plan = "Catatan pemantauan baru";
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('>Lunas</span>');
    expect(html).toContain('>Kritis</span>');
  });

  it("gagal baca uang tidak pernah tampak Lunas atau saldo nol", async () => {
    state.errors = ["invoice_payments"];
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('>Belum terbaca</span>');
    expect(html).toContain("Buka tagihan");
    expect(html).not.toContain('>Lunas</span>');
  });

  it("kolomnya berdiri sendiri setelah kolom Aksi, tidak menggantikan Detail", async () => {
    const html = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) }));
    expect(html.indexOf("<th>Aksi</th>")).toBeLessThan(html.indexOf("<th>Tagihan</th>"));
    expect(html).toContain("/klinik/rawat-inap/rec-1\"");
    expect(html).toContain("Isi laporan harian");
  });
});
