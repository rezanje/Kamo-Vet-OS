// @vitest-environment jsdom
// H1 (legacy action checkboxes) and H2 (structured, Indonesian, distinct rejection vs unknown) through the REAL form and REAL action.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), redirects: [] as string[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), redirect: (url: string) => { state.redirects.push(url); throw new Error("redirect captured"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "OWNER", is_active: true }, error: null }) }) }) }), rpc: state.rpc }) }));
import { NewRoleSettingsForm } from "./newRoleSettingsForm";
import { saveRoleSettings } from "./actions";
import { customSnapshot, enforcedIds, legacySnapshot, realActionCatalog, REVISION } from "@/lib/__tests__/fixtures/role-snapshot";
import type { RoleAccessConfig } from "@/lib/role-access-catalog";

const KEY_RESULT = { role: "ADMIN", revision: "b".repeat(32), audit_id: "a1234567-1234-4123-8123-123456789abc", already_applied: false };
let root: Root, host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); state.redirects = []; state.rpc.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = (config: RoleAccessConfig, canEdit = true) => act(async () => root.render(<NewRoleSettingsForm userId="owner" config={config} canEdit={canEdit} />));
const checked = () => [...host.querySelectorAll<HTMLInputElement>('input[name^="act_"]')].filter(i => i.checked).map(i => i.name.slice(4)).sort();
const reason = async (text = "Ubah menu saja") => act(async () => { const r = host.querySelector<HTMLTextAreaElement>('[name="reason"]')!; r.value = text; r.dispatchEvent(new Event("input", { bubbles: true })); });
const submit = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 0)); });
// A confirmed save echoes the request key it was given (the database does); failures are returned as-is.
const respond = (save: { data: unknown; error: unknown }, config: RoleAccessConfig) => state.rpc.mockImplementation(async (name: string, args: { p_request_key?: string }) =>
  name === "get_role_access_config" ? { data: config, error: null }
    : save.error || !save.data ? save : { data: { ...(save.data as object), request_key: args.p_request_key }, error: null });
const saveCall = () => state.rpc.mock.calls.filter(c => c[0] === "save_role_access_config").at(-1)?.[1];

