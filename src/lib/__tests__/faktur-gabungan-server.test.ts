import { beforeEach, describe, expect, it } from "vitest";
import {
  BATAS_EKSPOR, bacaFakturGabungan, bacaFilterFaktur, bacaSemuaFakturGabungan,
  cabangEfektif, paramFilter,
} from "../faktur-gabungan-server";

import { buatDbPalsu, type JejakBaca, type Row } from "./helpers/faktur-db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (data: Record<string, Row[]>, jejak: JejakBaca[] = []) => buatDbPalsu(data, { jejak }) as any;

const struk = (over: Row): Row => ({
  no_struk: "CM-1", created_at: "2026-10-10T05:00:00+00:00", total: 100_000, branch_id: "b1",
  customer_id: null, buyer_name: null, voided_at: null, payment_plan: null, payments_finalized_at: null,
  channel: null, external_ref: null, customers: null, branches: { name: "Pondok Aren" }, ...over,
});
const tagihan = (over: Row): Row => ({
  invoice_no: "INV-1", created_at: "2026-10-11T05:00:00+00:00", total: 200_000, paid_status: "Lunas",
  voided_at: null, visit_id: "v1", visits: { branch_id: "b1", customer_id: null, pets: { name: "Mochi" }, customers: { name: "Siti" }, branches: { name: "Pondok Aren · Vet" } }, ...over,
});
const faktur = (over: Row): Row => ({
  no_faktur: "FJ.2026.10.00001", tanggal: "2026-10-12", total: 300_000, status: "berjalan",
  voided_on: null, branch_id: "b1", customer_id: "c1", replaces_invoice_id: null, catatan: null,
  jatuh_tempo: "2026-11-11", kategori: null, opening_batch_id: null,
  customers: { name: "Toko Hewan" }, branches: { name: "Pondok Aren" }, sales_orders: null, ...over,
});

const DASAR = {
  profiles: [{ id: "user-1", role: "OWNER", is_active: true }],
  user_branches: [] as Row[],
  role_capabilities: [] as Row[],
  branches: [
    { id: "b1", code: "PDRY", name: "Pondok Aren", type: "PETSHOP", is_active: true },
    { id: "b2", code: "TKI", name: "Tangkerang", type: "PETSHOP", is_active: true },
  ],
  customers: [{ id: "c1", name: "Toko Hewan Sejahtera" }, { id: "c2", name: "Siti Aminah" }],
};

const FILTER = bacaFilterFaktur({ dari: "2026-10-01", sampai: "2026-10-31" }, "2026-10-29");

let jejak: JejakBaca[];
beforeEach(() => { jejak = []; });
const opsTabel = (tabel: string) => jejak.filter((j) => j.tabel === tabel).flatMap((j) => j.ops);

describe("gabungan tiga sumber", () => {
  it("satu daftar berisi struk petshop, tagihan klinik, dan faktur grosir sekaligus", async () => {
    const hasil = await bacaFakturGabungan(db({
      ...DASAR,
      sales: [struk({ id: "s1" })],
      invoices: [tagihan({ id: "k1" })],
      sales_invoices: [faktur({ id: "g1" })],
    }, jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => [r.sumber, r.nomor])).toEqual([
      ["grosir", "FJ.2026.10.00001"], ["klinik", "INV-1"], ["petshop", "CM-1"],
    ]);
    expect(hasil.ringkasan).toEqual({ jumlah: 3, total: 600_000, jumlahBelum: 1, totalBelum: 300_000 });
  });

  it("melengkapi nama pelanggan, cabang, keterangan, dan kunjungan klinik", async () => {
    const hasil = await bacaFakturGabungan(db({
      ...DASAR,
      sales: [struk({ id: "s1", channel: "Shopee", external_ref: "SPX-9", buyer_name: "Budi" })],
      invoices: [tagihan({ id: "k1" })],
      sales_invoices: [faktur({ id: "g1", sales_orders: { no_pesanan: "SO.1" } })],
    }, jejak), "user-1", FILTER, "1");
    const per = Object.fromEntries(hasil.rows.map((r) => [r.sumber, r]));
    expect(per.petshop.pelanggan).toBe("Budi");
    expect(per.petshop.keterangan).toBe("Online · Shopee · SPX-9");
    expect(per.klinik.pelanggan).toBe("Siti");
    expect(per.klinik.keterangan).toBe("Kunjungan klinik · Mochi");
    expect(per.klinik.visitId).toBe("v1");
    expect(per.grosir.keterangan).toBe("Pesanan SO.1");
    expect(per.grosir.cabang).toBe("Pondok Aren");
  });

  it("faktur saldo awal dan selisih stok tidak menawarkan rincian HPP", async () => {
    const hasil = await bacaFakturGabungan(db({
      ...DASAR, sales: [], invoices: [],
      sales_invoices: [
        faktur({ id: "g1", no_faktur: "FJ.1", opening_batch_id: "batch", catatan: "Migrasi Accurate" }),
        faktur({ id: "g2", no_faktur: "FJ.2", kategori: "selisih_stok" }),
        faktur({ id: "g3", no_faktur: "FJ.3" }),
      ],
    }, jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => [r.nomor, r.rincianHpp, r.keterangan])).toEqual([
      ["FJ.3", true, "Faktur grosir"],
      ["FJ.2", false, "Selisih stok opname"],
      ["FJ.1", false, "Saldo awal · Migrasi Accurate"],
    ]);
  });
});

