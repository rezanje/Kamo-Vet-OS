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
