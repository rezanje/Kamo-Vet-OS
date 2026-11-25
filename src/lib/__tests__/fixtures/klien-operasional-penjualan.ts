/* eslint-disable @typescript-eslint/no-explicit-any */
// Klien Supabase tiruan untuk laporan Operation & Sales: meniru PostgREST (filter, urutan, halaman, max-rows, hitungan pasti) atas
// baris fixture, dan fungsi baca-saja `laporan_operasional_penjualan` ditulis ulang di TypeScript SECARA TERPISAH dari SQL-nya
// (aturan filter yang sama), supaya jalur cepat aplikasi dibandingkan dengan jalur lama atas data yang sama.
type Row = Record<string, any>;
type Call = { method: string; args: any[] };
export type Rekaman = { table: string; calls: Call[] };

function bandingSel(a: unknown, b: unknown): number {
  // Hanya teks berbentuk tanggal ISO yang dibandingkan sebagai waktu (Date.parse longgar menafsirkan "sale-00010" sebagai tanggal).
  const iso = /^\d{4}-\d{2}-\d{2}/;
  const left = iso.test(String(a)) ? Date.parse(String(a)) : NaN;
  const right = iso.test(String(b)) ? Date.parse(String(b)) : NaN;
  if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function terapkan(rows: Row[], calls: Call[]): Row[] {
  const select = String(calls.find((call) => call.method === "select")?.args[0] ?? "");
  let out = rows.map((row) => ({ ...row }));
  for (const { method, args } of calls) {
    if (!["eq", "in", "is", "gte", "lte", "gt", "lt", "ilike", "neq", "not"].includes(method)) continue;
    const [column, op, nilai] = method === "not" ? [args[0], "notnull", null] : [args[0], method, args[1]];
    const uji = (sel: unknown) => op === "ilike" ? String(sel ?? "").toLowerCase().includes(String(nilai).replaceAll("%", "").toLowerCase())
      : op === "in" ? (nilai as unknown[]).includes(sel)
      : op === "is" ? (sel ?? null) === nilai
      : op === "notnull" ? sel !== null && sel !== undefined
      : op === "eq" ? sel === nilai
      : op === "neq" ? sel !== nilai && sel !== null && sel !== undefined
      : op === "gte" ? bandingSel(sel, nilai) >= 0
      : op === "gt" ? bandingSel(sel, nilai) > 0
      : op === "lt" ? bandingSel(sel, nilai) < 0
      : bandingSel(sel, nilai) <= 0;
    const titik = String(column).indexOf(".");
    if (titik < 0) { out = out.filter((row) => uji(row[column])); continue; }
    const relasi = String(column).slice(0, titik);
    const kolom = String(column).slice(titik + 1);
    const dalam = select.includes(`${relasi}!inner`);
    out = out.flatMap((row) => {
      const tertanam = row[relasi] as Row | Row[] | null | undefined;
      const daftar = Array.isArray(tertanam) ? tertanam : tertanam ? [tertanam] : [];
      const sisa = daftar.filter((item) => uji(item[kolom]));
      if (dalam && sisa.length === 0) return [];
      return [{ ...row, [relasi]: Array.isArray(tertanam) ? sisa : sisa[0] ?? null }];
    });
  }
  return out;
}

function jawab(rows: Row[], calls: Call[], maxRows: number) {
  const opsi = calls.find((call) => call.method === "select")?.args[1] as { count?: string } | undefined;
  const urut = calls.filter((call) => call.method === "order").map((call) => String(call.args[0]));
  const terurut = urut.length === 0 ? rows : [...rows].sort((a, b) => { for (const k of urut) { const d = bandingSel(a[k], b[k]); if (d !== 0) return d; } return 0; });
  const rentang = calls.filter((call) => call.method === "range").at(-1)?.args as [number, number] | undefined;
  const [awal, akhir] = rentang ?? [0, Number.MAX_SAFE_INTEGER];
  return { data: terurut.slice(awal, Math.min(akhir + 1, awal + maxRows)), count: opsi?.count === "exact" ? rows.length : null };
}

export type OpsiKlien = {
  tables: Record<string, Row[]>;
  branches: { id: string; name: string; is_active?: boolean }[];
  /** `undefined` = fungsi belum ada (PGRST202). */
  rpcOperasional?: ((args: Record<string, any>) => { data?: unknown; error?: { code?: string; message: string } | null }) | undefined;
  role?: string;
};

export function bikinKlienOperasional(opsi: OpsiKlien) {
  const rekaman: Rekaman[] = [];
  const panggilan: { name: string; args: Record<string, any> }[] = [];
  const from = (table: string) => {
    const rec: Rekaman = { table, calls: [] };
    rekaman.push(rec);
    const tetap: Row[] | null = opsi.tables[table] ? null : table === "profiles" ? [{ role: opsi.role ?? "OWNER" }] : table === "user_branches" ? [] : table === "branches" ? opsi.branches : [];
    const query: Record<string, any> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "lt", "gt", "is", "ilike", "not", "neq", "order", "range", "limit", "maybeSingle"]) {
      query[method] = (...args: any[]) => { rec.calls.push({ method, args }); return query; };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ ...jawab(table === "branches" || !tetap ? terapkan(tetap ?? opsi.tables[table], rec.calls) : tetap, rec.calls, 1000), error: null }).then(resolve);
    return query;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from,
    rpc: async (name: string, args: Record<string, any>) => {
      panggilan.push({ name, args });
      if (name === "laporan_operasional_penjualan") {
        if (!opsi.rpcOperasional) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.laporan_operasional_penjualan(p_bagian) in the schema cache" } };
        const hasil = opsi.rpcOperasional(args);
        return { data: hasil.data ?? null, error: hasil.error ?? null };
      }
      if (name === "inventory_is_average") return { data: false, error: null };
      return { data: true, error: null };
    },
    rekaman,
    panggilan,
  };
  return client;
}