describe("dokumen batal dan pengganti", () => {
  const data = () => ({
    ...DASAR,
    sales: [struk({ id: "s1" }), struk({ id: "s2", no_struk: "CM-2", voided_at: "2026-10-10T06:00:00+00:00" })],
    invoices: [tagihan({ id: "k1" }), tagihan({ id: "k2", invoice_no: "INV-2", voided_at: "2026-10-11T06:00:00+00:00" })],
    sales_invoices: [
      faktur({ id: "g1" }),
      faktur({ id: "g2", no_faktur: "FJ.2026.10.00002", status: "batal", voided_on: "2026-10-13" }),
      faktur({ id: "g3", no_faktur: "FJ.2026.10.00003", replaces_invoice_id: "g1" }),
    ],
  });

  it("menyembunyikan struk, tagihan, dan faktur yang dibatalkan", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => r.id)).toEqual(["g3", "k1", "s1"]);
    expect(opsTabel("sales")).toContain("is-null:voided_at");
    expect(opsTabel("invoices")).toContain("is-null:voided_at");
    expect(opsTabel("sales_invoices")).toContain("is-null:voided_on");
  });

  it("faktur yang sudah diganti faktur koreksi tidak pernah ikut, walau batal ditampilkan", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1",
      { ...FILTER, batal: true }, "1");
    const ids = hasil.rows.map((r) => r.id);
    expect(ids).not.toContain("g1");
    expect(ids).toEqual(["g3", "g2", "k2", "k1", "s2", "s1"]);
    expect(hasil.rows.find((r) => r.id === "g2")?.status).toBe("batal");
    expect(hasil.rows.find((r) => r.id === "s2")?.status).toBe("batal");
  });

  it("rencana bayar yang belum diselesaikan belum dihitung sebagai penjualan", async () => {
    const hasil = await bacaFakturGabungan(db({
      ...DASAR, invoices: [], sales_invoices: [],
      sales: [
        struk({ id: "s1" }),
        struk({ id: "s2", no_struk: "CM-2", payment_plan: { tempo: 30 } }),
        struk({ id: "s3", no_struk: "CM-3", payment_plan: { tempo: 30 }, payments_finalized_at: "2026-10-12T00:00:00+00:00" }),
      ],
    }, jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => r.id)).toEqual(["s3", "s1"]);
  });
});

