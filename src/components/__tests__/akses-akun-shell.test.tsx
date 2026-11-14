// @vitest-environment jsdom
// E3 (meeting 12 Nov 2026): akun STAFF dengan akses khusus memakai sidebar biasa berisi menu yang dicentang Owner
// (bukan tampilan kasir klinik lama), dan sidebar/pintasan menampilkan persis yang lolos middleware.
import { act, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, type Call } from "@/lib/__tests__/helpers/round-trip-client";
import { terapkanAksesAkun } from "@/lib/akses-akun";
import { bolehBukaPath } from "@/lib/akses";

const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, role: "STAFF", override: null as unknown, path: "/penjualan/online" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => s.path }));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));
import AppLayout from "@/app/(app)/layout";
import { Sidebar } from "@/components/Sidebar";
import { KlinikTopbar } from "@/components/KlinikTopbar";

function respond(call: Call) {
  if (call.kind === "rpc") return call.name === "get_my_access_override" ? { data: s.override } : { data: [] };
  if (call.kind !== "from") return {};
  switch (call.name) {
    case "profiles": return { data: { full_name: "Staf Online Fiktif", role: s.role, is_active: true } };
    case "branches": return { data: [] };
    case "role_modules": return { data: [] };
    case "cashier_shifts": return { data: null };
    default: return { data: [] };
  }
}

function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(n => find(n, type));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [...(el.type === type ? [el] : []), ...find(el.props.children as ReactNode, type)];
}
const layout = async () => { s.rt = roundTripClient(respond); return AppLayout({ children: null }); };

let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); s.role = "STAFF"; s.override = null; s.path = "/penjualan/online"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("STAFF tanpa akses khusus: tampilan kasir klinik lama persis (tanpa sidebar)", async () => {
  const tree = await layout();
  expect(find(tree, Sidebar)).toHaveLength(0);
  expect(find(tree, KlinikTopbar)).toHaveLength(1);
});

it("STAFF 'Hanya akses khusus' Penjualan Online: sidebar biasa, aturannya = akses efektif", async () => {
  s.override = { mode: "khusus", modules: { penjualan: ["penjualan.online"] } };
  const tree = await layout();
  const [sidebar] = find(tree, Sidebar);
  expect(sidebar).toBeTruthy();
  expect(find(tree, KlinikTopbar)).toHaveLength(0);
  const rules = sidebar.props.aksesModul as Parameters<typeof bolehBukaPath>[2];
  expect(bolehBukaPath("STAFF", "/penjualan/online", rules)).toBe(true);
  expect(bolehBukaPath("STAFF", "/klinik", rules)).toBe(false);
  // dibaca bersamaan: tetap paling banyak 2 putaran berurutan
  expect(s.rt!.depth()).toBeLessThanOrEqual(2);
});

it("gagal baca akses khusus: kembali ke tampilan peran (tidak pernah memperluas)", async () => {
  s.override = "bentuk-aneh";
  const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const tree = await layout();
  err.mockRestore();
  expect(find(tree, Sidebar)).toHaveLength(0);
  expect(find(tree, KlinikTopbar)).toHaveLength(1);
});

it.each([
  ["Hanya akses khusus", { mode: "khusus" as const, modules: { penjualan: ["penjualan.online"] } }, ["/penjualan/online"]],
  ["Peran + tambahan", { mode: "tambah" as const, modules: { penjualan: ["penjualan.online"] } }, ["/klinik", "/kasir", "/penjualan/online"]],
])("sidebar %s: hanya menu yang lolos middleware, Penjualan mendarat di Penjualan Online", async (_name, akses, hrefs) => {
  const rules = terapkanAksesAkun("STAFF", [], akses);
  await act(async () => root.render(<Sidebar branches={[]} fullName="Staf Online Fiktif" role="STAFF" aksesModul={rules} />));
  const links = [...host.querySelectorAll<HTMLAnchorElement>(".sb-nav a")].map(a => a.getAttribute("href")!);
  expect(links).toEqual(hrefs);
  expect(links.every(h => bolehBukaPath("STAFF", h, rules))).toBe(true);
});
