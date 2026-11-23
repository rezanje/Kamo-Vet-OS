// @vitest-environment jsdom
// Tanggal mundur pada SEMUA layar input pengeluaran (keputusan Owner / Andri 23 Nov 2026: semua akun yang boleh input pengeluaran).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/app/kasir/pengeluaran/actions", () => ({ simpanPengeluaranKasir: fixture.save }));
vi.mock("@/app/(app)/klinik/pengeluaran/actions", () => ({ simpanPengeluaranKlinik: fixture.save }));
vi.mock("@/app/(app)/pos/expense/actions", () => ({ periksaExpense: vi.fn(), simpanExpense: fixture.save }));
vi.mock("@/app/(app)/buku-besar/beban/actions", () => ({ catatBeban: fixture.save }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift", branch_id: "branch", branchName: "Cabang" }) }));
vi.mock("@/lib/checked-list", () => ({ readCompleteList: async () => [] }));
vi.mock("@/components/PilihRekening", () => ({ PilihRekening: () => null, loadRekeningAktif: async () => [] }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => <input type="hidden" name="lampiran" data-draft-state defaultValue="[]" /> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const query = { select: () => query, eq: () => query, gte: () => query, order: () => query, limit: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve) };
  return { from: () => query, auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } };
} }));

import PengeluaranKasirPage from "@/app/kasir/pengeluaran/page";
import ExpensePage from "@/app/(app)/pos/expense/page";
import BebanPage from "@/app/(app)/buku-besar/beban/page";
import { TambahPengeluaran } from "@/app/(app)/klinik/pengeluaran/TambahPengeluaran";
import { hariIniWIB } from "@/lib/tanggal";
import { batasTanggalMundur, geserTanggalISO } from "@/lib/tanggal-mundur";

let host: HTMLDivElement, root: Root;
const today = hariIniWIB();
const kemarin = geserTanggalISO(today, -1);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState(null, "", "/");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

const tgl = () => host.querySelector<HTMLInputElement>('input[name="tanggal"]')!;
const alasan = () => host.querySelector<HTMLInputElement>('input[name="alasan_tanggal"]')!;
const bagian = () => host.querySelector<HTMLDetailsElement>('[data-testid="tanggal-mundur"] details')!;
async function ubahTanggal(nilai: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(tgl(), nilai);
    tgl().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function cekLayar(konteks: "cashier" | "clinic" | "backoffice") {
  // keadaan awal: hari ini, bagian tertutup, alasan belum diminta
  expect(host.querySelectorAll('input[name="tanggal"]').length).toBe(1);
  expect(tgl().value).toBe(today);
  expect(tgl().max).toBe(today);
  expect(tgl().min).toBe(batasTanggalMundur(today));
  expect(host.textContent).toContain("Tanggal mundur (opsional)");
  expect(host.textContent).toContain("Hari ini");
  expect(bagian().open).toBe(false);
  expect(alasan().disabled).toBe(true);
  expect(host.querySelector('[data-testid="banner-tanggal-mundur"]')).toBeNull();
  // memilih kemarin: alasan wajib muncul, banner menyebut tanggal pembukuan
  await ubahTanggal(kemarin);
  expect(bagian().open).toBe(true);
  expect(alasan().disabled).toBe(false);
  expect(alasan().required).toBe(true);
  expect(alasan().minLength).toBe(3);
  expect(alasan().maxLength).toBe(200);
  const banner = host.querySelector('[data-testid="banner-tanggal-mundur"]')!;
  expect(banner.textContent).toContain("Pengeluaran ini dicatat di tanggal");
  expect(banner.textContent).toContain(kemarin.split("-").reverse().join("/"));
  if (konteks === "backoffice") expect(banner.textContent).toContain("tidak memakai laci kasir");
  else expect(banner.textContent).toContain("laci shift Anda yang sedang terbuka hari ini");
  // kembali ke hari ini: banner hilang, alasan tidak dikirim
  await ubahTanggal(today);
  expect(host.querySelector('[data-testid="banner-tanggal-mundur"]')).toBeNull();
  expect(alasan().disabled).toBe(true);
}

it("kasir petshop /kasir/pengeluaran: Tanggal mundur (opsional) tertutup, tanggal min hari-31 max hari ini, alasan wajib saat mundur", async () => {
  await act(async () => root.render(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) })));
  await cekLayar("cashier");
});

it("klinik /klinik/pengeluaran (TambahPengeluaran): bagian yang sama, catatan laci shift klinik", async () => {
  await act(async () => root.render(<TambahPengeluaran userId="user" today={today} shiftId="shift-klinik" />));
  await act(async () => { host.querySelector<HTMLButtonElement>("button.btn-acc")!.click(); });
  await cekLayar("clinic");
});

it("klinik tanpa shift terbuka: tidak ada formulir (tidak berubah)", async () => {
  await act(async () => root.render(<TambahPengeluaran userId="user" today={today} shiftId={null} />));
  await act(async () => { host.querySelector<HTMLButtonElement>("button.btn-acc")!.click(); });
  expect(host.textContent).toContain("Mulai shift klinik dulu");
  expect(host.querySelector('input[name="tanggal"]')).toBeNull();
});

it("back office /pos/expense: kolom tanggal bebas diganti bagian tertutup dengan batas 31 hari dan alasan", async () => {
  await act(async () => root.render(await ExpensePage({ searchParams: Promise.resolve({}) })));
  await cekLayar("backoffice");
});

it("back office /buku-besar/beban: bagian yang sama", async () => {
  await act(async () => root.render(await BebanPage({ searchParams: Promise.resolve({}) })));
  await cekLayar("backoffice");
});

it("alasan dan tanggal ikut terkirim sebagai kolom formulir biasa (nama tanggal dan alasan_tanggal)", async () => {
  await act(async () => root.render(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) })));
  await ubahTanggal(kemarin);
  await act(async () => { alasan().value = "nota terlupa kemarin"; });
  const data = new FormData(host.querySelector("form")!);
  expect(data.get("tanggal")).toBe(kemarin);
  expect(data.get("alasan_tanggal")).toBe("nota terlupa kemarin");
});

it("tanggal hari ini: formulir tidak mengirim alasan (kolom nonaktif)", async () => {
  await act(async () => root.render(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) })));
  const data = new FormData(host.querySelector("form")!);
  expect(data.get("tanggal")).toBe(today);
  expect(data.has("alasan_tanggal")).toBe(false);
});

it("pemulihan draf dengan tanggal lampau membuka bagian dan meminta alasan (tidak diam-diam jadi hari ini)", async () => {
  await act(async () => root.render(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) })));
  await act(async () => {
    tgl().value = kemarin;
    tgl().dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: kemarin }));
  });
  expect(bagian().open).toBe(true);
  expect(alasan().required).toBe(true);
  expect(host.querySelector('[data-testid="banner-tanggal-mundur"]')).not.toBeNull();
});