describe("hak akses cabang", () => {
  const data = () => ({
    ...DASAR,
    profiles: [{ id: "user-1", role: "STAFF", is_active: true }],
    user_branches: [{ user_id: "user-1", branch_id: "b1" }],
    sales: [struk({ id: "s1", branch_id: "b1" }), struk({ id: "s2", no_struk: "CM-2", branch_id: "b2" })],
    invoices: [tagihan({ id: "k1" }), tagihan({ id: "k2", invoice_no: "INV-2", visits: { branch_id: "b2", customer_id: null, pets: null, customers: null, branches: { name: "Tangkerang" } } })],
    sales_invoices: [faktur({ id: "g1", branch_id: "b1" }), faktur({ id: "g2", no_faktur: "FJ.2", branch_id: "b2" })],
  });

  it("kasir satu cabang hanya melihat dokumen cabangnya, termasuk lewat kunjungan klinik", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => r.id)).toEqual(["g1", "k1", "s1"]);
    expect(opsTabel("sales")).toContain("in:branch_id=b1");
    expect(opsTabel("invoices")).toContain("in:visits.branch_id=b1");
    expect(opsTabel("sales_invoices")).toContain("in:branch_id=b1");
  });

  it("pilihan cabang di filter tidak bisa menembus cabang yang tidak diizinkan", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1", { ...FILTER, cabang: "b2" }, "1");
    expect(hasil.rows).toHaveLength(0);
    expect(hasil.ringkasan.jumlah).toBe(0);
    expect(hasil.cabangOptions.map((c) => c.id)).toEqual(["b1"]);
  });

  it("peran lintas cabang tidak dibatasi cabang mana pun", async () => {
    await bacaFakturGabungan(db(data(), jejak), "user-1", { ...FILTER, cabang: "" }, "1");
    expect(opsTabel("sales")).toContain("in:branch_id=b1");
    const lintas = await bacaFakturGabungan(db({ ...data(), profiles: [{ id: "user-1", role: "OWNER", is_active: true }] }), "user-1", FILTER, "1");
    expect(lintas.rows.map((r) => r.id)).toEqual(["g1", "g2", "k2", "k1", "s2", "s1"]);
  });

  it("tanpa sesi tidak ada satu pun dokumen yang terbaca", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), null, FILTER, "1");
    expect(hasil.rows).toHaveLength(0);
    expect(hasil.ringkasan.jumlah).toBe(0);
  });

  it("cabangEfektif memadukan izin dan pilihan filter", () => {
    expect(cabangEfektif(null, "")).toBeNull();
    expect(cabangEfektif(null, "b9")).toEqual(["b9"]);
    expect(cabangEfektif(["b1", "b2"], "b2")).toEqual(["b2"]);
    expect(cabangEfektif(["b1"], "b2")).toEqual([]);
    expect(cabangEfektif([], "")).toEqual([]);
  });
});

describe("saringan", () => {
  const data = () => ({
    ...DASAR,
    sales: [struk({ id: "s1", customer_id: "c2" })],
    invoices: [tagihan({ id: "k1", paid_status: "Belum Lunas", visits: { branch_id: "b1", customer_id: "c2", pets: null, customers: { name: "Siti Aminah" }, branches: { name: "Pondok Aren · Vet" } } })],
    sales_invoices: [faktur({ id: "g1", status: "lunas" })],
  });

  it("rentang tanggal dititipkan ke database per sumber", async () => {
    await bacaFakturGabungan(db(data(), jejak), "user-1", FILTER, "1");
    expect(opsTabel("sales")).toEqual(expect.arrayContaining(["gte:created_at", "lte:created_at"]));
    expect(opsTabel("invoices")).toEqual(expect.arrayContaining(["gte:created_at", "lte:created_at"]));
    expect(opsTabel("sales_invoices")).toEqual(expect.arrayContaining(["gte:tanggal", "lte:tanggal"]));
  });

  it("tanggal di luar rentang tidak ikut", async () => {
    const hasil = await bacaFakturGabungan(db({
      ...data(), sales: [struk({ id: "s1" }), struk({ id: "s9", no_struk: "CM-9", created_at: "2026-09-20T05:00:00+00:00" })],
    }, jejak), "user-1", FILTER, "1");
    expect(hasil.rows.map((r) => r.id)).not.toContain("s9");
  });

  it("filter sumber hanya menarik sumber yang dipilih", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1", { ...FILTER, sumber: "klinik" }, "1");
    expect(hasil.rows.map((r) => r.sumber)).toEqual(["klinik"]);
    expect(jejak.some((j) => j.tabel === "sales")).toBe(false);
  });

  it("filter status memakai status tersimpan tiap dokumen", async () => {
    const belum = await bacaFakturGabungan(db(data(), jejak), "user-1", { ...FILTER, status: "belum" }, "1");
    expect(belum.rows.map((r) => r.id)).toEqual(["k1"]);
    const lunas = await bacaFakturGabungan(db(data()), "user-1", { ...FILTER, status: "lunas" }, "1");
    expect(lunas.rows.map((r) => r.id)).toEqual(["g1", "s1"]);
  });

  it("cari nama pelanggan menemukan dokumen lewat kartu pelanggannya", async () => {
    const hasil = await bacaFakturGabungan(db(data(), jejak), "user-1", { ...FILTER, cari: "aminah" }, "1");
    expect(hasil.rows.map((r) => r.id)).toEqual(["k1", "s1"]);
    expect(opsTabel("customers")).toContain("ilike:name");
  });

  it("cari nomor dokumen menyaring lintas sumber", async () => {
    const hasil = await bacaFakturGabungan(db(data()), "user-1", { ...FILTER, cari: "FJ.2026" }, "1");
    expect(hasil.rows.map((r) => r.id)).toEqual(["g1"]);
  });

  it("filter pelanggan tidak terpancing nomor dokumen", async () => {
    const hasil = await bacaFakturGabungan(db(data()), "user-1", { ...FILTER, pelanggan: "FJ.2026" }, "1");
    expect(hasil.rows).toHaveLength(0);
  });
});

