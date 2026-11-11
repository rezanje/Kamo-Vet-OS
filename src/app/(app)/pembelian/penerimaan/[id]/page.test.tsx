import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER", active: true, voided: null as string | null,
  access: { data: { batalkan_penerimaan: false }, error: null } as unknown,
  preview: { data: null, error: null } as unknown, previewCalls: 0, accessCalls: 0,
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    rpc: async (name: string) => {
      if (name === "preview_goods_receipt_cancellation") { state.previewCalls++; if (state.preview === "throw") throw new Error("x"); return state.preview; }
      state.accessCalls++; if (state.access === "throw") throw new Error("kebijakan tidak terbaca"); return state.access;
    },
    from(table: string) {
      const rows = table === "goods_receipts" ? {
        id: "rc1", po_id: "po1", no_terima: "TB.FIKSI", tanggal: "2026-11-01", surat_jalan: null, catatan: null, voided_at: state.voided, voided_on: null, void_reason: null,
        purchase_orders: { id: "po1", no_po: "PO.FIKSI", status: "Dipesan", branches: { name: "Cabang" }, warehouses: { name: "Gudang" }, suppliers: { nama: "Pemasok" } }, profiles: null, goods_receipt_items: [],
      } : table === "profiles" ? { role: state.role, is_active: state.active } : null;
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
        maybeSingle: async () => ({ data: rows, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return q;
    },
  }),
}));

import DetailPenerimaanPage from "./page";

const render = async () => renderToStaticMarkup(await DetailPenerimaanPage({ params: Promise.resolve({ id: "rc1" }), searchParams: Promise.resolve({}) }));
const canPreview = { receipt_id: "rc1", no_terima: "TB.FIKSI", po_id: "po1", no_po: "PO.FIKSI", tanggal: "2026-11-01", already_cancelled: false, can_cancel: true, blockers: [], average: false, effects: { total: 1000, stock: [{ item_id: "i", nama: "Barang A", qty: 10 }] } };
const blocked = { ...canPreview, can_cancel: false, blockers: [{ code: "faktur_aktif", message: "Batalkan dulu faktur FB.FIKSI yang memakai penerimaan ini.", docs: [{ kind: "purchase-invoice", id: "inv1", label: "Faktur FB.FIKSI" }] }] };

beforeEach(() => { state.role = "OWNER"; state.active = true; state.voided = null; state.access = { data: { batalkan_penerimaan: false }, error: null }; state.preview = { data: canPreview, error: null }; state.previewCalls = 0; state.accessCalls = 0; });

it("OWNER melihat pratinjau 'bisa dibatalkan' dan tombol batal tanpa membaca kebijakan", async () => {
  const html = await render();
  expect(html).toContain("Bisa dibatalkan.");
  expect(html).toContain("Batalkan penerimaan");
  expect(html).toContain("Barang A 10");
  expect(state.accessCalls).toBe(0);
});

it("OWNER tetap melihat tombol batal walau pratinjau gagal dimuat (database tetap memeriksa)", async () => {
  state.preview = "throw";
  const html = await render();
  expect(html).toContain("Pratinjau pembatalan belum dapat dimuat");
  expect(html).toContain("Batalkan penerimaan");
});

it("pratinjau yang menghalangi menyebut langkah dan tautan dokumen, dan tombol tetap ada untuk OWNER", async () => {
  state.preview = { data: blocked, error: null };
  const html = await render();
  expect(html).toContain("Belum bisa dibatalkan. Lakukan dulu:");
  expect(html).toContain("Batalkan dulu faktur FB.FIKSI");
  expect(html).toContain("Faktur FB.FIKSI");
  expect(html).toContain("database memeriksa ulang");
});

it("ADMIN dengan izin Akses Grup melihat tombol; tanpa izin atau galat baca tidak", async () => {
  state.role = "ADMIN"; state.access = { data: { batalkan_penerimaan: true }, error: null };
  expect(await render()).toContain("Batalkan penerimaan");
  state.access = { data: { batalkan_penerimaan: false }, error: null }; state.previewCalls = 0;
  let html = await render();
  expect(html).not.toContain("Batalkan penerimaan");
  expect(state.previewCalls).toBe(0);
  state.access = "throw";
  html = await render();
  expect(html).not.toContain("Batalkan penerimaan");
});

it("penerimaan yang sudah dibatalkan tidak menawarkan pembatalan lagi", async () => {
  state.voided = "2026-11-02T00:00:00Z";
  const html = await render();
  expect(html).not.toContain("Bisa dibatalkan.");
  expect(state.previewCalls).toBe(0);
});
