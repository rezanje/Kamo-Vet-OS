// Gerbang peran dan Akses Grup untuk kartu dashboard stok dan halaman/unduhannya.
import { describe, expect, it, vi } from "vitest";
import { muatKartuStok, periksaAksesStok } from "../stok-analisis-server";
import { HALAMAN_ORDER, HALAMAN_SLOW } from "../stok-analisis";

type Opsi = {
  role?: string; aktif?: boolean; user?: boolean; rules?: { role: string; module_id: string }[];
  policy?: unknown; policyError?: boolean; stok?: unknown; stokError?: { code: string } | null;
};
const baris = (o: Record<string, unknown>) => ({
  id: "i", kode: "K", nama: "Barang", satuan: "PCS", kategori_id: null, aktif: true, min_stock: 0, supplier_id: null,
  buy_unit: null, min_buy: 0, buy_price: 0, stok: 0, nilai: 0, stok_sejak: "2026-11-01", keluar: 0, modal_keluar: 0, terakhir: null, biaya_terakhir: 0, ...o,
});
const STOK = {
  hari_ini: "2026-11-13", jendela_hari: 90, riwayat_mulai: "2026-11-01", riwayat_hari: 13, gudang_id: null,
  baris: [
    baris({ id: "slow", nama: "Kandang", stok: 5, nilai: 5_000_000 }),
    baris({ id: "habis", nama: "Pasir", stok: 0, keluar: 28, modal_keluar: 100_000, terakhir: "2026-11-12", biaya_terakhir: 1000 }),
  ],
};

