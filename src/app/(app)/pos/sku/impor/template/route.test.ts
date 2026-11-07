import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "OWNER" as string, user: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: "fiction-user" } : null } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: fixture.role, is_active: true } }) }) }) }),
}) }));

import { GET } from "./route";

describe("GET /pos/sku/impor/template?jenis=rincian-grup", () => {
  beforeEach(() => { fixture.role = "OWNER"; fixture.user = true; });

  it("mengirim xlsx contoh Rincian Grup untuk OWNER/ADMIN", async () => {
    const res = await GET(new Request("http://x/pos/sku/impor/template?jenis=rincian-grup"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("Contoh-Rincian-Grup-VetOS.xlsx");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("menolak peran lain", async () => {
    fixture.role = "KASIR";
    expect((await GET(new Request("http://x/pos/sku/impor/template?jenis=rincian-grup"))).status).toBe(403);
  });
});