it("fixture is the real frozen catalogue: 116 planned rows, exactly the 14 enforced actions, a no-policy role reads source legacy / allowed []", () => {
  const catalog = realActionCatalog();
  expect(catalog).toHaveLength(116);
  expect(enforcedIds().sort()).toEqual(["bank.bank_reconciliation.create", "bank.bank_reconciliation.edit", "bank.bank_reconciliation.recover", "bank.bank_reconciliation.void",
    "bank.cash_transfer.create", "bank.cash_transfer.edit", "bank.cash_transfer.recover", "bank.cash_transfer.void",
    "people.account_branch_direct_assign", "people.buatPengguna", "people.editKaryawan", "people.simpanEditPengguna", "people.tautkanPengguna", "people.togglePengguna"]);
  expect(legacySnapshot().actions).toEqual({ source: "legacy", allowed: [] });
});
it("H1: a legacy/no-policy role shows EVERY enforced action checked (what the database allows today) and no unenforced switch", async () => {
  await mount(legacySnapshot("ADMIN"));
  expect(checked()).toEqual(enforcedIds().sort());
  expect(host.querySelectorAll('input[name^="act_"]')).toHaveLength(14);
  expect(host.textContent).toContain("diizinkan");
});
it("H1: an explicit custom policy shows exactly its allowed actions, including none", async () => {
  const some = ["bank.cash_transfer.create", "people.editKaryawan"];
  await mount(customSnapshot("ADMIN", some));
  expect(checked()).toEqual(some);
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(customSnapshot("ADMIN", []));
  expect(checked()).toEqual([]);
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(customSnapshot("ADMIN", enforcedIds()));
  expect(checked()).toEqual(enforcedIds().sort());
});
it("H1: menu-only save of a REAL legacy role leaves the action policy untouched (p_actions null, not an empty deny-all list)", async () => {
  const config = legacySnapshot("ADMIN"); respond({ data: KEY_RESULT, error: null }, config);
  await mount(config);
  await act(async () => { host.querySelector<HTMLInputElement>('[name="mod_pos"]')!.click(); });
  await reason(); await submit();
  expect(saveCall()).toMatchObject({ p_role: "ADMIN", p_mode: "custom", p_actions: null, p_modules: expect.arrayContaining(["dashboard", "klinik", "pos"]) });
  expect(state.redirects).toHaveLength(1);
});
it("H1: changing an action on a legacy role sends the explicit list (13 left after unchecking one; none after unchecking all)", async () => {
  const config = legacySnapshot("ADMIN"); respond({ data: KEY_RESULT, error: null }, config);
  await mount(config);
  await act(async () => { host.querySelector<HTMLInputElement>('[name="act_bank.cash_transfer.void"]')!.click(); });
  await reason(); await submit();
  expect([...saveCall().p_actions].sort()).toEqual(enforcedIds().filter(id => id !== "bank.cash_transfer.void").sort());
  await act(async () => root.unmount()); root = createRoot(host); sessionStorage.clear(); state.redirects = [];
  await mount(config);
  await act(async () => { for (const i of host.querySelectorAll<HTMLInputElement>('input[name^="act_"]')) i.click(); });
  await reason(); await submit();
  expect(saveCall().p_actions).toEqual([]);
});
it("H1: menu-only save of an explicit custom policy resends exactly that policy; custom 'none' stays none", async () => {
  const some = ["bank.cash_transfer.create", "people.editKaryawan"];
  for (const allowed of [some, []]) {
    await act(async () => root.unmount()); root = createRoot(host); sessionStorage.clear(); state.redirects = [];
    const config = customSnapshot("ADMIN", allowed); respond({ data: KEY_RESULT, error: null }, config);
    await mount(config);
    await act(async () => { host.querySelector<HTMLInputElement>('[name="mod_klinik"]')!.click(); });
    await reason(); await submit();
    expect([...saveCall().p_actions].sort()).toEqual([...allowed].sort());
  }
});
it("H1: reset sends no action list and a legacy role stays displayed as everything allowed afterwards", async () => {
  const config = customSnapshot("ADMIN", ["people.editKaryawan"]); respond({ data: KEY_RESULT, error: null }, config);
  await mount(config);
  await act(async () => { const s = host.querySelector<HTMLSelectElement>('[name="mode"]')!; s.value = "reset"; s.dispatchEvent(new Event("change", { bubbles: true })); host.querySelector<HTMLInputElement>('[name="confirm_reset"]')!.click(); });
  await reason("Reset semua"); await submit();
  expect(saveCall()).toMatchObject({ p_mode: "reset", p_modules: [], p_capabilities: null, p_actions: null });
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(legacySnapshot("ADMIN", { revision: "b".repeat(32) }));
  expect(checked()).toEqual(enforcedIds().sort());
});
it("H1: a stale legacy form against a role that has since become custom is refused by the database revision, never silently overwritten", async () => {
  const stale = legacySnapshot("ADMIN"); const fresh = customSnapshot("ADMIN", [], { revision: "c".repeat(32) });
  respond({ data: null, error: { code: "P0001", message: "ROLE_REVISION_CONFLICT" } }, fresh);
  await mount(stale); await reason(); await submit();
  expect(saveCall()).toMatchObject({ p_expected_revision: REVISION });
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("Muat ulang");
});

