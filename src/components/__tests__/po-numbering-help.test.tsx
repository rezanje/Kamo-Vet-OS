import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-23" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from(table: string) {
 const q = { select: () => q, eq: () => q, maybeSingle: () => q, then(resolve: (v: unknown) => void) { resolve({ data: table === "profiles" ? { role: "OWNER" } : [], error: null }); } }; return q;
} }) }));
import Page from "@/app/(app)/pengaturan/penomoran/page";
it("explains the PO-only authoritative branch suffix and shows an explicitly illustrative example", async () => {
 const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
 expect(html).toContain("Kode cabang PO");
 expect(html).toContain("PO-20261023-CONTOH-0001");
 expect(html).toContain("CONTOH hanya ilustrasi");
 expect(html).toContain("FB.2026.10.00001");
});
