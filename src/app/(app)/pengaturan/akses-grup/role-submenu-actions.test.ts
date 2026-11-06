import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), profile: { role: "OWNER", is_active: true }, redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`); }), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile }) }) }) }), rpc: mocks.rpc }) }));
import { saveRoleSettings } from "./actions";
import { parseRoleAccessConfig } from "@/lib/role-access-catalog";
import { roleRpcFailure } from "@/lib/role-action-access";
import { selectableSubmenus } from "@/lib/submenu-access";

const revision = "a".repeat(32), key = "12345678-1234-4123-8123-123456789abc";
const catalog = [{ id: "bank.cash_entry.view_history", label: "Lihat riwayat kas", group: "Kas & Bank", enforced: true }];
let submenus: Record<string, string[]> | undefined;
const snapshot = () => ({ role: "ADMIN", revision, source: "defaults", modules: [], capabilities: { all_branches: true, create_accounts: true }, audit: [], actions: { source: "legacy", allowed: [] }, action_catalog: catalog, ...(submenus ? { submenus } : {}) });
const ids = (m: string) => selectableSubmenus(m).map(x => x.id);
function form(extra: Record<string, string> = {}, drop: string[] = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ role: "ADMIN", expected_revision: revision, requestKey: key, draft_key: key, draft_scope: `role-access:ADMIN:${revision}`, mode: "custom", reason: "Batasi sub-menu ADMIN", mod_klinik: "on", mod_pos: "on", mod_crm: "on", all_branches: "on", create_accounts: "on", "act_bank.cash_entry.view_history": "on", ...extra })) f.set(k, v);
  for (const k of drop) f.delete(k);
  return f;
}
const saveArgs = () => mocks.rpc.mock.calls.filter(c => c[0] === "save_role_access_config").at(-1)![1];
beforeEach(() => {
  submenus = undefined; mocks.rpc.mockReset(); mocks.redirect.mockClear(); mocks.revalidate.mockReset(); mocks.profile = { role: "OWNER", is_active: true };
  mocks.rpc.mockImplementation(async (name: string) => name === "get_role_access_config" ? { data: snapshot(), error: null }
    : { data: { role: "ADMIN", revision: "b".repeat(32), audit_id: "a1234567-1234-4123-8123-123456789abc", request_key: key, already_applied: false }, error: null });
});
const run = async (f: FormData) => { await expect(saveRoleSettings("ADMIN", revision, f)).rejects.toThrow("REDIRECT:"); };

it("ADMIN restricted to a few sub-menus in several modules sends one sorted p_submenus; fully-checked modules are not restricted", async () => {
  const f = form({ subs_klinik: "1", subs_pos: "1", subs_crm: "1", "sub_klinik.registrasi": "on", "sub_klinik.antrian": "on", "sub_pos.stok": "on" });
  for (const id of ids("crm")) f.set(`sub_${id}`, "on");
  await run(f);
  expect(saveArgs()).toMatchObject({ p_role: "ADMIN", p_modules: ["klinik", "pos", "crm"], p_submenus: { klinik: ["klinik.antrian", "klinik.registrasi"], pos: ["pos.stok"] } });
  expect(Object.keys(saveArgs().p_submenus)).not.toContain("crm");
});
it("everything left at the default sends no p_submenus at all (old database keeps working, 8-argument call unchanged)", async () => {
  const f = form({ subs_klinik: "1" });
  for (const id of ids("klinik")) f.set(`sub_${id}`, "on");
  await run(f);
  expect("p_submenus" in saveArgs()).toBe(false);
});
it("a form without the sub-menu section (old page) changes nothing and sends nothing", async () => {
  await run(form());
  expect("p_submenus" in saveArgs()).toBe(false);
});
it("a checked module with every sub-menu unchecked is saved as an explicit empty list (module not accessible)", async () => {
  await run(form({ subs_klinik: "1" }));
  expect(saveArgs().p_submenus).toEqual({ klinik: [] });
});
it("sub-menus of an unchecked module are ignored and any saved policy for it is dropped", async () => {
  submenus = { hris: ["hris.karyawan"] };
  await run(form({ subs_pos: "1", "sub_pos.stok": "on", subs_hris: "1", "sub_hris.absensi": "on" }));
  expect(saveArgs().p_submenus).toEqual({ pos: ["pos.stok"] });
});
it("clearing every restriction of a role that had one sends an explicit empty object", async () => {
  submenus = { klinik: ["klinik.antrian"] };
  const f = form({ subs_klinik: "1" });
  for (const id of ids("klinik")) f.set(`sub_${id}`, "on");
  await run(f);
  expect(saveArgs().p_submenus).toEqual({});
});
it("a module the page did not render keeps its saved policy", async () => {
  submenus = { klinik: ["klinik.antrian"] };
  await run(form({ subs_pos: "1", "sub_pos.stok": "on" }));
  expect(saveArgs().p_submenus).toEqual({ klinik: ["klinik.antrian"], pos: ["pos.stok"] });
});
it("refuses unknown, duplicate, malformed or cross-module sub-menu fields before any write", async () => {
  for (const bad of [{ "sub_klinik.tidak-ada": "on" }, { "sub_klinik.antrian": "true" }, { "sub_": "on" }, { "sub_pos.stok": "off" }]) {
    mocks.rpc.mockClear();
    await expect(saveRoleSettings("ADMIN", revision, form({ subs_klinik: "1", ...bad }))).resolves.toMatchObject({ ok: false, message: expect.stringContaining("sub-menu") });
    expect(mocks.rpc.mock.calls.filter(c => c[0] === "save_role_access_config")).toHaveLength(0);
  }
  const dup = form({ subs_klinik: "1", "sub_klinik.antrian": "on" }); dup.append("sub_klinik.antrian", "on");
  await expect(saveRoleSettings("ADMIN", revision, dup)).resolves.toMatchObject({ ok: false });
  const marker = form({ subs_nomodule: "1" });
  await expect(saveRoleSettings("ADMIN", revision, marker)).resolves.toMatchObject({ ok: false });
});
it("reset never carries sub-menus", async () => {
  const f = form({ mode: "reset", confirm_reset: "on", subs_klinik: "1", "sub_klinik.antrian": "on" });
  await run(f);
  expect(saveArgs()).toMatchObject({ p_mode: "reset", p_modules: [] });
  expect("p_submenus" in saveArgs()).toBe(false);
});
it("only the active Owner can save sub-menus", async () => {
  for (const role of ["ADMIN", "FINANCE", "STAFF", "DOCTOR"]) { mocks.profile = { role, is_active: true }; await expect(saveRoleSettings("ADMIN", revision, form({ subs_klinik: "1" }))).resolves.toMatchObject({ ok: false }); }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("maps the database refusal to plain Indonesian", () => {
  expect(roleRpcFailure({ message: "ROLE_SUBMENU_INVALID" })).toMatchObject({ ok: false, outcome: "rejected" });
});
it("snapshot parser: submenus optional (old database), well-formed when present, malformed fails closed", () => {
  const base = snapshot();
  expect(parseRoleAccessConfig(base, "ADMIN")).not.toBeNull();
  expect(parseRoleAccessConfig({ ...base, submenus: { klinik: ["klinik.antrian"] } }, "ADMIN")?.submenus).toEqual({ klinik: ["klinik.antrian"] });
  for (const bad of [[], "x", { klinik: "a" }, { klinik: [1] }, { "": [] }, { unknown: [] }]) expect(parseRoleAccessConfig({ ...base, submenus: bad }, "ADMIN"), JSON.stringify(bad)).toBeNull();
});
