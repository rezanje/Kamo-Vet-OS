// @vitest-environment jsdom
// Ringkasan Buku Besar: pilihan "Tampilan akun" (semua / hanya yang ada angkanya) lewat ?tampilan=.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientFixture } from "@/lib/__tests__/fixtures/hpp-report-client";

const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null, balances: [] as unknown[], openings: new Map<string, number>() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href, title }: React.PropsWithChildren<{ href: string; title?: string }>) => <a href={href} title={title}>{children}</a> }));
vi.mock("@/components/UnduhLaporan", () => ({ UnduhLaporan: () => null }));
vi.mock("@/components/NoDok", () => ({ NoDok: () => null }));
vi.mock("@/lib/ledger", async (orig) => ({
  ...(await orig<typeof import("@/lib/ledger")>()),
  getAccountBalances: async () => fixture.balances,
  // Seperti aslinya: saldo awal hanya ada bila filter punya tanggal "dari".
  getOpeningBalances: async (_s: unknown, f?: { from?: string }) => (f?.from ? fixture.openings : new Map<string, number>()),
  getAccountLedger: async () => [],
  getAccountOpening: async () => 0,
}));

import BukuBesarPage from "@/app/(app)/keuangan/buku-besar/page";

type Halaman = (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
const Page = BukuBesarPage as unknown as Halaman;
const akun = (id: string, code: string, debit: number, credit: number, saldo: number) =>
  ({ id, code, name: `Akun ${code}`, type: "ASET", normal: "D", debit, credit, saldo, parent_id: null, is_header: false });

beforeEach(() => {
  fixture.client = clientFixture({ tables: { branches: [{ id: "b1", name: "Cabang Satu", type: "KLINIK" }] } }).client;
  fixture.balances = [
    akun("1", "110001", 100, 0, 100),
    akun("2", "110002", 0, 0, 0),
    akun("3", "110003", -0, 0, -0), // tampil "Rp -0" di layar lama
    akun("4", "110004", 0, 40, -40),
    akun("5", "110005", 0, 0, 0), // hanya saldo awal bila ada dari-tanggal
  ];
  fixture.openings = new Map([["5", 900]]);
});

const render = async (sp: Record<string, string>) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
const kodeBaris = (html: string) => [...html.matchAll(/<td style="font-family:monospace[^>]*>(\d+)<\/td>/g)].map((m) => m[1]);

it("bawaan: hanya akun yang ada angkanya, dengan catatan jumlah", async () => {
  const html = await render({ tampil: "1" });
  expect(kodeBaris(html)).toEqual(["110001", "110004"]);
  expect(html).toContain("Menampilkan 2 dari 5 akun");
  expect(html).toContain('<option value="berangka" selected="">Hanya akun yang ada angkanya</option>');
  expect(html).toContain('name="tampilan"');
});

it("?tampilan=semua: semua akun, pilihan tersimpan, tautan mata membawa tampilan=semua", async () => {
  const html = await render({ tampil: "1", tampilan: "semua" });
  expect(kodeBaris(html)).toHaveLength(5);
  expect(html).toContain("Menampilkan semua 5 akun");
  expect(html).toContain('<option value="semua" selected="">Semua akun</option>');
  expect(html).toContain('href="/keuangan/buku-besar?akun=110001&amp;tampilan=semua&amp;tampil=1"');
  expect(html).toContain("Reset"); // pilihan bukan bawaan -> Reset muncul
});

it("tautan mata pada tampilan bawaan tidak menambah param tampilan; nilai ngawur = bawaan", async () => {
  const html = await render({ tampil: "1", tampilan: "ngawur" });
  expect(html).toContain('href="/keuangan/buku-besar?akun=110001&amp;tampil=1"');
  expect(kodeBaris(html)).toEqual(["110001", "110004"]);
  expect(html).not.toContain("Reset");
});

it("dengan Dari tanggal, saldo awal saja sudah cukup menampilkan akun", async () => {
  const html = await render({ tampil: "1", dari: "2026-11-01" });
  expect(kodeBaris(html)).toEqual(["110001", "110004", "110005"]);
  expect(html).toContain("Menampilkan 3 dari 5 akun");
});

it("total & status Seimbang dihitung dari SEMUA akun, bukan hanya baris yang tampil", async () => {
  fixture.balances = [...(fixture.balances as ReturnType<typeof akun>[]), akun("6", "110006", 0, 0, 0)];
  (fixture.balances as ReturnType<typeof akun>[])[1] = akun("2", "110002", 40, 0, 40); // dibuat tampil
  const ringkas = await render({ tampil: "1" });
  const semua = await render({ tampil: "1", tampilan: "semua" });
  const tfoot = (h: string) => h.slice(h.indexOf("<tfoot"), h.indexOf("</tfoot>"));
  expect(tfoot(ringkas)).toBe(tfoot(semua));
  expect(tfoot(ringkas)).toContain("Rp 140");
  expect(tfoot(ringkas)).toContain("Rp 40");
  expect(tfoot(ringkas)).toContain("Timpang!");
});

it("akun yang sedang dibuka tetap tampil walau nol", async () => {
  const html = await render({ tampil: "1", akun: "110002" });
  expect(kodeBaris(html)).toEqual(["110001", "110002", "110004"]);
});

it("sebelum Tampilkan: filter + pilihan Tampilan akun ada, belum ada baris akun", async () => {
  const html = await render({});
  expect(html).toContain('name="tampilan"');
  expect(html).toContain("Tampilan akun");
  expect(kodeBaris(html)).toEqual([]);
});
