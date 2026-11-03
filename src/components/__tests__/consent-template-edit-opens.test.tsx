// @vitest-environment jsdom
// Tombol "Edit" di daftar template persetujuan harus benar-benar membuka formulir
// berisi template itu — walau halaman TIDAK dimuat ulang penuh (navigasi klien Next
// memakai ulang komponen yang sama, jadi state awal useState tidak boleh dipercaya).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rows = [
  { id: "t1", nama: "Form Rawat Inap Non-Infeksius", isi: "ISI SATU {nama_pemilik}", kategori: "Rawat Inap", branch_id: null, is_active: true, updated_at: "2026-11-01T00:00:00Z", branches: null },
  { id: "t2", nama: "Form Rawat Inap Infeksius", isi: "ISI DUA {nama_hewan}", kategori: "Rawat Inap", branch_id: null, is_active: true, updated_at: "2026-11-02T00:00:00Z", branches: null },
];
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/app/(app)/klinik/persetujuan/actions", () => ({ simpanTemplate: vi.fn(), toggleTemplate: vi.fn(), simpanAturanConsent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
      maybeSingle: async () => ({ data: { role: "OWNER" }, error: null }),
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: table === "consent_templates" ? rows : [], error: null }).then(resolve) };
    return q;
  },
}) }));
import Page from "@/app/(app)/klinik/persetujuan/page";

let root: Root, host: HTMLDivElement;
async function render(sp: { edit?: string } = {}) { const el = await Page({ searchParams: Promise.resolve(sp) }); await act(async () => root.render(el)); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("klik Edit (halaman yang sama, ?edit=id baru) membuka formulir berisi template itu", async () => {
  await render();
  expect(host.querySelector("textarea[name=isi]")).toBeNull();
  await render({ edit: "t2" });
  const isi = host.querySelector("textarea[name=isi]") as HTMLTextAreaElement | null;
  expect(isi?.value).toBe("ISI DUA {nama_hewan}");
  expect((host.querySelector("input[name=nama]") as HTMLInputElement).defaultValue).toBe("Form Rawat Inap Infeksius");
  expect((host.querySelector("input[name=id]") as HTMLInputElement).value).toBe("t2");
});

it("pindah dari Edit template A ke Edit template B mengganti isi formulir", async () => {
  await render({ edit: "t1" });
  expect((host.querySelector("textarea[name=isi]") as HTMLTextAreaElement).value).toBe("ISI SATU {nama_pemilik}");
  await render({ edit: "t2" });
  expect((host.querySelector("textarea[name=isi]") as HTMLTextAreaElement).value).toBe("ISI DUA {nama_hewan}");
  expect((host.querySelector("input[name=nama]") as HTMLInputElement).defaultValue).toBe("Form Rawat Inap Infeksius");
});
