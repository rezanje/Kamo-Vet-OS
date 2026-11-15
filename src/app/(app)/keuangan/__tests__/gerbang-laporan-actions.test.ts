import { expect, it, vi } from "vitest";

// A1 (meeting 12 Nov 2026): aksi di layar laporan keuangan kembali ke daftar yang sudah
// tampil (tampil=1), dengan pesan yang tetap utuh.

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => ({}), assertMasterAdmin: async () => ({}) }));
vi.mock("@/lib/role-action-access", () => ({ roleActionRefusal: async () => null, roleRpcFailure: () => null }));

import { terimaPelunasan } from "@/app/(app)/keuangan/piutang/actions";
import { jurnalManual } from "@/app/(app)/keuangan/jurnal/actions";
import { jalankanPenyusutan } from "@/app/(app)/keuangan/aset/actions";
import { simpanKategoriAset } from "@/app/(app)/keuangan/kategori-aset/actions";
import { prosesRekonsiliasi, pulihkanRekonsiliasi } from "@/app/(app)/keuangan/rekonsiliasi/actions";

const kosong = () => new FormData();

it.each([
  ["piutang", () => terimaPelunasan(kosong()), "/keuangan/piutang?error="],
  ["jurnal", () => jurnalManual(kosong()), "/keuangan/jurnal?error="],
  ["aset", () => jalankanPenyusutan(kosong()), "/keuangan/aset?error=Periode%20tidak%20valid"],
  ["kategori aset", () => simpanKategoriAset(kosong()), "/keuangan/kategori-aset?error=Nama%20kategori%20wajib%20diisi"],
  ["rekonsiliasi baru", () => prosesRekonsiliasi(kosong()), "/keuangan/rekonsiliasi?error="],
  ["pemulihan rekonsiliasi", () => pulihkanRekonsiliasi(kosong()), "/keuangan/rekonsiliasi?error="],
])("%s: redirect balik membawa tampil=1", async (_, aksi, awal) => {
  const url = await aksi().then(() => "", (e: Error) => e.message);
  expect(url.startsWith(awal)).toBe(true);
  expect(url.endsWith("&tampil=1")).toBe(true);
});
