import { describe, expect, it } from "vitest";
import { loadSubmenuPolicy, rulesWithSubmenu, SUBMENU_POLICY_RPC } from "../submenu-policy";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const client = (result: RpcResult | (() => never)) => ({
  rpc: async (name: string): Promise<RpcResult> => { expect(name).toBe(SUBMENU_POLICY_RPC); if (typeof result === "function") return result(); return result; },
});

describe("loadSubmenuPolicy", () => {
  it("returns the caller's policy rows", async () => {
    const rows = [{ role: "ADMIN", module_id: "klinik", allowed: ["klinik.antrian"] }];
    expect(await loadSubmenuPolicy(client({ data: rows, error: null }))).toEqual({ status: "ok", rows });
  });
  it("no rows is ok and empty (no policy = everything allowed)", async () => {
    expect(await loadSubmenuPolicy(client({ data: [], error: null }))).toEqual({ status: "ok", rows: [] });
    expect(await loadSubmenuPolicy(client({ data: null, error: null }))).toEqual({ status: "ok", rows: [] });
  });
  it("app deployed before the database: ONLY a missing get_my_submenu_policy behaves as today (absent, empty)", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function public.get_my_submenu_policy without parameters in the schema cache" },
      { code: "42883", message: "function public.get_my_submenu_policy() does not exist" }]) {
      expect(await loadSubmenuPolicy(client({ data: null, error }))).toEqual({ status: "absent", rows: [] });
    }
  });
  it("a 'function does not exist' for ANY OTHER function (raised inside the body) is an error, never 'absent' (fail-open)", async () => {
    for (const error of [
      { code: "42883", message: "function public.foo(text) does not exist" },
      { code: "42883", message: "function public.get_my_submenu_policy_x() does not exist" },
      { code: "42883", message: "operator does not exist: text = integer" },
      { code: "42883", message: "function does not exist" },
      { code: "42883" },
      { code: "PGRST202", message: "Could not find the function public.foo without parameters in the schema cache" },
      { code: "PGRST202", message: "Could not find the function public.save_role_access_config(p_x) in the schema cache" },
      { code: "PGRST202" },
      { message: "function public.foo(text) does not exist" },
      { message: "Could not find the function public.get_my_submenu_policy in the schema cache" }, // no code: not PostgREST/PG shaped
      { code: "42501", message: "permission denied for function get_my_submenu_policy" },
    ]) {
      expect(await loadSubmenuPolicy(client({ data: null, error })), JSON.stringify(error)).toEqual({ status: "error", rows: [] });
    }
  });
  it("any other failure fails closed: error status, never an empty policy", async () => {
    expect(await loadSubmenuPolicy(client({ data: null, error: { code: "57014", message: "statement timeout" } }))).toEqual({ status: "error", rows: [] });
    expect(await loadSubmenuPolicy(client({ data: null, error: { message: "fetch failed" } }))).toEqual({ status: "error", rows: [] });
    expect(await loadSubmenuPolicy(client(() => { throw new Error("network"); }))).toEqual({ status: "error", rows: [] });
  });
  it("malformed payload fails closed", async () => {
    for (const data of [{}, "x", [{ role: "ADMIN" }], [{ role: "ADMIN", module_id: "klinik", allowed: [1] }]]) {
      expect(await loadSubmenuPolicy(client({ data, error: null }))).toEqual({ status: "error", rows: [] });
    }
  });
  it("a client without rpc is an error, not 'no policy'", async () => {
    expect(await loadSubmenuPolicy({} as never)).toEqual({ status: "error", rows: [] });
  });
});

describe("rulesWithSubmenu (display-only consumers: NEVER an authorization gate)", () => {
  const rules = [{ role: "ADMIN", module_id: "klinik" }, { role: "ADMIN", module_id: "crm" }];
  it("attaches the caller's policy", async () => {
    const merged = await rulesWithSubmenu(client({ data: [{ role: "ADMIN", module_id: "klinik", allowed: ["klinik.antrian"] }], error: null }), rules);
    expect(merged[0]).toEqual({ role: "ADMIN", module_id: "klinik", submenus: ["klinik.antrian"] });
    expect(merged[1]).toEqual(rules[1]);
  });
  it("returns the rules untouched when the policy is absent or unreadable (never throws)", async () => {
    expect(await rulesWithSubmenu(client({ data: null, error: { code: "PGRST202", message: "x" } }), rules)).toBe(rules);
    expect(await rulesWithSubmenu(client(() => { throw new Error("boom"); }), rules)).toBe(rules);
    expect(await rulesWithSubmenu({} as never, rules)).toBe(rules);
  });
});

describe("sub-menu enforcement is not in middleware for /api", () => {
  it("documents that rulesWithSubmenu is display-only (comment must not claim middleware enforces /api)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${__dirname}/../submenu-policy.ts`, "utf8");
    expect(src).not.toMatch(/penegakan ada di middleware/i);
    expect(src).toMatch(/\/api/);
  });
});
