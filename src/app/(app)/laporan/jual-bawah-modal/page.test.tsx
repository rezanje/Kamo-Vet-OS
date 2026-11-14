import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ role: "OWNER" as string | null, rpc: [] as unknown[], rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/jual-bawah-modal-server", async (original) => ({
  ...(await original<typeof import("@/lib/jual-bawah-modal-server")>()),
  periksaAksesBawahModal: async () => state.role === "OWNER" || state.role === "ADMIN" || state.role === "FINANCE",
  muatCabangLaporan: async () => [{ id: "b1", name: "Ciawi" }],
  muatBawahModal: async (_c: unknown, dari: string, sampai: string, cabang: string) => { state.rpc.push([dari, sampai, cabang]); return state.rows; },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ siap, children, ringkasan }: { siap: boolean; children?: unknown; ringkasan?: unknown }) => <div>{siap ? <>{ringkasan as never}{children as never}</> : "BELUM"}</div>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <div>{items.map(i => `${i.label}=${i.nilai}`).join("|")}</div>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

beforeEach(() => { state.role = "OWNER"; state.rpc = []; state.rows = []; });
const render = async (sp: Record<string, string>) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

it("peran tanpa akses: halaman ditolak dan data tidak dibaca", async () => {
  state.role = "STAFF";
  expect(await render({ tampil: "1" })).toContain("belum diizinkan");
  expect(state.rpc).toEqual([]);
});
it("belum menekan Tampilkan: tidak membaca laporan", async () => {
  expect(await render({})).toContain("BELUM");
  expect(state.rpc).toEqual([]);
});
it("Owner: baris, rugi, alasan, pelaku tampil; tautan struk dan unduhan", async () => {
  state.rows = [{ sale_id: "s1", tanggal: "2026-11-14", cabang_id: "b1", cabang: "Ciawi", no_struk: "POS-1", item_id: "i", kode: "100222", barang: "Crystal Kitty HnS 400gr",
    qty: 2, satuan: "pcs", faktor: 1, hpp: 52152, harga_neto: 35000, rugi: 17152, alasan: "Mau kadaluarsa", oleh_id: "u", oleh: "Andri" }];
  const html = await render({ tampil: "1", dari: "2026-11-01", sampai: "2026-11-14", cabang: "b1" });
  expect(state.rpc).toEqual([["2026-11-01", "2026-11-14", "b1"]]);
  expect(html).toContain("Rp 17.152");
  expect(html).toContain("Mau kadaluarsa");
  expect(html).toContain("Andri");
  expect(html).toContain("/kasir/struk/s1");
  expect(html).toContain("Total rugi (HPP - harga neto)=Rp 17.152");
  expect(html).toContain("/laporan/jual-bawah-modal/unduh?");
});
