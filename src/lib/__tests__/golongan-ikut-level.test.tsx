import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Diskon per level member (janji Reza 5 Nov 2026 12.28): golongan bisa ditandai "otomatis untuk level".
const st = vi.hoisted(() => ({
  writes: [] as { op: string; patch: Record<string, unknown> }[],
  writeError: null as null | { code?: string; message: string },
  rpc: vi.fn(),
  rows: [] as Record<string, unknown>[],
  levelColsMissing: false,
  edit: true,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
const db = {
  rpc: (...a: unknown[]) => st.rpc(...a),
  from(table: string) {
    let cols = "";
    const q: Record<string, unknown> = {};
    q.select = (c: string) => { cols = c; return q; };
    for (const m of ["eq", "not", "order"]) q[m] = () => q;
    q.update = (patch: Record<string, unknown>) => { st.writes.push({ op: "update", patch }); return { eq: async () => ({ error: st.writeError }) }; };
    q.insert = async (patch: Record<string, unknown>) => { st.writes.push({ op: "insert", patch }); return { error: st.writeError }; };
    q.then = (ok: (v: unknown) => unknown) => {
      if (table === "customer_categories" && st.levelColsMissing && cols.includes("tier_otomatis")) return ok({ data: null, error: { code: "42703", message: "column tier_otomatis does not exist" } });
      return ok({ data: table === "customer_categories" ? st.rows : [], error: null });
    };
    return q;
  },
};
vi.mock("@/lib/master-guard", () => ({ assertMasterAdmin: async () => db, bolehKelolaMaster: async () => st.edit }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
import { simpanKategoriPelanggan, toggleKategoriPelanggan } from "@/app/(app)/crm/kategori-pelanggan/actions";
import KategoriPelangganPage from "@/app/(app)/crm/kategori-pelanggan/page";
import { pesanPindahLevel } from "@/lib/golongan-level";

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries({ nama: "Gold", diskon_persen: "5", rupiah_per_poin: "1000", ...v })) f.set(k, x); return f; };
const hasil = async (p: Promise<unknown>) => decodeURIComponent(await p.then(() => "", (e: Error) => e.message));

beforeEach(() => {
  st.writes = []; st.writeError = null; st.rows = []; st.levelColsMissing = false; st.edit = true;
  st.rpc.mockReset(); st.rpc.mockResolvedValue({ data: 3, error: null });
});

describe("simpan golongan + level otomatis", () => {
  it("golongan level disimpan bukan-khusus, lalu pelanggan lama diterapkan", async () => {
    const out = await hasil(simpanKategoriPelanggan(form({ tier_otomatis: "Gold", khusus: "on" })));
    expect(st.writes[0]).toEqual({ op: "insert", patch: { nama: "Gold", diskon_persen: 5, rupiah_per_poin: 1000, tier_otomatis: "Gold", khusus: false } });
    expect(st.rpc).toHaveBeenCalledWith("terapkan_golongan_level");
    expect(out).toContain("success=1&pindah=3");
  });

  it("tanpa level: golongan khusus mengikuti centang", async () => {
    await hasil(simpanKategoriPelanggan(form({ id: "k1", nama: "Reseller", khusus: "on" })));
    expect(st.writes[0]).toEqual({ op: "update", patch: expect.objectContaining({ tier_otomatis: null, khusus: true }) });
    await hasil(simpanKategoriPelanggan(form({ id: "k2", nama: "Umum" })));
    expect(st.writes[1].patch).toMatchObject({ tier_otomatis: null, khusus: false });
  });

  it("level ngawur ditolak sebelum menulis", async () => {
    expect(await hasil(simpanKategoriPelanggan(form({ tier_otomatis: "Diamond" })))).toContain("Level tidak dikenal");
    expect(st.writes).toEqual([]);
  });

  it("level sudah dipakai golongan lain -> pesan jelas", async () => {
    st.writeError = { code: "23505", message: 'duplicate key value violates unique constraint "customer_categories_tier_otomatis_uq"' };
    expect(await hasil(simpanKategoriPelanggan(form({ tier_otomatis: "Gold" })))).toContain("Level Gold sudah dipakai golongan lain");
    expect(st.rpc).not.toHaveBeenCalled();
  });

  it("gagal menerapkan ke pelanggan lama tidak membatalkan simpan", async () => {
    st.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await hasil(simpanKategoriPelanggan(form({ tier_otomatis: "Silver" })))).toContain("success=1&pindah=gagal");
  });

  it("nonaktif/aktifkan golongan juga menerapkan ulang", async () => {
    expect(await hasil(toggleKategoriPelanggan(form({ id: "k1", aktif: "1" })))).toContain("success=1&pindah=3");
    expect(st.writes[0]).toEqual({ op: "update", patch: { is_active: false } });
  });
});

describe("halaman golongan", () => {
  const row = (id: string, nama: string, extra: Record<string, unknown> = {}) => ({ id, nama, diskon_persen: 0, rupiah_per_poin: 1000, is_active: true, tier_otomatis: null, khusus: true, ...extra });

  it("menampilkan kolom level, menandai level yang sudah dipakai, dan pesan pindah", async () => {
    st.rows = [row("g", "Gold", { tier_otomatis: "Gold", khusus: false }), row("r", "Reseller"), row("u", "Umum", { khusus: false })];
    const html = renderToStaticMarkup(await KategoriPelangganPage({ searchParams: Promise.resolve({ success: "1", pindah: "12" }) }));
    expect(html).toContain("Level otomatis");
    expect(html).toContain("Khusus (manual)");
    expect(html).toMatch(/<option value="Gold" disabled="">Gold \(dipakai Gold\)<\/option>/);
    expect(html).toContain("12 pelanggan dipindah ke golongan levelnya.");
  });

  it("migrasi belum terpasang: halaman tetap terbuka tanpa pilihan level", async () => {
    st.levelColsMissing = true;
    st.rows = [row("r", "Reseller")];
    const html = renderToStaticMarkup(await KategoriPelangganPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Reseller");
    expect(html).not.toContain('name="tier_otomatis"');
  });

  it("pesan pindah hanya untuk angka positif atau gagal", () => {
    expect(pesanPindahLevel(undefined)).toBeNull();
    expect(pesanPindahLevel("0")).toBeNull();
    expect(pesanPindahLevel("abc")).toBeNull();
    expect(pesanPindahLevel("gagal")).toMatch(/belum dipindah/);
  });
});
