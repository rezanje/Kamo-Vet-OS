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
        maybeSingle: () => {
          state.calls.push(table);
          const rows = state.tables[table] ?? [];
          return Promise.resolve({ data: rows[0] ?? null, error: state.errors.includes(table) ? { code: "42501" } : null });
        },
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


// Daftar rawat inap: lunas-belum-pulang, edit catatan terlihat, kepatuhan laporan harian
// (laporan 6 Nov 2026). Hanya baca; tidak ada pemulangan otomatis.
describe("Status Rawat Inap — lunas belum pulang & laporan harian", () => {
  const rec = (id: string, visit: string, pet: string, extra: Record<string, unknown> = {}) => ({
    id, visit_id: visit, branch_id: "b1", condition_status: "stabil", admitted_at: "2026-11-01T02:00:00Z",
    discharged_at: null, doctor_name: "drh. A", treatment_plan: "Infus", branches: { name: "Klinik" },
    visits: { pets: { name: pet, species: "Kucing", breed: null, dob: null, photo_url: null }, customers: { name: "Reza", phone: "08" } },
    ...extra,
  });
  const lunasInv = (visit: string) => ({ id: `inv-${visit}`, visit_id: visit, total: 100, dp_amount: 100, paid_status: "DP", voided_at: null, created_at: "2026-11-01" });
  const render = async (searchParams: Record<string, string> = {}) =>
    renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve(searchParams) }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z")); // 10.00 WIB, 6 Nov
    state.filters = [];
    state.counterRows = [];
    state.errors = [];
    state.calls = [];
    state.tables = { profiles: [{ role: "OWNER" }], invoices: [lunasInv("v1")], inpatient_daily_logs: [] };
    state.listRows = [rec("rec-1", "v1", "Bimo")];
  });
  afterEach(() => vi.useRealTimers());

  it("pasien aktif dengan tagihan Lunas: badge + tombol Pulangkan ke Ubah Kondisi (tanpa memulangkan otomatis)", async () => {
    const html = await render();
    expect(html).toContain("Lunas, belum dipulangkan");
    expect(html).toContain('href="/klinik/rawat-inap/rec-1#ubah-kondisi"');
    expect(html).toContain("Pulangkan");
    // Tidak menyentuh jalur pemulangan: tidak ada RPC / tabel status yang dibaca.
    expect(state.calls).not.toContain("inpatient_status_log");
  });

  it("tagihan DP / belum lunas / belum ada tagihan tidak mendapat badge maupun Pulangkan", async () => {
    state.tables.invoices[0].dp_amount = 0;
    state.tables.invoices[0].paid_status = "Belum Lunas";
    expect(await render()).not.toContain("Lunas, belum dipulangkan");
    state.tables.invoices = [];
    const html = await render();
    expect(html).not.toContain("Lunas, belum dipulangkan");
    expect(html).not.toContain("Pulangkan");
  });

  it("pasien yang sudah pulang tidak pernah diberi badge/tombol walau Lunas", async () => {
    state.listRows = [rec("rec-1", "v1", "Bimo", { discharged_at: "2026-11-05T03:00:00Z" })];
    const html = await render({ filter: "semua" });
    expect(html).toContain(">Lunas</span>");
    expect(html).not.toContain("Lunas, belum dipulangkan");
    expect(html).not.toContain("Pulangkan");
  });

  it("gagal baca tagihan tidak memunculkan badge lunas belum pulang", async () => {
    state.errors = ["invoice_payments"];
    state.tables.invoice_payments = [];
    expect(await render()).not.toContain("Lunas, belum dipulangkan");
  });

  it("chip filter 'Lunas belum pulang' ada, aktif saat dipilih, dan hanya menampilkan baris lunas aktif", async () => {
    state.listRows = [rec("rec-1", "v1", "Bimo"), rec("rec-2", "v2", "Mimi")];
    state.tables.invoices = [lunasInv("v1"), { ...lunasInv("v2"), dp_amount: 0, paid_status: "Belum Lunas" }];
    const html = await render({ filter: "lunas_belum_pulang" });
    expect(html).toContain("filter=lunas_belum_pulang");
    expect(html).toContain("Lunas belum pulang");
    const tabel = html.slice(html.indexOf("<tbody>"));
    expect(tabel).toContain("Bimo");
    expect(tabel).not.toContain("Mimi"); // (ringkasan Laporan tertinggal di atas tabel tidak ikut disaring)
    expect(state.filters.some((f) => f.table === "inpatient_records" && f.op === "in")).toBe(true);
  });

  it("filter aktif/lunas membaca hanya yang belum pulang (discharged_at is null) dan menjelaskan di mana pasien pulang", async () => {
    const html = await render();
    expect(html).toContain("Pasien yang sudah dipulangkan tidak tampil di sini; lihat tab Semua/Pulang");
    expect(await render({ filter: "semua" })).not.toContain("Pasien yang sudah dipulangkan tidak tampil di sini");
  });

  it("tautan ke detail berlabel 'Lihat / Edit' dengan tooltip untuk pasien aktif", async () => {
    const html = await render();
    expect(html).toContain('title="Lihat / Edit catatan harian"');
    expect(html).toContain("Lihat / Edit");
  });

  it("pasien pulang: tautan tetap 'Lihat detail' (edit sudah terkunci), tidak menjanjikan Edit", async () => {
    state.listRows = [rec("rec-1", "v1", "Bimo", { discharged_at: "2026-11-05T03:00:00Z" })];
    const html = await render({ filter: "semua" });
    expect(html).toContain("Lihat detail");
    expect(html).not.toContain("Lihat / Edit");
  });

  it("badge laporan hari ini: belum", async () => {
    expect(await render()).toContain("Laporan hari ini: belum");
  });

  it("badge laporan hari ini: ada (n) menurut tanggal WIB", async () => {
    state.tables.inpatient_daily_logs = [
      { inpatient_record_id: "rec-1", log_date: "2026-11-06", created_at: "2026-11-06T01:00:00Z" },
      { inpatient_record_id: "rec-1", log_date: "2026-11-06", created_at: "2026-11-06T02:00:00Z" },
      { inpatient_record_id: "rec-1", log_date: "2026-11-05", created_at: "2026-11-05T02:00:00Z" },
    ];
    const html = await render();
    expect(html).toContain("Laporan hari ini: ada (2)");
    expect(html).not.toContain("Laporan hari ini: belum");
  });

  it("batas WIB: 23.59 masih hari ini, 00.00 sudah hari baru", async () => {
    state.tables.inpatient_daily_logs = [{ inpatient_record_id: "rec-1", log_date: "2026-11-06", created_at: "2026-11-06T16:00:00Z" }];
    vi.setSystemTime(new Date("2026-11-06T16:59:00Z"));
    expect(await render()).toContain("Laporan hari ini: ada (1)");
    vi.setSystemTime(new Date("2026-11-06T17:00:00Z")); // 00.00 WIB 7 Nov
    expect(await render()).toContain("Laporan hari ini: belum");
  });

  it("pasien pulang tidak diberi badge laporan hari ini", async () => {
    state.listRows = [rec("rec-1", "v1", "Bimo", { discharged_at: "2026-11-05T03:00:00Z" })];
    expect(await render({ filter: "semua" })).not.toContain("Laporan hari ini");
  });

  it("OWNER melihat ringkasan 'Laporan tertinggal' dengan jumlah hari sejak laporan terakhir (>1 hari)", async () => {
    state.listRows = [rec("rec-1", "v1", "Bimo"), rec("rec-2", "v2", "Mimi"), rec("rec-3", "v3", "Coco")];
    state.tables.inpatient_daily_logs = [
      { inpatient_record_id: "rec-1", log_date: "2026-11-06", created_at: "2026-11-06T01:00:00Z" },
      { inpatient_record_id: "rec-2", log_date: "2026-11-05", created_at: "2026-11-05T01:00:00Z" },
      { inpatient_record_id: "rec-3", log_date: "2026-11-03", created_at: "2026-11-03T01:00:00Z" },
    ];
    const html = await render();
    expect(html).toContain("Laporan tertinggal");
    const ringkasan = html.slice(html.indexOf('data-testid="laporan-tertinggal"'));
    expect(ringkasan).toContain("Mimi");
    expect(ringkasan).toContain("Coco");
    expect(ringkasan).toContain("3 hari");
    expect(ringkasan.split("</section>")[0]).not.toContain("Bimo");
    // Mimi tertinggal tepat 1 hari: tidak ditulis "1 hari sejak".
    expect(ringkasan.split("</section>")[0]).not.toContain("1 hari");
  });

  it("ADMIN juga melihat ringkasan; DOCTOR / kasir / tanpa peran tidak", async () => {
    state.tables.profiles = [{ role: "ADMIN" }];
    expect(await render()).toContain('data-testid="laporan-tertinggal"');
    for (const role of ["DOCTOR", "KASIR", "FINANCE"]) {
      state.tables.profiles = [{ role }];
      const html = await render();
      expect(html).not.toContain('data-testid="laporan-tertinggal"');
      expect(html).toContain("Laporan hari ini: belum"); // badge per pasien tetap terlihat
    }
    state.tables.profiles = [];
    expect(await render()).not.toContain('data-testid="laporan-tertinggal"');
  });

  it("semua pasien sudah lapor → tidak ada ringkasan tertinggal", async () => {
    state.tables.inpatient_daily_logs = [{ inpatient_record_id: "rec-1", log_date: "2026-11-06", created_at: "2026-11-06T01:00:00Z" }];
    expect(await render()).not.toContain('data-testid="laporan-tertinggal"');
  });

  it("tanpa N+1: 3 pasien aktif → inpatient_daily_logs dibaca tepat satu kali", async () => {
    state.listRows = [rec("rec-1", "v1", "A"), rec("rec-2", "v2", "B"), rec("rec-3", "v3", "C")];
    await render();
    expect(state.calls.filter((t) => t === "inpatient_daily_logs")).toHaveLength(1);
    expect(state.filters).toContainEqual({ table: "inpatient_daily_logs", op: "in", args: ["inpatient_record_id", ["rec-1", "rec-2", "rec-3"]] });
  });

  it("hanya pasien aktif yang dibaca lognya; daftar semua-pulang tidak membaca log sama sekali", async () => {
    state.listRows = [rec("rec-1", "v1", "A", { discharged_at: "2026-11-05T03:00:00Z" })];
    await render({ filter: "semua" });
    expect(state.calls).not.toContain("inpatient_daily_logs");
  });

  it("gagal baca log → 'tidak terbaca', tidak menuduh 'belum' dan tidak membuat ringkasan palsu", async () => {
    state.errors = ["inpatient_daily_logs"];
    const html = await render();
    expect(html).toContain("Laporan hari ini: tidak terbaca");
    expect(html).not.toContain("Laporan hari ini: belum");
    expect(html).not.toContain('data-testid="laporan-tertinggal"');
  });
});
