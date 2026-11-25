/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { collectDashboard, loadSalesDocuments } from "../operation-sales-server";
import { groomingPerCabang } from "../perbandingan-cabang-server";
import { collectOperationalClinic } from "../operasional-klinik-server";
import { bikinKlienOperasional, rpcOperasionalTiruan } from "./fixtures/klien-operasional-penjualan";

// Jalur cepat (fungsi database laporan_operasional_penjualan) harus menghasilkan data dashboard IDENTIK dengan jalur lama
// (halaman PostgREST) atas baris yang sama. Fungsi database ditiru terpisah di fixtures/klien-operasional-penjualan.ts.

type Row = Record<string, any>;
function acak(seed: number) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

const BRANCHES = [{ id: "b1", name: "Cabang Satu", is_active: true }, { id: "b2", name: "Cabang Dua", is_active: true }, { id: "b3", name: "Cabang Tiga", is_active: true }];
const pad = (n: number, w = 5) => String(n).padStart(w, "0");

function bikinTabel(seed: number): Record<string, Row[]> {
  const r = acak(seed);
  const pilih = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const hari = (awal = "2026-09-20", akhir = "2026-11-24") => {
    const a = Date.parse(`${awal}T00:00:00Z`), z = Date.parse(`${akhir}T00:00:00Z`);
    return new Date(a + Math.floor(r() * ((z - a) / 86_400_000 + 1)) * 86_400_000 + Math.floor(r() * 86_400_000));
  };
  const iso = (d: Date) => d.toISOString().replace(".000Z", "+00:00");
  const tgl = (d: Date) => d.toISOString().slice(0, 10);
  const uang = (a: number, b: number) => Math.round((a + r() * (b - a)) * 100) / 100;
  const items = Array.from({ length: 16 }, (_, i) => ({ id: `item-${pad(i)}`, min_stock: pilih([0, 3, 8, 15.5]), is_active: r() < 0.85, item_type: pilih(["Persediaan", "Jasa"]), tindakan_kategori: pilih([null, "Grooming", "Konsultasi"]) }));
  const warehouses = [
    { id: "w01", branch_id: "b1", type: "RETAIL", is_active: true }, { id: "w02", branch_id: "b1", type: "VET", is_active: true },
    { id: "w03", branch_id: "b2", type: "RETAIL", is_active: true }, { id: "w04", branch_id: "b2", type: "ONLINE", is_active: false },
    { id: "w05", branch_id: "b3", type: "DC", is_active: true }, { id: "w06", branch_id: "b3", type: "VET", is_active: true },
  ];
  const stock = warehouses.flatMap((w, wi) => items.slice(0, 11).map((it, ii) => ({
    id: `st-${pad(wi * 20 + ii)}`, warehouse_id: w.id, item_id: it.id, qty: pilih([-2, 0, 4.5, 12, 40.25, uang(1, 30)]),
    updated_at: iso(hari("2026-08-01", "2026-12-10")), average_cost: pilih([null, uang(500, 90000)]),
  })));
  const layers = warehouses.flatMap((w, wi) => items.slice(0, 8).map((it, ii) => ({ id: `ly-${pad(wi * 20 + ii)}`, warehouse_id: w.id, item_id: it.id, qty_left: pilih([0, 2, 7.5, uang(0.1, 20)]), unit_cost: uang(100, 40000) })));
  const moves = warehouses.flatMap((w, wi) => Array.from({ length: 24 }, (_, k) => ({
    id: `mv-${pad(wi * 100 + k)}`, warehouse_id: w.id, item_id: pilih(items).id, tanggal: tgl(hari("2026-09-01", "2026-11-30")),
    qty: pilih([-5, -1.5, -0.25, 3, 10, 0]), unit_cost: uang(100, 9000), valuation_adjustment: pilih([null, 0, uang(-40, 40)]),
  })));
  const sales = Array.from({ length: 90 }, (_, i) => {
    const plan = pilih([null, null, null, [{ method: "Tunai", amount: 1 }], null]);
    const d = iso(hari());
    return {
      id: `sale-${pad(i)}`, branch_id: pilih(["b1", "b1", "b2", "b3", "bx"]), customer_id: pilih(["c1", "c2", "c3", "c4", "c5", "c6", null]),
      total: uang(20000, 900000), merchant_fee_total: pilih([null, 0, uang(100, 9000)]), channel: pilih([null, null, null, "shopee"]), created_at: d,
      payment_plan: plan, payments_finalized_at: plan && r() < 0.5 ? d : null, voided_at: r() < 0.08 ? d : null,
      sale_items: Array.from({ length: Math.floor(r() * 4) }, () => { const it = pilih(items); return { item_id: pilih([it.id, null]), qty: pilih([1, 2, 0.5, uang(0.2, 5)]), hpp: pilih([null, uang(100, 30000)]), harga: uang(1000, 300000), items: pilih([{ item_type: it.item_type, tindakan_kategori: it.tindakan_kategori }, null]) }; }),
    };
  });
  const sales_returns = sales.filter(() => r() < 0.2).map((s, i) => ({ id: `ret-${pad(i)}`, sale_id: s.id, total: uang(1000, 60000), voided_at: r() < 0.3 ? s.created_at : null }));
  const visits = Array.from({ length: 70 }, (_, i) => {
    const d = hari(); const lahir = iso(d);
    return { id: `vis-${pad(i)}`, branch_id: pilih(["b1", "b2", "b3", "bx"]), customer_id: pilih(["c1", "c2", "c3", "c7"]), poli: pilih(["Umum", "Grooming", "grooming kucing", "Bedah"]), status: pilih(["Selesai", "Menunggu", "Diperiksa"]),
      created_at: lahir, archived_at: r() < 0.1 ? lahir : null, checked_in_at: lahir, service_started_at: pilih([null, iso(new Date(d.getTime() + 600_000))]), service_finished_at: pilih([null, iso(new Date(d.getTime() + 2_400_000))]), checked_out_at: pilih([null, iso(new Date(d.getTime() + 3_000_000))]) };
  });
  const invoices = visits.filter(() => r() < 0.7).map((v, i) => {
    const d = iso(hari());
    return { id: `inv-${pad(i)}`, visit_id: v.id, total: uang(30000, 800000), created_at: d, voided_at: r() < 0.08 ? d : null,
      visits: { branch_id: v.branch_id, customer_id: v.customer_id },
      invoice_items: Array.from({ length: Math.floor(r() * 4) }, () => ({ item_id: pilih([pilih(items).id, null]), qty: pilih([1, 2]), hpp: pilih([null, uang(100, 20000)]), harga: uang(5000, 200000), jenis: pilih(["jasa", "obat"]) })) };
  });
  const clinic_refunds = invoices.filter(() => r() < 0.2).map((v, i) => ({ id: `ref-${pad(i)}`, invoice_id: v.id, total: uang(1000, 30000) }));
  const sales_invoices = Array.from({ length: 14 }, (_, i) => ({
    id: `fak-${pad(i)}`, branch_id: pilih(["b1", "b2", "b3"]), customer_id: pilih(["c1", "c8", null]), dpp: uang(100000, 5000000), tanggal: tgl(hari()), status: pilih(["berjalan", "lunas", "batal"]),
    opening_batch_id: pilih([null, null, null, "ob1"]),
    sales_invoice_items: Array.from({ length: Math.floor(r() * 3) }, () => ({ item_id: pilih([pilih(items).id, null]), qty: pilih([1, 4, 10]), harga: uang(1000, 90000) })),
  }));
  const sale_items = sales.flatMap((s) => s.sale_items.map((l, k) => ({ id: `${s.id}-l${k}`, qty: l.qty, sales: { created_at: s.created_at, voided_at: s.voided_at, branch_id: s.branch_id }, items: l.items ?? { item_type: "Persediaan", tindakan_kategori: null } })));
  const bookings = Array.from({ length: 12 }, (_, i) => ({ id: `bk-${pad(i)}`, branch_id: pilih(["b1", "b2", "b3"]), status: pilih(["Menunggu", "Selesai"]), attendance_outcome: pilih(["hadir", "no_show", "pending", null]), tanggal: tgl(hari()) }));
  const follow_ups = Array.from({ length: 20 }, (_, i) => ({ id: `fu-${pad(i)}`, branch_id: pilih(["b1", "b2", "b3"]), status: pilih(["pending", "done"]), tanggal: tgl(hari()), completed_at: pilih([null, iso(hari())]) }));
  const visit_referrals = Array.from({ length: 6 }, (_, i) => ({ id: `rf-${pad(i)}`, branch_id: pilih(["b1", "b2"]), direction: pilih(["in", "out"]), referred_at: iso(hari()) }));
  const inpatient_records = Array.from({ length: 8 }, (_, i) => ({ id: `ip-${pad(i)}`, branch_id: pilih(["b1", "b2", "b3"]), admitted_at: iso(hari()), discharged_at: pilih([null, iso(hari())]) }));
  const branch_capacity_periods = ["b1", "b2", "b3"].flatMap((b, i) => [{ id: `kp-${i}a`, branch_id: b, capacity: 5, valid_from: "2026-01-01", valid_until: "2026-10-14" }, { id: `kp-${i}b`, branch_id: b, capacity: 8, valid_from: "2026-10-15", valid_until: null }]);
  return {
    items, warehouses, stock, stock_layers: layers, stock_moves: moves, return_record_effective_stock_moves: moves, sales, sales_returns, visits, invoices, clinic_refunds, sales_invoices, sale_items,
    bookings, follow_ups, visit_referrals, inpatient_records, branch_capacity_periods,
  };
}

