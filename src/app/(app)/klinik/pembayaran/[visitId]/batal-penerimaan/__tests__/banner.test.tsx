// Banner tanggal pembukuan di halaman tagihan: tampil hanya bila jendela terbuka DAN peran berhak; peran lain tidak melihat apa pun; gagal baca = tidak menampilkan apa pun.
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

it("jendela terbuka (peran berhak): tanggal pembukuan diubah, uang fisik tetap hari ini, tombol 'Pakai tanggal hari ini'", async () => {
  const h = await html();
  expect(h).toContain("Tanggal pembukuan diubah ke 2026-11-09"); expect(h).toContain("INV-9"); expect(h).toContain("uang fisik tetap hari ini");
  expect(h).toContain("Pakai tanggal hari ini"); expect(h).toContain('name="invoice_id"'); expect(h).toContain('value="v1"');
  expect(h).not.toMatch(/Lepas tanggal|mundur|efektif/i);
});
it("tanpa hak atau hak tak terbaca: tidak menampilkan apa pun tentang tanggal", async () => {
  st.boleh = false; expect(await html()).toBe("");
  st.boleh = null; expect(await html()).toBe("");
});
it("tanpa jendela, galat baca, atau galat tak terduga: tidak menampilkan apa pun dan tidak melempar", async () => {
  st.windows = []; expect(await html()).toBe("");
  st.windows = [{ invoice_id: "i1", effective_date: "2026-11-09", opened_at: "x" }]; st.err = { message: "x" }; expect(await html()).toBe("");
  st.err = null; st.throwOn = true; expect(await html()).toBe("");
  st.throwOn = false; expect(await html([])).toBe("");
});
