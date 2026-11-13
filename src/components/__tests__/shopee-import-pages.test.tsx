import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ role: "STAFF", active: true, warehouses: [] as unknown[], whError: null as unknown,
  allowed: null as string[] | null, cookie: undefined as string | undefined }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => db.allowed }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (db.cookie ? { value: db.cookie } : undefined) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "is", "order", "limit"]) q[m] = () => q;
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

const wh = (id: string, branch: string, type = "ONLINE") => ({ id, name: `Online ${branch}`, branch_id: `b-${branch}`, type, branches: { name: branch } });
beforeEach(() => { db.role = "STAFF"; db.active = true; db.warehouses = [wh("w-pusat", "Kamo Pusat"), wh("w-pandu", "Kamo Panduraya")]; db.whError = null; db.allowed = null; db.cookie = undefined; });

it("halaman Penjualan Online punya tombol 'Impor dari Shopee' ke /penjualan/online/impor", async () => {
  const html = renderToStaticMarkup(await PenjualanOnlinePage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('href="/penjualan/online/impor"');
  expect(html).toContain("Impor dari Shopee");
  expect(html).toContain('href="/penjualan/online/baru"');
});

// E4 (meeting 12 Nov 2026): pilih CABANG, gudang ditentukan sistem (gudang utama cabang).
// Cookie cabang aktif hanya menerima UUID (parseBranchContext), jadi cabang Panduraya memakai UUID fiktif.
const PDRY = "99999999-9999-4999-8999-999999999999";
const tiga = () => [
  { ...wh("w-toko", "Kamo Panduraya", "RETAIL"), branch_id: PDRY, name: "WH PDRY" },
  { ...wh("w-pandu", "Kamo Panduraya"), branch_id: PDRY, name: "WH ONLINE PDRY" },
  { ...wh("w-pusat", "Kamo Pusat", "RETAIL"), name: "WH PUSAT" },
];

it("akun satu cabang: gudang terkunci otomatis ke gudang Toko cabangnya, tanpa pilihan", async () => {
  db.allowed = [PDRY];
  db.warehouses = tiga();
  const html = renderToStaticMarkup(await ImporShopeePage());
  expect(html).toContain("Kamo Panduraya · WH PDRY");
  expect(html).toContain("Otomatis dari cabang akun ini.");
  expect(html).not.toContain('aria-label="Cabang impor"');
  expect(html).not.toContain("WH ONLINE PDRY");
});

it("akun multi-cabang memilih CABANG; bawaan = cabang petshop aktif dari cookie; gudang online terpisah tidak ditawarkan", async () => {
  db.warehouses = tiga();
  db.cookie = JSON.stringify({ userId: "u", branchId: PDRY });
  const html = renderToStaticMarkup(await ImporShopeePage());
  expect(html).toContain('aria-label="Cabang impor"');
  expect(html).toContain("Kamo Panduraya</option>");
  expect(html).toContain("Kamo Pusat</option>");
  expect(html).toContain("Gudang otomatis: <b>WH PDRY</b>");
  expect(html).not.toContain("WH ONLINE PDRY");
});

it("tanpa cookie cabang aktif: belum ada pilihan bawaan (wajib memilih cabang)", async () => {
  expect(renderToStaticMarkup(await ImporShopeePage())).not.toMatch(/<option value="b-[^"]+" selected/);
});

it("tanpa gudang online / galat memuat gudang -> pesan, bukan formulir", async () => {
  db.warehouses = [];
  expect(renderToStaticMarkup(await ImporShopeePage())).toMatch(/belum terhubung ke cabang/);
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