/** Fungsi database, ditulis ulang di TypeScript atas baris fixture (cabang yang boleh = semua cabang fixture). */
export function rpcOperasionalTiruan(tables: Record<string, Row[]>): NonNullable<OpsiKlien["rpcOperasional"]> {
  return (a) => {
    const cab = new Set<string>(a.p_cabang as string[]);
    const ms = (x: string) => Date.parse(x);
    const dalam = (t: string) => ms(t) >= ms(a.p_mulai) && ms(t) <= ms(a.p_akhir);
    const selesai = (s: Row) => !s.voided_at && (s.payment_plan == null || !!s.payments_finalized_at);
    const urutId = (rows: Row[]) => [...rows].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const kanal = a.p_kanal ?? "all";
    const T = (n: string) => tables[n] ?? [];
    if (a.p_bagian === "dokumen") {
      const sales = kanal === "klinik" || kanal === "reseller" ? [] : urutId(T("sales").filter((s) => cab.has(s.branch_id) && dalam(s.created_at)
        && (kanal === "pos" ? s.channel == null : kanal === "online" ? s.channel != null : true)));
      const done = new Set(sales.filter(selesai).map((s) => s.id));
      const returns = kanal === "klinik" || kanal === "reseller" ? [] : urutId(T("sales_returns").filter((r) => !r.voided_at && done.has(r.sale_id))).map((r) => ({ sale_id: r.sale_id, total: r.total }));
      const invoices = ["pos", "online", "reseller"].includes(kanal) ? [] : urutId(T("invoices").filter((i) => cab.has(i.visits?.branch_id) && !i.voided_at && dalam(i.created_at)));
      const ids = new Set(invoices.map((i) => i.id));
      const refunds = urutId(T("clinic_refunds").filter((r) => ids.has(r.invoice_id))).map((r) => ({ invoice_id: r.invoice_id, total: r.total }));
      const reseller = kanal === "all" || kanal === "reseller" ? urutId(T("sales_invoices").filter((q) => cab.has(q.branch_id) && q.status !== "batal" && q.opening_batch_id == null && q.tanggal >= a.p_dari && q.tanggal <= a.p_sampai)) : [];
      return { data: { n_sales: sales.length, n_retur: returns.length, n_invoice: invoices.length, n_refund: refunds.length, n_reseller: reseller.length, sales, returns, invoices, refunds, reseller } };
    }
    if (a.p_bagian === "grooming") {
      const visits = urutId(T("visits").filter((v) => !v.archived_at && /grooming/i.test(v.poli ?? "") && cab.has(v.branch_id) && dalam(v.created_at))).map((v) => [v.branch_id]);
      const kasir = [...T("sale_items")].sort((x, y) => (x.id < y.id ? -1 : 1))
        .filter((l) => l.items?.item_type === "Jasa" && l.items?.tindakan_kategori === "Grooming" && !l.sales?.voided_at && cab.has(l.sales?.branch_id) && dalam(l.sales?.created_at))
        .map((l) => [l.sales.branch_id, l.qty]);
      return { data: { n_visits: visits.length, n_kasir: kasir.length, visits, kasir } };
    }
    if (a.p_bagian === "pelanggan") {
      const rows = urutId(T("sales").filter((s) => cab.has(s.branch_id) && ms(s.created_at) <= ms(a.p_akhir) && s.customer_id != null && selesai(s)))
        .map((s) => [s.id, s.customer_id, s.created_at, s.total, s.merchant_fee_total ?? null]);
      return { data: { n: rows.length, rows } };
    }
    if (a.p_bagian === "stok") {
      const gudang = new Set(T("warehouses").filter((w) => cab.has(w.branch_id) && w.is_active).map((w) => w.id));
      const stokRows = urutId(T("stock").filter((s) => gudang.has(s.warehouse_id) && ms(s.updated_at) <= ms(a.p_akhir)));
      const mutasi = urutId(T("return_record_effective_stock_moves").filter((m) => gudang.has(m.warehouse_id) && m.tanggal >= a.p_dari && m.tanggal <= a.p_sampai && Number(m.qty) < 0));
      const dipakai = new Set(stokRows.map((s) => s.item_id));
      const barang = urutId(T("items").filter((i) => i.is_active && dipakai.has(i.id)));
      return { data: { n_stok: stokRows.length, n_mutasi: mutasi.length, stok: stokRows.map((s) => [s.item_id, s.qty]), mutasi: mutasi.map((m) => [m.item_id, m.qty, m.tanggal]), barang: barang.map((i) => [i.id, i.min_stock]) } };
    }
    if (a.p_bagian === "klinik") {
      const pilih = (n: string, f: (r: Row) => boolean) => urutId(T(n).filter((r) => cab.has(r.branch_id) && f(r)));
      const visits = pilih("visits", (v) => !v.archived_at && dalam(v.created_at));
      return { data: {
        n_visits: visits.length,
        bookings: pilih("bookings", (r) => r.tanggal >= a.p_dari && r.tanggal <= a.p_sampai).map((r) => ({ id: r.id, branch_id: r.branch_id, status: r.status, attendance_outcome: r.attendance_outcome, tanggal: r.tanggal })),
        visits: visits.map((v) => [v.branch_id, v.status, v.checked_in_at, v.service_started_at, v.service_finished_at, v.checked_out_at]),
        follow_ups: pilih("follow_ups", (r) => r.tanggal <= a.p_sampai).map((r) => ({ id: r.id, branch_id: r.branch_id, status: r.status, tanggal: r.tanggal, completed_at: r.completed_at })),
        referrals: pilih("visit_referrals", (r) => dalam(r.referred_at)).map((r) => ({ id: r.id, branch_id: r.branch_id, direction: r.direction, referred_at: r.referred_at })),
        admissions: pilih("inpatient_records", (r) => ms(r.admitted_at) < ms(a.p_akhir)).map((r) => ({ id: r.id, branch_id: r.branch_id, admitted_at: r.admitted_at, discharged_at: r.discharged_at })),
        capacities: pilih("branch_capacity_periods", (r) => r.valid_from <= a.p_sampai).map((r) => ({ id: r.id, branch_id: r.branch_id, capacity: r.capacity, valid_from: r.valid_from, valid_until: r.valid_until })),
      } };
    }
    // nilai_stok
    const gudang = T("warehouses").filter((w) => cab.has(w.branch_id)).sort((x, y) => (x.id < y.id ? -1 : 1));
    const dipakai = new Set(gudang.filter((w) => ["VET", "RETAIL", "ONLINE"].includes(w.type)).map((w) => w.id));
    const urutGudang = (rows: Row[]) => [...rows].sort((x, y) => (x.warehouse_id < y.warehouse_id ? -1 : x.warehouse_id > y.warehouse_id ? 1 : x.id < y.id ? -1 : 1));
    const stok = urutGudang(T("stock").filter((s) => dipakai.has(s.warehouse_id)));
    const lapisan = urutGudang(T("stock_layers").filter((l) => dipakai.has(l.warehouse_id) && Number(l.qty_left) > 0));
    const mutasi = urutGudang(T("stock_moves").filter((m) => dipakai.has(m.warehouse_id) && m.tanggal > a.p_sampai));
    return { data: {
      n_stok: stok.length, n_lapisan: lapisan.length, n_mutasi: mutasi.length,
      gudang: gudang.map((w) => ({ id: w.id, branch_id: w.branch_id, type: w.type })),
      stok: stok.map((s) => [s.warehouse_id, s.item_id, s.qty, a.p_rata_rata ? s.average_cost ?? null : null]),
      lapisan: lapisan.map((l) => [l.warehouse_id, l.item_id, l.qty_left, l.unit_cost]),
      mutasi: mutasi.map((m) => [m.warehouse_id, m.tanggal, m.qty, m.unit_cost, m.valuation_adjustment ?? null]),
    } };
  };
}