function klien(o: Opsi = {}) {
  const panggilan: string[] = [];
  const role = o.role ?? "OWNER";
  const c = {
    panggilan,
    auth: { getUser: async () => ({ data: { user: o.user === false ? null : { id: "u1" } }, error: null }) },
    from(tabel: string) {
      panggilan.push(`from:${tabel}`);
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
        maybeSingle: async () => ({ data: { role, is_active: o.aktif ?? true }, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(tabel === "role_modules"
          ? { data: o.rules ?? [], error: null } : { data: [], count: 0, error: null }).then(res),
      };
      return q;
    },
    rpc: async (nama: string) => {
      panggilan.push(`rpc:${nama}`);
      if (nama === "get_my_submenu_policy") return o.policyError ? { data: null, error: { code: "XX000", message: "boom" } } : { data: o.policy ?? [], error: null };
      if (nama === "laporan_stok_analisis") return o.stokError ? { data: null, error: o.stokError } : { data: o.stok ?? STOK, error: null };
      return { data: null, error: { code: "42883" } };
    },
  };
  return c;
}

describe("muatKartuStok: siapa yang melihat kartu", () => {
  it.each([["STAFF"], ["DOCTOR"], [""], [null]])("peran %s tidak melihat dan tidak menyentuh database", async (role) => {
    const c = klien({ role: String(role) });
    expect(await muatKartuStok(c, role as string | null)).toBeNull();
    expect(c.panggilan).toEqual([]);
  });
  it.each([["OWNER"], ["ADMIN"], ["FINANCE"]])("%s tanpa pembatasan sub-menu melihat kedua kartu", async (role) => {
    const hasil = await muatKartuStok(klien({ role }), role);
    expect(hasil && hasil.galat === undefined).toBe(true);
    if (!hasil || hasil.galat !== undefined) return;
    expect(hasil.slow?.jumlah).toBe(1);
    expect(hasil.order?.jumlah).toBe(1);
    expect(hasil.label).toBe("riwayat baru 13 hari");
    expect(hasil.riwayatBaru).toBe(true);
    // 28 terjual / 14 hari = 2 per hari => sasaran 60, perkiraan dari biaya masuk terakhir
    expect(hasil.order?.top[0].qtyPesan).toBe(60);
    expect(hasil.order?.nilai).toBe(60_000);
  });
  it("ADMIN yang laporannya dipilih satu-satu: hanya kartu yang halamannya dicentang", async () => {
    const rules = [{ role: "ADMIN", module_id: "laporan" }];
    const hanyaSlow = await muatKartuStok(klien({ role: "ADMIN", rules, policy: [{ role: "ADMIN", module_id: "laporan", allowed: ["laporan.stok-slow-moving"] }] }), "ADMIN");
    expect(hanyaSlow && hanyaSlow.galat === undefined && [hanyaSlow.slow !== null, hanyaSlow.order !== null]).toEqual([true, false]);
    const tidakAda = await muatKartuStok(klien({ role: "ADMIN", rules, policy: [{ role: "ADMIN", module_id: "laporan", allowed: ["laporan.kpi"] }] }), "ADMIN");
    expect(tidakAda).toBeNull();
  });
  it("galat fungsi database menjadi kartu galat, tidak melempar", async () => {
    const hasil = await muatKartuStok(klien({ stokError: { code: "PGRST202" } }), "OWNER");
    expect(hasil).toEqual({ galat: "Fungsi laporan stok belum terpasang di database." });
    const lain = await muatKartuStok(klien({ stokError: { code: "XX000" } }), "OWNER");
    expect(lain && lain.galat).toContain("belum dapat dibaca");
  });
  it("klien yang rusak total (tanpa rpc) tidak menjatuhkan dashboard", async () => {
    const hasil = await muatKartuStok({ from: () => ({}) }, "OWNER");
    expect(hasil && hasil.galat).toBeTruthy();
  });
});

describe("periksaAksesStok: gerbang halaman dan unduhan", () => {
  it("OWNER boleh; pengguna tanpa sesi atau akun nonaktif tidak", async () => {
    expect((await periksaAksesStok(klien({ role: "OWNER" }), HALAMAN_SLOW)).ok).toBe(true);
    expect((await periksaAksesStok(klien({ user: false }), HALAMAN_SLOW)).ok).toBe(false);
    expect((await periksaAksesStok(klien({ role: "OWNER", aktif: false }), HALAMAN_SLOW)).ok).toBe(false);
  });
  it("sub-menu dari Akses Grup ditegakkan: ADMIN tanpa centang ditolak, dengan centang boleh", async () => {
    const rules = [{ role: "ADMIN", module_id: "laporan" }];
    const tanpa = klien({ role: "ADMIN", rules, policy: [{ role: "ADMIN", module_id: "laporan", allowed: ["laporan.kpi"] }] });
    expect((await periksaAksesStok(tanpa, HALAMAN_ORDER)).ok).toBe(false);
    const dengan = klien({ role: "ADMIN", rules, policy: [{ role: "ADMIN", module_id: "laporan", allowed: ["laporan.stok-harus-order"] }] });
    expect((await periksaAksesStok(dengan, HALAMAN_ORDER)).ok).toBe(true);
    expect((await periksaAksesStok(dengan, HALAMAN_SLOW)).ok).toBe(false);
  });
  it("kebijakan sub-menu tidak terbaca: gagal tertutup untuk ADMIN, OWNER tetap boleh", async () => {
    expect((await periksaAksesStok(klien({ role: "ADMIN", policyError: true }), HALAMAN_SLOW)).ok).toBe(false);
    expect((await periksaAksesStok(klien({ role: "OWNER", policyError: true }), HALAMAN_SLOW)).ok).toBe(true);
  });
  it("STAFF dengan modul klinik saja tidak boleh membuka laporan stok", async () => {
    const c = klien({ role: "STAFF", rules: [{ role: "STAFF", module_id: "klinik" }] });
    expect((await periksaAksesStok(c, HALAMAN_SLOW)).ok).toBe(false);
  });
  it("galat apa pun saat membaca = ditolak", async () => {
    const c = klien();
    c.auth.getUser = async () => { throw new Error("jaringan"); };
    expect((await periksaAksesStok(c, HALAMAN_SLOW)).ok).toBe(false);
  });
});

describe("pendaftaran halaman", () => {
  it("dua halaman terdaftar di Akses Grup (sub-menu) dan di menu Daftar Laporan", async () => {
    const { SUBMENU_ENTRIES } = await import("../submenu-access");
    const { TILES } = await import("../nav");
    for (const [id, href] of [["laporan.stok-slow-moving", HALAMAN_SLOW], ["laporan.stok-harus-order", HALAMAN_ORDER]]) {
      expect(SUBMENU_ENTRIES.some((e) => e.id === id && e.module === "laporan" && e.routes.includes(href))).toBe(true);
      expect(TILES.laporan.some((t) => t.href === href)).toBe(true);
    }
    vi.resetModules();
  });
});
