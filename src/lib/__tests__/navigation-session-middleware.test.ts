import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  claims: vi.fn(),
  remoteUser: vi.fn(),
  profile: { role: "OWNER" } as { role: string; is_active?: boolean } | null,
  profileError: null as { message: string } | null,
  rules: [] as { role: string; module_id: string }[],
  reads: [] as string[],
  refresh: false,
  grants: ["eb200000-0000-4000-8000-000000000001"],
  branch: { id: "eb200000-0000-4000-8000-000000000001", is_active: true, type: "BOTH" },
  shift: null as {branch_id:string; branches:{name:string}} | null,
  policy: [] as { role: string; module_id: string; allowed: string[] }[],
  policyError: null as { code?: string; message: string } | null,
  rpcCalls: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: (cookies: { name: string; value: string }[]) => void };
  }) => ({
    auth: {
      getClaims: async () => {
        if (state.refresh) options.cookies.setAll([{ name: "test-session", value: "renewed" }]);
        return state.claims();
      },
      getUser: state.remoteUser,
    },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      return state.policyError ? { data: null, error: state.policyError } : { data: state.policy, error: null };
    },
    from: (table: string) => {
      state.reads.push(table);
      if (table === "role_capabilities") {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) };
        return chain;
      }
      if (["branches", "cashier_shifts", "user_branches"].includes(table)) {
        const result = table === "branches" ? {data:state.branch} : table === "cashier_shifts" ? {data:state.shift} : {data:state.grants.map(branch_id=>({branch_id}))};
        const chain = {select:()=>chain,eq:()=>chain,maybeSingle:async()=>result,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};
        return chain;
      }
      return {
        select: () => table === "profiles"
          ? { eq: () => ({ maybeSingle: async () => ({ data: state.profile, error: state.profileError }) }) }
          : Promise.resolve({ data: state.rules }),
      };
    },
  }),
}));

import { updateSession } from "../supabase/middleware";

beforeEach(() => {
  state.claims.mockReset().mockResolvedValue({ data: { claims: { sub: "verified-user" } }, error: null });
  // A cached, verified ES256 token need not fetch this endpoint to navigate.
  state.remoteUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: "Auth user endpoint unavailable" } });
  state.profile = { role: "OWNER" };
  state.profileError = null;
  state.rules = [];
  state.reads = [];
  state.policy = [];
  state.policyError = null;
  state.rpcCalls = [];
  state.refresh = false;
  state.shift = null;
  state.branch.is_active = true;
  state.branch.type = "BOTH";
  state.grants = [state.branch.id];
});

