// Banner tanggal efektif di halaman tagihan: tampil hanya bila jendela terbuka; tombol lepas hanya untuk yang berhak; gagal baca = tidak menampilkan apa pun.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ windows: [] as unknown[], err: null as unknown, boleh: true as boolean | null, throwOn: false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (st.throwOn) throw new Error("boom");
    return {
      from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.in = () => q; q.eq = async () => ({ data: st.windows, error: st.err }); return q; },
      rpc: async () => (st.boleh === null ? { data: null, error: { message: "x" } } : { data: st.boleh, error: null }),
    };
  },
}));
vi.mock("../actions", () => ({ lepasTanggalEfektif: async () => {} }));
import { TanggalEfektifBanner } from "../TanggalEfektifBanner";

const html = async (tagihan = [{ id: "i1", no: "INV-9" }]) => renderToStaticMarkup((await TanggalEfektifBanner({ visitId: "v1", tagihan })) ?? <></>);
beforeEach(() => { st.windows = [{ invoice_id: "i1", effective_date: "2026-11-09", opened_at: "2026-11-12T03:00:00Z" }]; st.err = null; st.boleh = true; st.throwOn = false; });

it("jendela terbuka: tanggal efektif, bagian yang ikut tanggal itu, uang fisik tetap hari ini, dan tombol lepas untuk yang berhak", async () => {
  const h = await html();
  expect(h).toContain("Tanggal efektif 2026-11-09"); expect(h).toContain("INV-9"); expect(h).toContain("tetap masuk laci shift Anda hari ini");
  expect(h).toContain("Lepas tanggal efektif"); expect(h).toContain('name="invoice_id"'); expect(h).toContain('value="v1"');
});
it("tanpa hak: banner tampil tetapi tanpa tombol lepas; hak tak terbaca = tanpa tombol", async () => {
  st.boleh = false; expect(await html()).not.toContain("Lepas tanggal efektif");
  st.boleh = null; const h = await html(); expect(h).toContain("Tanggal efektif 2026-11-09"); expect(h).not.toContain("Lepas tanggal efektif");
});
it("tanpa jendela, galat baca, atau galat tak terduga: tidak menampilkan apa pun dan tidak melempar", async () => {
  st.windows = []; expect(await html()).toBe("");
  st.windows = [{ invoice_id: "i1", effective_date: "2026-11-09", opened_at: "x" }]; st.err = { message: "x" }; expect(await html()).toBe("");
  st.err = null; st.throwOn = true; expect(await html()).toBe("");
  st.throwOn = false; expect(await html([])).toBe("");
});