const FILTER_UJI = [
  { from: "2026-11-01", to: "2026-11-24", channel: "all", branchIds: [] as string[] },
  { from: "2026-11-01", to: "2026-11-24", channel: "pos", branchIds: [] },
  { from: "2026-11-01", to: "2026-11-24", channel: "online", branchIds: [] },
  { from: "2026-11-01", to: "2026-11-24", channel: "klinik", branchIds: [] },
  { from: "2026-11-01", to: "2026-11-24", channel: "reseller", branchIds: [] },
  { from: "2026-10-01", to: "2026-10-31", channel: "all", branchIds: [] },
  { from: "2026-11-10", to: "2026-11-10", channel: "all", branchIds: [] },
  { from: "2026-11-01", to: "2026-11-24", channel: "all", branchIds: ["b1"] },
  { from: "2026-11-01", to: "2026-11-24", channel: "pos", branchIds: ["b2"] },
  { from: "2026-10-05", to: "2026-11-20", channel: "all", branchIds: ["b1", "b3"] },
  { from: "2026-09-21", to: "2026-11-24", channel: "all", branchIds: [] },        // > 31 hari: dipecah jadi beberapa jendela
  { from: "2026-09-20", to: "2026-11-30", channel: "klinik", branchIds: ["b2"] },
  { from: "2026-08-01", to: "2026-12-31", channel: "all", branchIds: [] },        // 5 bulan, 5 jendela
  { from: "2026-12-01", to: "2026-12-05", channel: "all", branchIds: [] },        // tanpa data
] as const;

