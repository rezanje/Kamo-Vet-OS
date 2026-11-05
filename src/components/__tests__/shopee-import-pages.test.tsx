import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ role: "STAFF", active: true, warehouses: [] as unknown[], whError: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "is", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { role: db.role, is_active: db.active }, error: null });
      q.then = (ok: (v: unknown) => unknown) => ok(table === "warehouses" ? { data: db.warehouses, error: db.whError } : { data: [], error: null });
      return q;
    },
  }),
}));
vi.mock("@/app/(app)/penjualan/online/actions", () => ({ tandaiCair: vi.fn() }));
vi.mock("@/app/(app)/penjualan/online/impor/actions", () => ({ pratinjauImporShopee: vi.fn(), simpanImporShopee: vi.fn() }));
import ImporShopeePage from "@/app/(app)/penjualan/online/impor/page";
import PenjualanOnlinePage from "@/app/(app)/penjualan/online/page";

const wh = (id: string, branch: string) => ({ id, name: `Online ${branch}`, branches: { name: branch } });
beforeEach(() => { db.role = "STAFF"; db.active = true; db.warehouses = [wh("w-pusat", "Kamo Pusat"), wh("w-pandu", "Kamo Panduraya")]; db.whError = null; });

it("halaman Penjualan Online punya tombol 'Impor dari Shopee' ke /penjualan/online/impor", async () => {
  const html = renderToStaticMarkup(await PenjualanOnlinePage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('href="/penjualan/online/impor"');
  expect(html).toContain("Impor dari Shopee");
  expect(html).toContain('href="/penjualan/online/baru"');
});

it("halaman impor: gudang cabang Panduraya terpilih otomatis bila hanya satu", async () => {
  const html = renderToStaticMarkup(await ImporShopeePage());
  expect(html).toMatch(/<option value="w-pandu" selected(="")?>/);
  expect(html).toContain("Impor pesanan Shopee");
});

it("lebih dari satu gudang Panduraya atau tidak ada -> tidak ada pilihan bawaan (wajib memilih)", async () => {
  db.warehouses = [wh("w1", "Panduraya A"), wh("w2", "Panduraya B")];
  expect(renderToStaticMarkup(await ImporShopeePage())).not.toMatch(/<option value="w\d" selected/);
});

it("tanpa gudang online / galat memuat gudang -> pesan, bukan formulir", async () => {
  db.warehouses = [];
  expect(renderToStaticMarkup(await ImporShopeePage())).toMatch(/Belum ada gudang/);
  db.whError = { message: "x" };
  expect(renderToStaticMarkup(await ImporShopeePage())).toMatch(/Gagal memuat daftar gudang/);
});

it("kotak 'Sertakan' pesanan dilewati hanya dirender untuk Owner (isOwner diturunkan dari profil)", async () => {
  // isOwner diteruskan ke workspace; diperiksa lewat prop pada elemen yang dikembalikan halaman.
  const find = (node: unknown): { isOwner?: boolean } | null => {
    if (!node || typeof node !== "object") return null;
    const el = node as { props?: Record<string, unknown> };
    if (el.props && "isOwner" in el.props) return el.props as { isOwner?: boolean };
    const kids = el.props?.children;
    for (const k of Array.isArray(kids) ? kids : [kids]) { const r = find(k); if (r) return r; }
    return null;
  };
  db.role = "OWNER"; expect(find(await ImporShopeePage())?.isOwner).toBe(true);
  db.role = "ADMIN"; expect(find(await ImporShopeePage())?.isOwner).toBe(false);
  db.role = "OWNER"; db.active = false; expect(find(await ImporShopeePage())?.isOwner).toBe(false);
});
