import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ akses: { ok: true, role: "OWNER", bolehUnduh: true } as { ok: boolean; role: string | null; bolehUnduh: boolean }, daftar: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("./actions", () => ({ catatDihubungiAksi: vi.fn() }));
vi.mock("@/lib/marketing-followup-server", () => ({
  MarketingError: class extends Error {},
  periksaAksesMarketing: async () => mock.akses,
  muatDaftarMarketing: (...a: unknown[]) => mock.daftar(...a),
}));
import Page from "./page";

const hasil = { tab: "lama", hari_ini: "2026-11-15", periode: 90, interval: 30, depan: 0, cooldown: 14, status: "belum", total: 0, ditampilkan: 0, belum: 0, sudah: 0,
  bucket: { "60": 0, "90": 0, "180": 0 }, cabang: [], tanpa_nomor: 0, dikecualikan: { kunjungan_belum_selesai: 0, hewan_tiada: 0, disembunyikan: 0 }, riwayat_belanja_mulai: "2026-11-01", baris: [] };
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

beforeEach(() => { mock.akses = { ok: true, role: "OWNER", bolehUnduh: true }; mock.daftar.mockReset(); mock.daftar.mockResolvedValue(hasil); });

describe("halaman Follow up pelanggan", () => {
  it("tanpa akses: pesan, dan database tidak dibaca (nomor HP tidak bocor)", async () => {
    mock.akses = { ok: false, role: null, bolehUnduh: false };
    const html = await render();
    expect(html).toContain("belum diizinkan"); expect(html).toContain("Follow up pelanggan");
    expect(mock.daftar).not.toHaveBeenCalled();
  });
  it("saringan dari URL dinormalkan sebelum dikirim ke database", async () => {
    await render({ tab: "grooming", interval: "45", hari: "7", cabang: "x;drop", status: "sudah" });
    expect(mock.daftar.mock.calls[0][1]).toMatchObject({ tab: "grooming", interval: 45, hari: 90, cabang: "", status: "sudah" });
  });
  it("galat database: pesan, bukan crash", async () => {
    mock.daftar.mockRejectedValue(new Error("rahasia"));
    const html = await render();
    expect(html).toContain("Daftar belum dapat dimuat"); expect(html).not.toContain("rahasia");
  });
  it("hasil kosong tampil dengan keadaan kosong, tombol unduh hanya untuk yang boleh", async () => {
    const html = await render();
    expect(html).toContain("Tidak ada pelanggan di daftar ini."); expect(html).toContain("data-unduh");
    mock.akses = { ok: true, role: "STAFF", bolehUnduh: false };
    expect(await render()).not.toContain("data-unduh");
  });
});
