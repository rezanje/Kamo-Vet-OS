// @vitest-environment jsdom
// Integrasi Promo Paket: daftar promo (label, ringkasan, cabang, Edit/Aktifkan/Nonaktifkan saja), rute editor baru/ubah,
// dan promo Syarat-Hasil SELALU membuka editor baru (editor lama tidak menyentuhnya; promo lama tidak berubah).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  toggleLegacy: vi.fn(), togglePaket: vi.fn(), editorProps: null as null | Record<string, unknown>,
  role: "OWNER", active: true, snapshot: null as unknown, snapshotError: null as null | { message: string }, flag: true as boolean | null, flagError: null as null | { code: string; message: string },
  itemsError: false, promos: [] as Record<string, unknown>[], rpc: [] as { name: string; args: unknown }[],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/app/(app)/crm/promo/actions", () => ({ createPromo: vi.fn(), togglePromo: m.toggleLegacy, editPromo: vi.fn() }));
vi.mock("@/app/(app)/crm/promo/paket/actions", () => ({ ubahStatusPaketDariDaftar: m.togglePaket, simpanPromoPaket: vi.fn(), ubahStatusPromoPaket: vi.fn(), taksirHppPaket: vi.fn(async () => ({ ok: true, rows: [] })) }));
vi.mock("@/app/(app)/crm/promo/paket/PaketEditor", () => ({ PaketEditor: (p: Record<string, unknown>) => { m.editorProps = p; return <div data-testid="editor-stub" />; } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (name: string, args: unknown) => {
      m.rpc.push({ name, args });
      if (name === "read_promo_edit") return { data: m.snapshot, error: m.snapshotError };
      if (name === "promo_release_enabled") return { data: m.flag, error: m.flagError };
      return { data: null, error: null };
    },
    from(table: string) {
      const req = {} as { from?: number; to?: number; ids?: string[]; active?: boolean; type?: string };
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, gt: () => q,
        eq(k: string, v: unknown) { if (k === "is_active") req.active = v as boolean; if (k === "item_type") req.type = v as string; return q; },
        in(k: string, v: string[]) { if (k === "id") req.ids = v; return q; },
        range(a: number, b: number) { req.from = a; req.to = b; return q; },
        maybeSingle: async () => ({ data: { role: m.role, is_active: m.active } }),
        then(res: (v: unknown) => unknown) {
          let rows: Record<string, unknown>[] = [];
          if (table === "promos") rows = m.promos;
          if (table === "branches") rows = [{ id: "b1", code: "B1", name: "Cabang Satu", is_active: true }, { id: "b2", code: "B2", name: "Cabang Dua", is_active: true }];
          if (table === "items") rows = [
            { id: "iIKAN", code: "BLT-IKAN", name: "Bolt Ikan 800gr", unit: "PCS", category_id: null, is_active: true, item_type: "Persediaan" },
            { id: "iDONAT", code: "BLT-DONAT", name: "Bolt Donat 800gr", unit: "PCS", category_id: null, is_active: true, item_type: "Persediaan" },
            { id: "iANC", code: "ANC", name: "ANC Creamy Stick", unit: "PCS", category_id: null, is_active: true, item_type: "Persediaan" },
            { id: "iOLD", code: "OLD", name: "Barang Lama", unit: "PCS", category_id: null, is_active: false, item_type: "Persediaan" },
            { id: "iJASA", code: "JS", name: "Grooming", unit: "X", category_id: null, is_active: true, item_type: "Jasa" },
          ];
          if (table === "item_units") rows = [{ id: "u1", item_id: "iIKAN", unit: "BOX", factor: 12, sell_price: 1 }];
          if (table === "promo_items") rows = [{ promo_id: "sh1", item_id: "iIKAN" }, { promo_id: "sh1", item_id: "iDONAT" }, { promo_id: "sh1", item_id: "iANC" }, { promo_id: "sh2", item_id: "iIKAN" }];
          if (req.active !== undefined) rows = rows.filter((r) => r.is_active === req.active);
          if (req.type) rows = rows.filter((r) => r.item_type === req.type);
          if (req.ids) rows = rows.filter((r) => req.ids!.includes(String(r.id)));
          if (m.itemsError && table === "items") return Promise.resolve({ data: null, count: null, error: { message: "x" } }).then(res);
          return Promise.resolve({ data: rows.slice(req.from ?? 0, req.to === undefined ? 1000 : req.to + 1), count: rows.length, error: null }).then(res);
        },
      };
      return q;
    },
  }),
}));
import ListPage from "@/app/(app)/crm/promo/page";
import EditLegacyPage from "@/app/(app)/crm/promo/[id]/edit/page";
import NewPaketPage from "@/app/(app)/crm/promo/paket/baru/page";
import PaketPage from "@/app/(app)/crm/promo/paket/[id]/page";
import { paketValuesFromForm } from "@/lib/promo-paket";