describe("halaman dan ringkasan", () => {
  const banyak = (jumlah: number) => Array.from({ length: jumlah }, (_, i) => struk({
    id: `s${String(i).padStart(3, "0")}`, no_struk: `CM-${String(i).padStart(3, "0")}`,
    created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T05:00:00+00:00`, total: 1_000,
  }));

  it("ringkasan kaki daftar memakai SELURUH hasil saringan, bukan hanya halaman yang tampil", async () => {
    const data = { ...DASAR, sales: banyak(120), invoices: [], sales_invoices: [] };
    const hal1 = await bacaFakturGabungan(db(data), "user-1", FILTER, "1");
    expect(hal1.rows).toHaveLength(50);
    expect(hal1.ringkasan.jumlah).toBe(120);
    expect(hal1.ringkasan.total).toBe(120_000);
    expect(hal1.pageInfo.totalPages).toBe(3);

    const hal3 = await bacaFakturGabungan(db(data), "user-1", FILTER, "3");
    expect(hal3.rows).toHaveLength(20);
    expect(hal3.ringkasan.total).toBe(120_000);
    const semua = [...hal1.rows, ...(await bacaFakturGabungan(db(data), "user-1", FILTER, "2")).rows, ...hal3.rows];
    expect(new Set(semua.map((r) => r.id)).size).toBe(120);
  });

  it("halaman di luar jangkauan dikembalikan ke halaman pertama", async () => {
    const hasil = await bacaFakturGabungan(db({ ...DASAR, sales: banyak(10), invoices: [], sales_invoices: [] }),
      "user-1", FILTER, "99");
    expect(hasil.pageInfo.page).toBe(1);
    expect(hasil.rows).toHaveLength(10);
  });
});

describe("filter dari URL", () => {
  it("bawaannya bulan berjalan sampai hari ini", () => {
    expect(bacaFilterFaktur({}, "2026-10-29")).toMatchObject({ dari: "2026-10-01", sampai: "2026-10-29" });
  });

  it("tanggal terbalik dibetulkan, bukan menghasilkan daftar kosong", () => {
    expect(bacaFilterFaktur({ dari: "2026-10-20", sampai: "2026-10-05" }, "2026-10-29"))
      .toMatchObject({ dari: "2026-10-05", sampai: "2026-10-20" });
  });

  it("nilai filter yang tidak dikenali diabaikan", () => {
    const f = bacaFilterFaktur({ dari: "kemarin", sumber: "apa", status: "mungkin" }, "2026-10-29");
    expect(f).toMatchObject({ dari: "2026-10-01", sumber: "", status: "" });
  });

  it("memilih status Dibatalkan otomatis menampilkan dokumen batal", () => {
    expect(bacaFilterFaktur({ status: "batal" }, "2026-10-29").batal).toBe(true);
    expect(bacaFilterFaktur({ batal: "1" }, "2026-10-29").batal).toBe(true);
    expect(bacaFilterFaktur({}, "2026-10-29").batal).toBe(false);
  });

  it("karakter khusus pada pencarian dibersihkan supaya tidak merusak kueri", () => {
    expect(bacaFilterFaktur({ cari: "to%ko,(a)" }, "2026-10-29").cari).toBe("to ko  a ");
  });

  it("parameter tautan halaman memuat seluruh filter", () => {
    const f = bacaFilterFaktur({ dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", sumber: "grosir", status: "belum", cari: "FJ", batal: "1" }, "2026-10-29");
    expect(paramFilter(f)).toEqual({ dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", sumber: "grosir", status: "belum", pelanggan: "", cari: "FJ", batal: "1" });
  });
});

describe("unduhan", () => {
  it("menarik seluruh baris sesuai filter, bukan satu halaman", async () => {
    const sales = Array.from({ length: 60 }, (_, i) => struk({ id: `s${i}`, no_struk: `CM-${i}` }));
    const hasil = await bacaSemuaFakturGabungan(db({ ...DASAR, sales, invoices: [], sales_invoices: [] }), "user-1", FILTER);
    expect(hasil.rows).toHaveLength(60);
    expect(hasil.ringkasan.jumlah).toBe(60);
  });

  it("menolak unduhan yang terlalu lebar daripada memotongnya diam-diam", async () => {
    const sales = Array.from({ length: BATAS_EKSPOR + 1 }, (_, i) => struk({ id: `s${i}`, no_struk: `CM-${i}` }));
    await expect(bacaSemuaFakturGabungan(db({ ...DASAR, sales, invoices: [], sales_invoices: [] }), "user-1", FILTER))
      .rejects.toThrow(/persempit/i);
  });
});

describe("status Belum lunas mengabaikan rentang tanggal", () => {
  it("piutang lama (saldo awal per faktur) tetap tampil walau di luar bulan berjalan", async () => {
    const filter = bacaFilterFaktur({ status: "belum" }, "2026-11-01");
    expect([filter.dari, filter.sampai]).toEqual(["2026-11-01", "2026-11-01"]);
    const hasil = await bacaFakturGabungan(db({
      ...DASAR,
      sales: [struk({ id: "s1", created_at: "2026-11-01T03:00:00+00:00" })],
      invoices: [
        tagihan({ id: "k1", invoice_no: "INV-LAMA", created_at: "2026-08-03T05:00:00+00:00", paid_status: "Belum Lunas" }),
        tagihan({ id: "k2", invoice_no: "INV-LUNAS", created_at: "2026-08-04T05:00:00+00:00" }),
      ],
      sales_invoices: [
        faktur({ id: "g1", no_faktur: "FJ.SALDO.1", tanggal: "2025-12-20", opening_batch_id: "batch", catatan: "Migrasi Accurate" }),
        faktur({ id: "g2", no_faktur: "FJ.LUNAS", tanggal: "2026-09-01", status: "lunas" }),
        faktur({ id: "g3", no_faktur: "FJ.BATAL", tanggal: "2026-09-02", status: "batal" }),
      ],
    }, jejak), "user-1", filter, "1");
    expect(hasil.rows.map((r) => r.nomor).sort()).toEqual(["FJ.SALDO.1", "INV-LAMA"]);
    expect(hasil.rows.find((r) => r.nomor === "FJ.SALDO.1")?.keterangan).toMatch(/Saldo awal/);
    // Struk kasir selalu lunas: sumbernya tidak dibaca sama sekali untuk status ini.
    expect(opsTabel("sales")).toEqual([]);
    expect(opsTabel("sales_invoices").some((op) => op.startsWith("gte:tanggal"))).toBe(false);
  });

  it("status lain tetap memakai rentang tanggal", async () => {
    await bacaFakturGabungan(db({ ...DASAR, sales: [], invoices: [], sales_invoices: [] }, jejak), "user-1", FILTER, "1");
    expect(opsTabel("sales_invoices")).toContain("gte:tanggal");
  });
});
