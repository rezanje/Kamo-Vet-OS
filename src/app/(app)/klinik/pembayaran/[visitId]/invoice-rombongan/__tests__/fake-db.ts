// Basis data tiruan kecil untuk menguji struk gabungan & invoice gabungan dengan bacaRombongan YANG ASLI:
// filter .eq/.in/.is/.gte/.lt sungguh dijalankan, jadi tes "yang di-void tidak ikut", "pemilik lain tidak ikut",
// dan "hari lain tidak ikut" menguji aturan sungguhan, bukan jawaban yang sudah dikarang.
// Semua data sintetis.

export type Baris = Record<string, unknown>;
export type Tabel = Record<string, Baris[]>;
export const galat = { atTable: null as string | null, bilaSelect: null as string | null, thrown: null as string | null, dropInvoice: false };

type Hasil = { data: unknown; error: unknown; count?: number | null };

export function buatDb(tabel: Tabel, opsi: { logo?: string | null } = {}) {
  const baca = (t: string) => tabel[t] ?? [];
  const embed = (t: string, r: Baris): Baris => {
    if (t === "visits") {
      const pet = baca("pets").find((p) => p.id === r.pet_id) ?? null;
      const cust = baca("customers").find((c) => c.id === r.customer_id) ?? null;
      const cab = baca("branches").find((b) => b.id === r.branch_id) ?? null;
      return { ...r, pets: pet, customers: cust, branches: cab ? { name: cab.name, code: cab.code } : null };
    }
    if (t === "invoices") {
      const v = baca("visits").find((x) => x.id === r.visit_id);
      // penerbit_branch: data tiruan untuk kunjungan yang cabangnya berbeda dari kunjungan acuan (data tak lazim).
      const idCab = (r.penerbit_branch ?? v?.branch_id) as unknown;
      const cab = v ? baca("branches").find((b) => b.id === idCab) : null;
      return { ...r, visits: v ? { branch_id: idCab, branches: cab ? { name: cab.name, code: cab.code } : null } : null };
    }
    if (t === "invoice_items") return { package: null, ...r };
    return r;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "aktor" } } }) },
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/sign/${path}?token=t` }, error: null }) }) },
    from(t: string) {
      type Saring = (r: Baris) => boolean;
      const saring: Saring[] = [];
      const urut: { kolom: string; naik: boolean }[] = [];
      let rentang: [number, number] | null = null; let batas: number | null = null; let tepat = false; let lewatNomor = false; let pilih = "";
      const jalankan = (tunggal: boolean): Hasil => {
        if (galat.thrown === t) throw new Error("boom " + t);
        if (galat.atTable === t && (!galat.bilaSelect || pilih.includes(galat.bilaSelect))) return { data: null, error: { message: "galat " + t } };
        let rows = baca(t).filter((r) => saring.every((f) => f(r)));
        if (galat.dropInvoice && t === "invoices" && lewatNomor) rows = rows.slice(1);
        for (const { kolom, naik } of [...urut].reverse()) {
          rows = [...rows].sort((a, b) => String(a[kolom] ?? "").localeCompare(String(b[kolom] ?? "")) * (naik ? 1 : -1));
        }
        const jumlah = rows.length;
        if (rentang) rows = rows.slice(rentang[0], rentang[1] + 1);
        if (batas !== null) rows = rows.slice(0, batas);
        const hasil = rows.map((r) => embed(t, r));
        if (t === "branches" && opsi.logo !== undefined) for (const r of hasil) r.logo_path = opsi.logo;
        if (tunggal) return { data: hasil[0] ?? null, error: null };
        return { data: hasil, error: null, count: tepat ? jumlah : null };
      };
      const q = {
        select: (k: string, o?: { count?: string }) => { pilih = k; tepat = o?.count === "exact"; return q; },
        eq: (k: string, v: unknown) => { saring.push((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { if (k === "invoice_no") lewatNomor = true; saring.push((r) => v.includes(r[k])); return q; },
        is: (k: string, v: unknown) => { saring.push((r) => (r[k] ?? null) === v); return q; },
        gte: (k: string, v: string) => { saring.push((r) => String(r[k]) >= v); return q; },
        lt: (k: string, v: string) => { saring.push((r) => String(r[k]) < v); return q; },
        order: (k: string, o?: { ascending?: boolean }) => { urut.push({ kolom: k, naik: o?.ascending !== false }); return q; },
        range: (a: number, b: number) => { rentang = [a, b]; return q; },
        limit: (n: number) => { batas = n; return q; },
        maybeSingle: async () => jalankan(true),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          try { return Promise.resolve(jalankan(false)).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
        },
      };
      return q;
    },
  };
}

export const CAB_A = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
export const CAB_B = "7a0a3a1e-9d21-4a52-8f55-0d3a0f6a9b11";

/** Satu pemilik (Bu Sinta) membawa tiga hewan pada 27 Nov 2026, semuanya di Cabang A. */
export function dataDasar(): Tabel {
  const kunjungan = (id: string, pet: string, jam: string, extra: Baris = {}): Baris =>
    ({ id, customer_id: "cust-1", branch_id: CAB_A, created_at: `2026-11-27T${jam}:00Z`, archived_at: null, pet_id: pet, poli: "Poli Umum", doctor_id: null, dokter: "drh. Fiktif", ...extra });
  const tagihan = (id: string, no: string, visit: string, subtotal: number, extra: Baris = {}): Baris =>
    ({ id, invoice_no: no, visit_id: visit, subtotal, discount: 0, tax: 0, total: subtotal, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai",
      paid_at: "2026-11-27T05:00:00Z", created_at: "2026-11-27T04:30:00Z", voided_at: null, cashier_name: "Kasir Fiktif", ...extra });
  const baris = (id: string, inv: string, deskripsi: string, qty: number, harga: number): Baris =>
    ({ id, invoice_id: inv, item_id: "it-" + id, deskripsi, qty, harga, diskon_persen: 0, jenis: "jasa", package_item_id: null, package_qty: null, service_performers: null, created_at: "2026-11-27T04:31:00Z" });
  return {
    customers: [{ id: "cust-1", name: "Bu Sinta Fiktif", phone: "0811000111", address: "Jl. Mawar 5, Bogor" }, { id: "cust-2", name: "Pak Lain Fiktif", phone: null, address: null }],
    branches: [
      { id: CAB_A, name: "Kamo Pets Clinic Cimanggu", code: "CMG", alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logo_path: null },
      { id: CAB_B, name: "Kamo Pets Clinic Panduraya", code: "PDR", alamat: "Jl. Panduraya 3", telepon: "0251 7777", logo_path: null },
    ],
    pets: [
      { id: "pet-1", name: "Milo", species: "Kucing", breed: "Persia" },
      { id: "pet-2", name: "Bruno", species: "Anjing", breed: null },
      { id: "pet-3", name: "Kiko", species: "Kelinci", breed: null },
      { id: "pet-9", name: "Lain", species: "Kucing", breed: null },
    ],
    visits: [
      kunjungan("v1", "pet-1", "03:00"), kunjungan("v2", "pet-2", "03:10", { poli: "Grooming" }), kunjungan("v3", "pet-3", "03:20"),
    ],
    invoices: [
      tagihan("i1", "INV-202611-0101", "v1", 45000),
      tagihan("i2", "INV-202611-0102", "v2", 120000, { discount: 20000, tax: 0, total: 100000, cashier_name: "Kasir Dua" }),
      tagihan("i3", "INV-202611-0103", "v3", 80500, { paid_status: "DP", dp_amount: 30000, metode_bayar: "QRIS", paid_at: null }),
    ],
    invoice_items: [
      baris("l1", "i1", "Konsultasi Fiktif", 1, 45000),
      baris("l2", "i2", "Grooming Fiktif", 1, 120000),
      baris("l3", "i3", "Vaksin Fiktif", 1, 60500), baris("l4", "i3", "Obat Fiktif", 2, 10000),
    ],
    invoice_payments: [
      { id: "p3", invoice_id: "i3", amount: 20000, metode: "Tunai", transferred_from: null, reversal_of: null, created_at: "2026-11-27T06:00:00Z" },
    ],
    employees: [],
  };
}