describe("navigation session verification", () => {
  it("allows a verified identity with live permissions without the remote user endpoint", async () => {
    const response = await updateSession(new NextRequest("https://vetos.test/crm"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(state.reads).toEqual(["profiles", "role_modules"]);
  });

  it.each(["expired token", "invalid signature"])("redirects rejected claims: %s", async (reason) => {
    state.claims.mockResolvedValue({ data: null, error: { message: reason } });
    const response = await updateSession(new NextRequest("https://vetos.test/crm"));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(state.reads).toEqual([]);
  });

  it("does not trust claims accompanied by a verification error", async () => {
    state.claims.mockResolvedValue({ data: { claims: { sub: "untrusted" } }, error: { message: "verification failed" } });
    const response = await updateSession(new NextRequest("https://vetos.test/crm"));
    expect(response.status).toBe(303);
    expect(state.reads).toEqual([]);
  });

  it("redirects an expired form submission with 303 and a session message", async () => {
    state.claims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(new NextRequest("https://vetos.test/crm", { method: "POST" }));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toContain("Sesi kamu berakhir");
  });

  it("retains public booking for an anonymous visitor", async () => {
    state.claims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(new NextRequest("https://vetos.test/booking"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects an unexpired verified token whose deleted account no longer has a profile", async () => {
    state.profile = null;
    const response = await updateSession(new NextRequest("https://vetos.test/laporan/member"));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("fails closed if the required profile read fails", async () => {
    state.profileError = { message: "profile read failed" };
    const response = await updateSession(new NextRequest("https://vetos.test/laporan/member"));
    expect(response.status).toBe(303);
  });

  it("does not replay a deleted-account form submission", async () => {
    state.profile = null;
    const response = await updateSession(new NextRequest("https://vetos.test/crm", { method: "POST" }));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toContain("Sesi kamu berakhir");
  });

  it.each(["/booking", "/login", "/auth/callback"])("keeps %s reachable with a deleted-account token", async (path) => {
    state.profile = null;
    const response = await updateSession(new NextRequest("https://vetos.test" + path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("reads changed module permissions on the next request using the same verified identity", async () => {
    state.profile = { role: "ADMIN" };
    state.rules = [{ role: "ADMIN", module_id: "crm" }];
    const allowed = await updateSession(new NextRequest("https://vetos.test/crm"));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    state.rules = [{ role: "ADMIN", module_id: "klinik" }];
    const denied = await updateSession(new NextRequest("https://vetos.test/crm"));
    expect(new URL(denied.headers.get("location")!).pathname).toBe("/mulai");
    expect(state.reads).toEqual(["profiles", "role_modules", "profiles", "role_modules"]);
  });

  it("retains renewed session cookies on both request and outgoing response", async () => {
    state.refresh = true;
    const request = new NextRequest("https://vetos.test/crm");
    const response = await updateSession(request);
    expect(request.cookies.get("test-session")?.value).toBe("renewed");
    expect(response.cookies.get("test-session")?.value).toBe("renewed");
  });
});

describe("operational branch navigation", () => {
  function request(path="/klinik/antrian", user="verified-user", branch=state.branch.id) {
    const request = new NextRequest("https://vetos.test"+path);
    request.cookies.set("kamo-branch-klinik", JSON.stringify({userId:user,branchId:branch}));
    return request;
  }
  it.each(["/klinik", "/klinik/antrian/visit", "/kasir/mulai"])("gates direct %s navigation before operational reads", async path => {
    const response=await updateSession(new NextRequest("https://vetos.test"+path));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/mulai/cabang");
  });
  it("accepts a verified allowed branch and replaces forged headers",async()=>{
    const req=request();req.headers.set("x-kamo-operational-branch","forged");
    const response=await updateSession(req);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-kamo-operational-branch")).toBe(state.branch.id);
  });
  it("strips operational headers from backoffice and APIs",async()=>{
    for(const path of ["/crm","/api/test","/mulai/cabang?mode=klinik"]){
      const req=request(path);req.headers.set("x-kamo-operational-branch","forged");req.headers.set("x-kamo-operational-mode","klinik");
      const response=await updateSession(req);
      expect(response.headers.get("x-middleware-request-x-kamo-operational-branch")).toBeNull();
    }
  });
  it("revalidates assignments, branch state and account on repeated navigation",async()=>{
    state.profile={role:"STAFF",is_active:true};
    expect((await updateSession(request())).headers.get("x-middleware-next")).toBe("1");
    state.grants=[];expect((await updateSession(request())).status).toBe(303);
    state.grants=[state.branch.id];state.branch.is_active=false;expect((await updateSession(request())).status).toBe(303);
    state.branch.is_active=true;state.profile.is_active=false;
    expect(new URL((await updateSession(request())).headers.get("location")!).pathname).toBe("/login");
  });
  it("rejects cross-account cookies, wrong branch types and a changed branch with an open shift",async()=>{
    expect((await updateSession(request("/klinik","another-user"))).status).toBe(303);
    state.branch.type="PETSHOP";expect((await updateSession(request())).status).toBe(303);
    state.branch.type="BOTH";state.shift={branch_id:"other",branches:{name:"Other"}};
    expect((await updateSession(request())).status).toBe(303);
  });
  it("redirects stale form submissions with 303 and retains refreshed session cookies",async()=>{
    state.refresh=true;
    const response=await updateSession(new NextRequest("https://vetos.test/klinik/registrasi",{method:"POST"}));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toContain("Pilih cabang");
    expect(response.cookies.get("test-session")?.value).toBe("renewed");
  });
});

describe("sub-menu policy: ROLE ADMIN restricted to a few pages (server-side, URL typing)", () => {
  const ALL = ["crm", "pos", "laporan", "kas-bank"];
  const adminRules = () => [{ role: "ADMIN", module_id: "__role_v2__" }, ...ALL.map(module_id => ({ role: "ADMIN", module_id }))];
  const go = async (path: string, method = "GET") => updateSession(new NextRequest("https://vetos.test" + path, { method }));
  const blocked = (r: Response) => r.status === 307 && new URL(r.headers.get("location")!).pathname === "/mulai";
  beforeEach(() => {
    state.profile = { role: "ADMIN", is_active: true };
    state.rules = adminRules();
    state.policy = [{ role: "ADMIN", module_id: "crm", allowed: ["crm.pelanggan"] }, { role: "ADMIN", module_id: "pos", allowed: ["pos.stok"] }];
  });
  // ADMIN holds only these five modules here, so a blocked URL goes to /mulai (no dashboard module).
  it("reads the policy once per navigation, alongside profile and rules", async () => {
    await go("/crm/pelanggan");
    expect(state.rpcCalls).toEqual(["get_my_submenu_policy"]);
  });
  it("opens the chosen sub-menu and nested detail pages", async () => {
    for (const p of ["/crm", "/crm/pelanggan", "/crm/pelanggan/baru", "/pos/stok", "/pos/stok/x", "/laporan/gaji", "/kas-bank/rekening"]) {
      expect((await go(p)).headers.get("x-middleware-next"), p).toBe("1");
    }
  });
  it("refuses other pages of a restricted module by typed URL, GET and form POST alike", async () => {
    for (const p of ["/crm/promo", "/crm/promo/abc/edit", "/crm/baru-tanpa-menu", "/pos/sku", "/pos/opname/baru"]) {
      expect(blocked(await go(p)), p).toBe(true);
      expect(blocked(await go(p, "POST")), "POST " + p).toBe(true);
    }
  });
  it("OWNER is never restricted, whatever the policy table says", async () => {
    state.profile = { role: "OWNER", is_active: true };
    state.policy = [{ role: "OWNER", module_id: "crm", allowed: [] }];
    expect((await go("/crm/promo")).headers.get("x-middleware-next")).toBe("1");
  });
  it("another role is not restricted by ADMIN's policy", async () => {
    state.profile = { role: "STAFF", is_active: true };
    state.rules = [{ role: "STAFF", module_id: "crm" }];
    expect((await go("/crm/promo")).headers.get("x-middleware-next")).toBe("1");
  });
  it("function not yet in the database behaves exactly as today (all pages of an allowed module)", async () => {
    state.policyError = { code: "PGRST202", message: "Could not find the function public.get_my_submenu_policy in the schema cache" };
    expect((await go("/crm/promo")).headers.get("x-middleware-next")).toBe("1");
  });
  it("an unconfirmed policy read fails closed to login, never to 'everything allowed'", async () => {
    state.policyError = { code: "57014", message: "statement timeout" };
    const r = await go("/crm/promo");
    expect(r.status).toBe(303);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });
  it("OWNER is never locked out by a failing policy read, whatever the error", async () => {
    state.profile = { role: "OWNER", is_active: true };
    for (const err of [{ code: "57014", message: "statement timeout" }, { code: "42501", message: "permission denied for function get_my_submenu_policy" },
      { message: "fetch failed" }, { code: "42883", message: "function public.foo(text) does not exist" }]) {
      state.policyError = err;
      for (const p of ["/crm/promo", "/pengaturan/akses-grup", "/"]) {
        const r = await go(p);
        expect(r.headers.get("x-middleware-next"), `${err.code} ${p}`).toBe("1");
      }
      expect((await go("/pengaturan/akses-grup", "POST")).headers.get("x-middleware-next")).toBe("1");
    }
  });
  it("OWNER is not locked out by a malformed policy payload either", async () => {
    state.profile = { role: "OWNER", is_active: true };
    state.policy = { not: "an array" } as never;
    expect((await go("/crm/promo")).headers.get("x-middleware-next")).toBe("1");
  });
  it("OWNER still needs an active profile: a failing policy read does not bypass the profile/rules checks", async () => {
    state.profile = null;
    state.policyError = { code: "57014", message: "statement timeout" };
    const r = await go("/crm/promo");
    expect(r.status).toBe(303);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });
  it("a non-OWNER role whose policy read fails is sent to login with a clear message (GET and POST), never let through", async () => {
    state.policyError = { code: "57014", message: "statement timeout" };
    for (const method of ["GET", "POST"]) {
      const r = await go("/crm/promo", method);
      expect(r.status).toBe(303);
      const url = new URL(r.headers.get("location")!);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("error"), method).toContain("Hak akses");
    }
  });
  it("a DB 'function does not exist' raised from INSIDE another function is an error for restricted roles (fail-closed)", async () => {
    state.policyError = { code: "42883", message: "function public.foo(text) does not exist" };
    const r = await go("/crm/promo");
    expect(r.status).toBe(303);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });
  it("a module whose every sub-menu is unchecked is refused including its home", async () => {
    state.policy = [{ role: "ADMIN", module_id: "crm", allowed: [] }];
    expect(blocked(await go("/crm"))).toBe(true);
    expect(blocked(await go("/crm/pelanggan"))).toBe(true);
  });
});
