// Filter "Semua petshop" / "Semua klinik" di laporan stok + pilihan kategori yang hanya memuat barang stok.
import { describe, expect, it, vi } from "vitest";
import { opsiGrupGudang, pilihGudang } from "../stok-analisis";
import { muatPilihanStok, muatRingkasStok, opsiKategoriStok } from "../stok-analisis-server";

const GUDANG = [
  { id: "dc", code: "DC_LOJI", name: "DC LOJI", type: "DC" },
  { id: "vp", code: "VET_PEJUANG", name: "VET PEJUANG", type: "VET" },
  { id: "b2c", code: "WH_B2C", name: "WH B2C", type: "ONLINE" },
  { id: "btkm", code: "WH_BTKM", name: "WH BTKM", type: "RETAIL" },
  { id: "ciaw", code: "WH_CIAW", name: "WH CIAW", type: "RETAIL" },
  { id: "exp", code: "WH_EXPIRED", name: "WH EXPIRED", type: "EXPIRED" },
  { id: "vciaw", code: "WH_VET_CIAW", name: "WH VET CIAW", type: "VET" },
];

describe("pilihGudang", () => {
  it("petshop = gudang toko saja; klinik = gudang klinik saja; DC/online/expired tidak ikut", () => {
    expect(pilihGudang(GUDANG, "petshop")).toEqual({ nilai: "petshop", nama: "Semua petshop (2 gudang toko)", satu: "", daftar: ["btkm", "ciaw"] });
    expect(pilihGudang(GUDANG, "klinik")).toEqual({ nilai: "klinik", nama: "Semua klinik (2 gudang klinik)", satu: "", daftar: ["vp", "vciaw"] });
  });
  it("satu gudang dikenali dari id; kosong / tidak dikenal / grup tanpa anggota = semua gudang", () => {
    expect(pilihGudang(GUDANG, "ciaw")).toEqual({ nilai: "ciaw", nama: "WH CIAW", satu: "ciaw", daftar: null });
    const semua = { nilai: "", nama: "Semua gudang digabung", satu: "", daftar: null };
    for (const raw of ["", null, undefined, "bukan", "PETSHOP", "toString", "__proto__"]) expect(pilihGudang(GUDANG, raw)).toEqual(semua);
    expect(pilihGudang(GUDANG.filter((w) => w.type !== "VET"), "klinik")).toEqual(semua);
  });
  it("pilihan gabungan hanya yang punya anggota, dengan jumlah gudangnya", () => {
    expect(opsiGrupGudang(GUDANG)).toEqual([
      { nilai: "petshop", label: "Semua petshop (2 gudang toko)" }, { nilai: "klinik", label: "Semua klinik (2 gudang klinik)" },
    ]);
    expect(opsiGrupGudang(GUDANG.filter((w) => w.type !== "RETAIL"))).toEqual([{ nilai: "klinik", label: "Semua klinik (2 gudang klinik)" }]);
  });
});

describe("opsiKategoriStok", () => {
  const KAT = [
    { id: "promo", name: "PROMO", parent_id: null }, { id: "promo-dry", name: "PROMO DRY CAT", parent_id: null },
    { id: "promo-lain", name: "Promo Lain", parent_id: "promo" },
    { id: "dry", name: "dry cat", parent_id: null }, { id: "dry-royal", name: "ROYAL", parent_id: "dry" },
    { id: "jasa", name: "TINDAKAN", parent_id: null },
  ];
  it("hanya kategori induk yang memuat barang stok; sub-kategori naik ke induknya; tanpa kategori ikut ditawarkan", () => {
    expect(opsiKategoriStok(KAT, [{ category_id: "dry-royal" }, { category_id: "dry" }, { category_id: null }])).toEqual(["DRY CAT", "TANPA KATEGORI"]);
    expect(opsiKategoriStok(KAT, [{ category_id: "promo-lain" }])).toEqual(["PROMO"]);
    expect(opsiKategoriStok(KAT, [])).toEqual([]);
  });
});

function klien() {
  const panggilan: { tabel: string; filter: unknown[][] }[] = [];
  const rpc = vi.fn(async () => ({ data: { hari_ini: "2026-11-21", jendela_hari: 90, riwayat_mulai: "2026-11-01", riwayat_hari: 21, gudang_id: null, baris: [] }, error: null }));
  const data: Record<string, unknown[]> = {
    warehouses: GUDANG,
    item_categories: [{ id: "promo", name: "PROMO", parent_id: null }, { id: "dry", name: "DRY CAT", parent_id: null }],
    items: [{ id: "i1", category_id: "dry" }],
  };
  return {
    panggilan, rpc,
    from(tabel: string) {
      const catatan = { tabel, filter: [] as unknown[][] };
      panggilan.push(catatan);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "order", "range", "in"]) q[k] = (...a: unknown[]) => { catatan.filter.push([k, ...a]); return q; };
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data[tabel] ?? [], count: (data[tabel] ?? []).length, error: null }).then(res);
      return q;
    },
  };
}

describe("muatPilihanStok / muatRingkasStok", () => {
  it("pilihan kategori hanya dari barang Persediaan yang tidak dibuang; gudang membawa jenisnya", async () => {
    const c = klien();
    const p = await muatPilihanStok(c);
    expect(p.kategoriOpsi).toEqual(["DRY CAT"]);
    expect(p.gudang[0]).toHaveProperty("type");
    const items = c.panggilan.find((x) => x.tabel === "items")!;
    expect(items.filter).toContainEqual(["eq", "item_type", "Persediaan"]);
    expect(items.filter).toContainEqual(["is", "trashed_at", null]);
    expect(c.panggilan.find((x) => x.tabel === "warehouses")!.filter[0][1]).toContain("type");
  });
  it("unduhan tidak membaca barang (pilihan kategori tidak dipakai)", async () => {
    const c = klien();
    const p = await muatPilihanStok(c, { opsiKategori: false });
    expect(p.kategoriOpsi).toEqual([]);
    expect(c.panggilan.some((x) => x.tabel === "items")).toBe(false);
  });
  it("daftar gudang hanya dikirim bila diisi (panggilan lama tetap sama persis)", async () => {
    const c = klien();
    await muatRingkasStok(c, "g1");
    expect(c.rpc).toHaveBeenLastCalledWith("laporan_stok_analisis", { p_gudang: "g1", p_jendela_hari: 90 });
    await muatRingkasStok(c);
    expect(c.rpc).toHaveBeenLastCalledWith("laporan_stok_analisis", { p_gudang: null, p_jendela_hari: 90 });
    await muatRingkasStok(c, "", ["a", "b"]);
    expect(c.rpc).toHaveBeenLastCalledWith("laporan_stok_analisis", { p_gudang: null, p_jendela_hari: 90, p_gudang_daftar: ["a", "b"] });
  });
});
