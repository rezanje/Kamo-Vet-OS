import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Perintah stok opname untuk gudang klinik & DC (laporan Andri, 2 Nov 2026): backoffice bisa
// membuat perintah dan menghitung langsung untuk gudang non-toko; gudang toko tetap lewat kasir.
const s = vi.hoisted(() => ({ order: null as Record<string, unknown> | null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: unknown; href: string }) => <a {...props}>{children as never}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (u: string) => { throw Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/opname-cancellation", () => ({ opnameWarehouseIds: async () => ["wh"], opnameCancellationBlock: async () => null }));
vi.mock("@/lib/opname-result-presence", () => ({ opnameHasResult: async () => false }));
vi.mock("@/components/OpnameCancellationPanel", () => ({ OpnameCancellationPanel: () => null }));
vi.mock("@/app/kasir/opname/[id]/DaftarHitung", () => ({ DaftarHitung: (p: { kembali: string }) => <div data-testid="hitung">HITUNG:{p.kembali}</div> }));
vi.mock("@/app/(app)/pos/opname/[id]/HasilView", () => ({ HasilView: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from() {
    const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => ({ data: s.order }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ count: 0, data: [] }).then(r) };
    return q;
  },
}) }));
import Detail from "@/app/(app)/pos/opname/[id]/page";

const order = (type: string) => ({ id: "o1", no_opname: "OPO.00006", tanggal_mulai: "2026-11-02", penanggung_jawab: "Fiksi", dikerjakan_oleh: null,
  keterangan: null, status: "Terbuka", cancelled_at: null, cancelled_by: null, cancelled_by_name: null, cancel_reason: null,
  warehouse_id: "wh", warehouses: { name: `WH ${type}`, type } });
const render = async () => renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve({}) }));

beforeEach(() => { s.order = null; });

it.each(["VET", "DC"])("gudang %s dihitung langsung dari backoffice", async (type) => {
  s.order = order(type);
  const html = await render();
  expect(html).toContain("HITUNG:pos");
  expect(html).not.toContain("HITUNGAN BELUM MASUK");
});

it("gudang toko tetap dihitung dari layar kasir (satu pintu)", async () => {
  s.order = order("RETAIL");
  const html = await render();
  expect(html).not.toContain("HITUNG:pos");
  expect(html).toContain("HITUNGAN BELUM MASUK");
});