const sidik = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? { __map: [...x.entries()] } : x));
const blok = (d: any) => ({ sales: d.sales, branch: d.branch, customer: d.customer, stock: d.stock, clinic: d.clinic, comparison: d.comparison, stockValue: d.stockValue });

describe("Operation & Sales: jalur cepat == jalur lama", () => {
  for (const seed of [11, 4242]) {
    const tables = bikinTabel(seed);
    for (const [indeks, filter] of FILTER_UJI.entries()) {
      it(`seed ${seed} filter ${indeks + 1}: ${filter.channel} ${filter.from}..${filter.to} ${filter.branchIds.join(",") || "semua cabang"}`, async () => {
        const lama = bikinKlienOperasional({ tables, branches: BRANCHES });
        const cepat = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: rpcOperasionalTiruan(tables) });
        const f = { ...filter, branchIds: [...filter.branchIds] } as any;
        const [dLama, dCepat] = await Promise.all([collectDashboard(lama, f, { includeStockValue: true }), collectDashboard(cepat, f, { includeStockValue: true })]);
        for (const k of ["sales", "branch", "customer", "stock", "clinic", "comparison", "stockValue"] as const) {
          expect((dLama as any)[k].status, `${k} lama`).toBe("ready");
          expect(sidik((dCepat as any)[k]), k).toBe(sidik((dLama as any)[k]));
        }
        expect(sidik(blok(dCepat))).toBe(sidik(blok(dLama)));
        // jalur cepat benar-benar dipakai: tidak ada pembacaan tabel besar, hanya fungsi
        const dibaca = new Set(cepat.rekaman.map((x) => x.table));
        for (const t of ["sales", "sale_items", "sales_returns", "invoices", "clinic_refunds", "sales_invoices", "stock", "return_record_effective_stock_moves", "stock_layers", "stock_moves", "visits", "follow_ups", "inpatient_records", "bookings"]) {
          expect(dibaca.has(t), `jalur cepat masih membaca ${t}`).toBe(false);
        }
        expect(cepat.panggilan.filter((p) => p.name === "laporan_operasional_penjualan").length).toBeGreaterThanOrEqual(6);
        // data fixture memang berisi: penjualan dan klinik tidak kosong untuk rentang yang berdata
        if (indeks === 0) {
          expect((dLama.sales as any).data.metrics.transactions).toBeGreaterThan(5);
          expect((dLama.customer as any).data.totalCustomers).toBeGreaterThan(2);
          expect((dLama.clinic as any).data.branches.length).toBeGreaterThan(0);
        }
      }, 30_000);
    }
  }

  it("jendela 31 hari: rentang panjang dipecah dan digabung urut id sama dengan jalur lama", async () => {
    const tables = bikinTabel(77);
    const cepat = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: rpcOperasionalTiruan(tables) });
    const lama = bikinKlienOperasional({ tables, branches: BRANCHES });
    const scope = { branchIds: ["b1", "b2", "b3"], branches: BRANCHES };
    const f = { from: "2026-08-01", to: "2026-12-31", branchIds: [], channel: "all" } as const;
    const a = await loadSalesDocuments(cepat, scope, f);
    const b = await loadSalesDocuments(lama, scope, f);
    expect(sidik(a.documents)).toBe(sidik(b.documents));
    const dok = cepat.panggilan.filter((p) => p.args.p_bagian === "dokumen");
    expect(dok.length).toBe(5);                                    // 31+31+31+30+31 hari = 5 jendela
    expect(dok[0].args.p_mulai).toBe("2026-08-01T00:00:00+07:00");
    expect(dok.at(-1)!.args.p_akhir).toBe("2026-12-31T23:59:59.999999+07:00");
    expect(a.documents.length).toBeGreaterThan(30);
  });

  it("argumen fungsi: cabang scope, batas WIB persis seperti pembaca lama, kanal", async () => {
    const tables = bikinTabel(5);
    const cepat = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: rpcOperasionalTiruan(tables) });
    await collectDashboard(cepat, { from: "2026-11-01", to: "2026-11-24", branchIds: ["b2"], channel: "pos" }, { includeStockValue: true });
    const semua = cepat.panggilan.filter((p) => p.name === "laporan_operasional_penjualan").map((p) => p.args);
    const per = Object.fromEntries(semua.map((a) => [a.p_bagian, a]));
    expect(new Set(semua.map((a) => a.p_bagian))).toEqual(new Set(["dokumen", "grooming", "klinik", "nilai_stok", "pelanggan", "stok"]));
    // kanal "pos" membaca dokumen kanal pos (blok sales) dan dokumen semua kanal (perbandingan), untuk periode ini dan pembanding
    expect(semua.filter((a) => a.p_bagian === "dokumen").map((a) => `${a.p_kanal}@${a.p_dari}`).sort()).toEqual(["all@2026-10-01", "all@2026-11-01", "pos@2026-11-01"]);
    for (const a of semua) expect(a.p_cabang).toEqual(["b2"]);
    expect(per.pelanggan).toMatchObject({ p_mulai: "2026-11-01T00:00:00+07:00", p_akhir: "2026-11-24T23:59:59.999999+07:00", p_dari: "2026-11-01", p_sampai: "2026-11-24" });
    expect(per.klinik).toMatchObject({ p_mulai: "2026-11-01T00:00:00+07:00", p_akhir: "2026-11-24T23:59:59.999+07:00" });
    expect(per.stok.p_dari).toBe("2026-11-01");
    expect(per.nilai_stok).toMatchObject({ p_dari: "2026-11-24", p_sampai: "2026-10-24", p_rata_rata: false });
  });

  it("fungsi belum ada (PGRST202) atau melewati batas waktu (57014): pembaca lama dipakai dan hasilnya sama", async () => {
    const tables = bikinTabel(9);
    const f = { from: "2026-11-01", to: "2026-11-24", branchIds: [], channel: "all" } as const;
    const lama = await collectDashboard(bikinKlienOperasional({ tables, branches: BRANCHES }), { ...f, branchIds: [] }, { includeStockValue: true });
    const waktu = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
    const hasil = await collectDashboard(waktu, { ...f, branchIds: [] }, { includeStockValue: true });
    expect(sidik(blok(hasil))).toBe(sidik(blok(lama)));
    expect(waktu.rekaman.some((x) => x.table === "sales")).toBe(true);
    // bukan objek (klien tiruan generik yang menjawab `true` untuk RPC apa pun) = bukan fungsi ini: pembaca lama
    const generik = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: () => ({ data: true }) });
    expect(sidik(blok(await collectDashboard(generik, { ...f, branchIds: [] }, { includeStockValue: true })))).toBe(sidik(blok(lama)));
  });

  it("galat lain (izin 42501, Admin Online) TIDAK jatuh ke jalur lama: blok jadi galat", async () => {
    const tables = bikinTabel(9);
    const f = { from: "2026-11-01", to: "2026-11-24", branchIds: [], channel: "all" } as const;
    const ditolak = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: () => ({ error: { code: "42501", message: "ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia untuk peran Admin Online" } }) });
    const hasil = await collectDashboard(ditolak, { ...f, branchIds: [] }, { includeStockValue: true });
    for (const k of ["sales", "branch", "customer", "stock", "comparison", "stockValue", "clinic"] as const) expect((hasil as any)[k].status, k).toBe("error");
    expect(ditolak.rekaman.some((x) => ["sales", "stock", "visits"].includes(x.table))).toBe(false);
  });

  it("jawaban tidak lengkap (hitungan tidak cocok / larik hilang) = galat baca, bukan angka yang lebih kecil", async () => {
    const tables = bikinTabel(9);
    const f = { from: "2026-11-01", to: "2026-11-24", branchIds: [], channel: "all" } as const;
    const asli = rpcOperasionalTiruan(tables);
    const rusak = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: (a) => {
      const h: any = asli(a);
      if (a.p_bagian === "pelanggan") h.data.n = h.data.n + 1;
      if (a.p_bagian === "stok") delete h.data.mutasi;
      if (a.p_bagian === "klinik") h.data.n_visits = -1;
      return h;
    } });
    const hasil = await collectDashboard(rusak, { ...f, branchIds: [] }, { includeStockValue: false });
    expect(hasil.customer.status).toBe("error");
    expect(hasil.stock.status).toBe("error");
    expect(hasil.clinic.status).toBe("error");
    expect(hasil.sales.status).toBe("ready");
  });

  it("grooming dan klinik langsung: jalur cepat == jalur lama (struk batal, kunjungan diarsipkan, poli huruf besar)", async () => {
    const tables = bikinTabel(31);
    const scope = { branchIds: ["b1", "b2", "b3"], branches: BRANCHES };
    const lamaK = bikinKlienOperasional({ tables, branches: BRANCHES });
    const cepatK = bikinKlienOperasional({ tables, branches: BRANCHES, rpcOperasional: rpcOperasionalTiruan(tables) });
    expect([...(await groomingPerCabang(cepatK, scope, "2026-10-01", "2026-11-24"))]).toEqual([...(await groomingPerCabang(lamaK, scope, "2026-10-01", "2026-11-24"))]);
    const a = await collectOperationalClinic(cepatK, { from: "2026-10-01", to: "2026-11-24", branchIds: ["b1", "b2", "b3"] });
    const b = await collectOperationalClinic(lamaK, { from: "2026-10-01", to: "2026-11-24", branchIds: ["b1", "b2", "b3"] });
    expect(sidik(a)).toBe(sidik(b));
    expect(a.branches.some((x) => x.visits.total > 0)).toBe(true);
  });
});
