import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ role: "STAFF", user: "staff-a" as string | null, shift: null as null | { id: string; branch_id: string; opened_by: string; status: string; shift_type: string; opening_balance: number; opened_at: string; branches: { name: string; code: string } } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: fixture.user } : null } }) },
  from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const data = () => table === "profiles" ? { full_name: "Fictional Staff", role: fixture.role } : fixture.shift && filters.every(([key,value]) => fixture.shift?.[key as keyof typeof fixture.shift] === value) ? fixture.shift : null;
    const q = { select: () => q, eq: (key: string,value: unknown) => { filters.push([key,value]); return q; }, single: async () => ({ data: data(), error: null }), maybeSingle: async () => ({ data: data(), error: null }) };
    return q;
  },
}) }));
import Page from "@/app/(app)/klinik/page";
beforeEach(() => { fixture.role = "STAFF"; fixture.user = "staff-a"; fixture.shift = null; });
const open = () => ({ id: "shift-a", branch_id: "branch-a", opened_by: "staff-a", status: "open", shift_type: "klinik", opening_balance: 150000, opened_at: "2026-10-14T02:00:00Z", branches: { name: "Clinic A", code: "A" } });
it("sends a staff account without an open clinic shift to the opening-cash form", async () => {
  await expect(Page()).rejects.toThrow("REDIRECT:/klinik/shift");
});
it("returns staff to the opening-cash form after their shift was closed", async () => {
  fixture.shift = { ...open(), status: "closed" }; await expect(Page()).rejects.toThrow("REDIRECT:/klinik/shift");
});
it("lets staff with an open clinic shift continue and close that shift", async () => {
  fixture.shift = open(); const html = renderToStaticMarkup(await Page());
  expect(html).toContain("PENDAFTARAN"); expect(html).toContain('href="/klinik/shift"'); expect(html).toContain("SELESAI SHIFT");
});
it("does not mistake an open Petshop shift for an open clinic shift", async () => {
  fixture.shift = { ...open(), shift_type: "petshop" }; await expect(Page()).rejects.toThrow("REDIRECT:/klinik/shift");
});
it.each(["ADMIN", "OWNER", "DOCTOR"])("lets %s view the clinic without requiring a cash shift and exposes the start action", async role => {
  fixture.role = role; const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Antrian digital"); expect(html).toContain("Rawat inap");
  expect(html).toContain('href="/klinik/shift"'); expect(html).toContain("Mulai shift klinik");
});
it("exposes closing the signed-in administrator's clinic shift on the admin home", async () => {
  fixture.role = "ADMIN"; fixture.shift = open(); const html = renderToStaticMarkup(await Page());
  expect(html).toContain('href="/klinik/shift"'); expect(html).toContain("Tutup shift klinik"); expect(html).not.toContain("Mulai shift klinik");
});
it("requires authentication before showing the clinic or cash controls", async () => {
  fixture.user = null; await expect(Page()).rejects.toThrow("REDIRECT:/login");
});