const FAIL_CASES: [string, { code?: string; message: string }, "rejected" | "retry", RegExp][] = [
  ["revision conflict", { code: "P0001", message: "ROLE_REVISION_CONFLICT" }, "rejected", /Muat ulang/],
  ["owner required", { code: "P0001", message: "ROLE_OWNER_REQUIRED" }, "rejected", /pemilik/i],
  ["lock busy", { code: "55P03", message: 'could not obtain lock on relation "profiles"' }, "retry", /coba lagi/i],
  ["account busy", { code: "40001", message: "PEOPLE_ACCOUNT_BUSY: akun sedang dipakai proses lain, ulangi" }, "retry", /coba lagi/i],
  ["action denied", { code: "42501", message: "ROLE_ACTION_DENIED: tindakan tidak diizinkan" }, "rejected", /tidak diizinkan/],
];
it.each(FAIL_CASES)("H2: %s reaches the form as a clear Indonesian result — not the unknown-result wording — and keeps draft and key", async (_n, error, outcome, text) => {
  const config = legacySnapshot("ADMIN"); respond({ data: null, error }, config);
  await mount(config);
  const key = host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value;
  await reason("Draf tetap"); await submit();
  const alert = host.querySelector<HTMLElement>('form [role="alert"]')!;
  expect(alert.textContent).toMatch(text);
  expect(alert.textContent).not.toMatch(/belum terkonfirmasi|Periksa daftar transaksi|ROLE_|PEOPLE_|could not obtain/);
  expect(alert.getAttribute("data-outcome")).toBe(outcome);
  expect(state.redirects).toHaveLength(0);
  expect(host.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value).toBe("Draf tetap");
  expect(host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value).toBe(key);
});
it("H2: truly unknown/network outcomes stay UNCONFIRMED (distinct wording, no deterministic outcome attribute) and keep draft and key", async () => {
  const config = legacySnapshot("ADMIN");
  await mount(config);
  const key = host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value;
  await reason("Draf tetap");
  for (const save of [{ data: null, error: { message: "fetch failed" } }, { data: { bad: 1 }, error: null }]) {
    respond(save, config); await submit();
    const alert = host.querySelector<HTMLElement>('form [role="alert"]')!;
    expect(alert.textContent).toContain("belum terkonfirmasi"); expect(alert.textContent).not.toContain("Periksa daftar transaksi");
    expect(alert.hasAttribute("data-outcome")).toBe(false);
  }
  state.rpc.mockImplementation(async (name: string) => { if (name === "get_role_access_config") return { data: config, error: null }; throw new Error("socket closed"); });
  await submit(); expect(host.querySelector('form [role="alert"]')!.textContent).toContain("belum terkonfirmasi");
  expect(host.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value).toBe("Draf tetap");
  expect(host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value).toBe(key);
  expect(state.redirects).toHaveLength(0);
});
it("H2: pre-RPC refusals of the action are structured results too (non-owner, mismatch, missing reason, unconfirmed reset)", async () => {
  const form = (over: Record<string, string> = {}) => { const f = new FormData(); const key = "12345678-1234-4123-8123-123456789abc"; for (const [k, v] of Object.entries({ role: "ADMIN", expected_revision: REVISION, requestKey: key, draft_key: key, draft_scope: `role-access:ADMIN:${REVISION}`, mode: "custom", reason: "Alasan valid", ...over })) f.set(k, v); return f; };
  respond({ data: KEY_RESULT, error: null }, legacySnapshot("ADMIN"));
  expect(await saveRoleSettings("ADMIN", REVISION, form({ reason: "ab" }))).toMatchObject({ ok: false, outcome: "rejected", message: expect.stringContaining("alasan") });
  expect(await saveRoleSettings("ADMIN", REVISION, form({ role: "STAFF" }))).toMatchObject({ ok: false, outcome: "rejected", message: expect.stringContaining("Identitas") });
  expect(await saveRoleSettings("ADMIN", REVISION, form({ mode: "reset" }))).toMatchObject({ ok: false, outcome: "rejected", message: expect.stringContaining("Konfirmasi") });
  expect(state.rpc.mock.calls.filter(c => c[0] === "save_role_access_config")).toHaveLength(0);
  state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: null, error: { message: "read failed" } });
  expect(await saveRoleSettings("ADMIN", REVISION, form())).toMatchObject({ ok: false, outcome: "retry", message: expect.stringContaining("dibaca") });
});
it("the catalogue enforced list never leaks planned-only actions as switches", () => {
  expect(realActionCatalog().filter(a => !a.enforced)).toHaveLength(102);
});