const SH_ID = "a0000000-0000-4000-8000-0000000000a1";
const shRule = (below = false) => {
  const v = paketValuesFromForm({
    name: "x", branchIds: [], validFrom: "", validUntil: "", repeat: true,
    syarat: [{ kind: "qty", min: "2", items: [{ item_id: "iIKAN", unit: "PCS" }, { item_id: "iDONAT", unit: "PCS" }] }],
    hasil: { items: [{ item_id: "iANC", unit: "PCS" }], rewardQty: "1", discountType: "nominal", value: "1000", maxAmount: "" }, belowHpp: { allowed: false, reason: "" },
  }, "s");
  return { discount_mode: "syarat_hasil", suggest: "s", syarat_hasil: { version: 1, repeat: true, syarat: v.syarat, hasil: v.hasil, below_hpp: below ? { allowed: true, reason: "barang reject sisa", ack_by: "u", ack_at: "t" } : { allowed: false } } };
};
const row = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Promo ${id}`, promo_type: "diskon_produk", rule: {}, is_active: true, branch_ids: [], valid_from: null, valid_until: null, auto_apply: true, min_qty: null, max_qty: null, kelipatan: false, discount_type: "percent", discount_value: 10, ...o });
const shRow = (id: string, o: Record<string, unknown> = {}) => row(id, { promo_type: "bundling", rule: shRule(), discount_type: null, discount_value: null, kelipatan: true, is_active: false, ...o });

let host: HTMLDivElement, root: Root;
const renderNode = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const list = async (sp: Record<string, string> = {}) => renderNode(await ListPage({ searchParams: Promise.resolve(sp) }));
const rowOf = (id: string) => [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(`Promo ${id}`)) as HTMLElement | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T03:00:00Z"));
  sessionStorage.clear(); m.toggleLegacy.mockReset(); m.togglePaket.mockReset(); m.editorProps = null; m.rpc = [];
  Object.assign(m, { role: "OWNER", active: true, snapshot: null, snapshotError: null, flag: true, flagError: null, itemsError: false, promos: [row("legacy1"), shRow("sh1"), shRow("sh2", { is_active: true, branch_ids: ["b1"] })] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

// ───────────── daftar promo ─────────────
it("a syarat_hasil promo shows as 'Promo Paket' with a readable rule summary; legacy rows are untouched", async () => {
  await list();
  const sh = rowOf("sh1")!;
  expect(sh.textContent).toContain("Promo Paket");
  expect(sh.textContent).not.toContain("bundling");
  expect(sh.textContent).toContain("Bolt Ikan 800gr / Bolt Donat 800gr (campur varian)");
  expect(sh.textContent).toContain("ANC Creamy Stick potongan Rp1.000/unit");
  const legacy = rowOf("legacy1")!;
  expect(legacy.textContent).toContain("diskon produk");
  expect(legacy.textContent).not.toContain("Promo Paket");
});

it("Edit opens the new editor for Promo Paket and the old one for legacy promos", async () => {
  await list();
  expect(rowOf("sh1")!.querySelector("a[href^='/crm/promo/paket/']")!.getAttribute("href")).toBe("/crm/promo/paket/sh1");
  expect(rowOf("sh1")!.querySelector("a[href$='/edit']")).toBeNull();
  expect(rowOf("legacy1")!.querySelector("a")!.getAttribute("href")).toBe("/crm/promo/legacy1/edit");
});

it("list buttons: Aktifkan/Nonaktifkan only, routed to the paket action for Promo Paket and to the old action for legacy; never delete", async () => {
  await list();
  const submit = async (id: string) => { const f = rowOf(id)!.querySelector("form")!; await act(async () => { f.requestSubmit(); }); };
  await submit("sh1");
  expect(m.togglePaket).toHaveBeenCalledTimes(1);
  expect(m.toggleLegacy).not.toHaveBeenCalled();
  const fd = m.togglePaket.mock.calls[0][0] as FormData;
  expect({ id: fd.get("id"), active: fd.get("active"), was: fd.get("was") }).toEqual({ id: "sh1", active: "1", was: "0" });
  await submit("sh2");
  const fd2 = m.togglePaket.mock.calls[1][0] as FormData;
  expect({ active: fd2.get("active"), was: fd2.get("was") }).toEqual({ active: "0", was: "1" });
  await submit("legacy1");
  expect(m.toggleLegacy).toHaveBeenCalledTimes(1);
  expect(rowOf("sh1")!.textContent).toContain("Aktifkan");
  expect(rowOf("sh2")!.textContent).toContain("Nonaktifkan");
  const buttons = [...rowOf("sh1")!.querySelectorAll("button,a")].map((e) => e.textContent!.trim());
  expect(buttons.join("|")).not.toMatch(/hapus|delete/i);
});

it("branch filter works for Promo Paket (promo limited to Cabang Satu hidden under Cabang Dua, all-branch ones always shown)", async () => {
  await list({ cabang: "b2" });
  expect(rowOf("sh2")).toBeUndefined();
  expect(rowOf("sh1")).toBeTruthy();
  await list({ cabang: "b1" });
  expect(rowOf("sh2")).toBeTruthy();
  expect(rowOf("sh2")!.textContent).toContain("Cabang Satu");
});

it("shows the success/error banners of the paket toggle in Indonesian", async () => {
  await list({ success: "paket-aktif" });
  expect(host.textContent).toContain("Promo paket diaktifkan.");
  await list({ success: "paket-nonaktif" });
  expect(host.textContent).toContain("Promo paket dinonaktifkan.");
  await list({ error: "Fitur promo paket belum dirilis oleh Owner." });
  expect(host.textContent).toContain("Fitur promo paket belum dirilis oleh Owner.");
});

it("a 'Buat Promo Paket' entry is offered to managers only, next to the Promo/Voucher tabs (PR #362 import block untouched)", async () => {
  await list();
  const link = [...host.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/crm/promo/paket/baru");
  expect(link?.textContent).toContain("Promo Paket");
  m.role = "STAFF";
  await list();
  expect([...host.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/crm/promo/paket/baru")).toBe(false);
});

// ───────────── legacy editor routing ─────────────
it("the legacy edit URL of a syarat_hasil promo redirects to the new editor, before loading any option lists", async () => {
  m.snapshot = { version: "a".repeat(32), item_ids: [], promo: { id: SH_ID, name: "n", promo_type: "bundling", rule: shRule(), is_active: false, branch_ids: [], valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: true, auto_apply: true, discount_type: null, discount_value: null } };
  await expect(EditLegacyPage({ params: Promise.resolve({ id: SH_ID }) })).rejects.toThrow(`REDIRECT /crm/promo/paket/${SH_ID}`);
});

it("a legacy promo still opens the legacy editor (no redirect)", async () => {
  m.snapshot = { version: "a".repeat(32), item_ids: [], promo: { id: SH_ID, name: "Lama", promo_type: "diskon_produk", rule: { suggest: "x" }, is_active: false, branch_ids: [], valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: false, auto_apply: false, discount_type: null, discount_value: null } };
  await renderNode(await EditLegacyPage({ params: Promise.resolve({ id: SH_ID }) }));
  expect(host.textContent).toContain("Edit promo");
});

// ───────────── rute editor ─────────────
it("/paket/baru: managers get an empty editor with active Persediaan items (units merged, Jasa/inactive excluded), branches, role and the release flag", async () => {
  await renderNode(await NewPaketPage());
  const p = m.editorProps!;
  expect(p.mode).toBe("baru"); expect(p.role).toBe("OWNER"); expect(p.released).toBe(true);
  const items = p.items as { id: string; units: string[]; active: boolean }[];
  expect(items.map((i) => i.id).sort()).toEqual(["iANC", "iDONAT", "iIKAN"]);
  expect(items.find((i) => i.id === "iIKAN")!.units).toEqual(["PCS", "BOX"]);
  expect((p.branches as unknown[]).length).toBe(2);
  expect((p.initialForm as { validFrom: string }).validFrom).toBe("2026-11-04");
  expect(p.today).toBe("2026-11-04");
});

it.each(["STAFF", "KASIR", "DOCTOR"])("/paket/baru refuses %s without rendering the editor", async (role) => {
  m.role = role;
  await renderNode(await NewPaketPage());
  expect(m.editorProps).toBeNull();
  expect(host.textContent).toContain("Hanya owner/manajer aktif");
});
it("/paket/baru refuses a deactivated manager and an unreadable catalog (no partial editor)", async () => {
  m.active = false;
  await renderNode(await NewPaketPage());
  expect(m.editorProps).toBeNull();
  m.active = true; m.itemsError = true;
  await renderNode(await NewPaketPage());
  expect(m.editorProps).toBeNull();
  expect(host.textContent).toContain("belum dapat dimuat lengkap");
});
it("release flag: OFF, unreadable and missing-function all mean 'not released' (the editor still opens, activation is explained)", async () => {
  m.flag = false;
  await renderNode(await NewPaketPage());
  expect(m.editorProps!.released).toBe(false);
  Object.assign(m, { flag: null, flagError: { code: "42883", message: "function does not exist" } });
  await renderNode(await NewPaketPage());
  expect(m.editorProps!.released).toBe(false);
});

it("/paket/[id]: opens the stored promo with the page version token, the form built from the rule, and active state", async () => {
  m.snapshot = { version: "c".repeat(32), item_ids: ["iIKAN"], promo: { id: SH_ID, name: "Beli 2 Bolt", promo_type: "bundling", rule: shRule(true), is_active: true, branch_ids: ["b1"], valid_from: "2026-11-04", valid_until: null, min_qty: null, max_qty: null, kelipatan: true, auto_apply: true, discount_type: null, discount_value: null } };
  await renderNode(await PaketPage({ params: Promise.resolve({ id: SH_ID }) }));
  const p = m.editorProps!;
  expect(m.rpc.find((c) => c.name === "read_promo_edit")!.args).toEqual({ p_id: SH_ID });
  expect(p).toMatchObject({ mode: "ubah", promoId: SH_ID, version: "c".repeat(32), active: true });
  expect(p.initialForm).toMatchObject({ name: "Beli 2 Bolt", branchIds: ["b1"], belowHpp: { allowed: true, reason: "barang reject sisa" } });
});
it("/paket/[id]: bad id, STAFF, unreadable promo → no editor; a LEGACY promo is sent to the legacy editor", async () => {
  await renderNode(await PaketPage({ params: Promise.resolve({ id: "not-a-uuid" }) }));
  expect(m.editorProps).toBeNull();
  m.role = "STAFF";
  await renderNode(await PaketPage({ params: Promise.resolve({ id: SH_ID }) }));
  expect(m.editorProps).toBeNull();
  expect(m.rpc).toEqual([]);
  m.role = "ADMIN"; m.snapshotError = { message: "private failure" };
  await renderNode(await PaketPage({ params: Promise.resolve({ id: SH_ID }) }));
  expect(m.editorProps).toBeNull();
  expect(host.textContent).not.toContain("private");
  m.snapshotError = null;
  m.snapshot = { version: "a".repeat(32), item_ids: [], promo: { id: SH_ID, name: "Lama", promo_type: "diskon_produk", rule: { suggest: "x" }, is_active: false, branch_ids: [], valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: false, auto_apply: false, discount_type: null, discount_value: null } };
  await expect(PaketPage({ params: Promise.resolve({ id: SH_ID }) })).rejects.toThrow(`REDIRECT /crm/promo/${SH_ID}/edit`);
});
it("/paket/[id]: items used by the promo but now inactive stay visible (named, marked nonaktif) so nothing silently disappears", async () => {
  const rule = shRule();
  ((rule.syarat_hasil.syarat as unknown[])[0] as { items: { item_id: string; unit: string }[] }).items.push({ item_id: "iOLD", unit: "PCS" });
  m.snapshot = { version: "c".repeat(32), item_ids: [], promo: { id: SH_ID, name: "n", promo_type: "bundling", rule, is_active: false, branch_ids: [], valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: true, auto_apply: true, discount_type: null, discount_value: null } };
  await renderNode(await PaketPage({ params: Promise.resolve({ id: SH_ID }) }));
  const old = (m.editorProps!.items as { id: string; name: string; active: boolean }[]).find((i) => i.id === "iOLD")!;
  expect(old).toMatchObject({ active: false, name: "Barang Lama (nonaktif)" });
});
