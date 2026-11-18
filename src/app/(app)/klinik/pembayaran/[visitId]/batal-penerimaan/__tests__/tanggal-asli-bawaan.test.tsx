// @vitest-environment jsdom
// Bawaan tanggal pembukuan "Batalkan penerimaan" klinik untuk Owner = tanggal transaksi asli (aturan Andri gaya Accurate, INV-202611-0047:
// dibatalkan tgl 18 Nov padahal transaksi tgl 1 Nov tercatat di tgl 18). Hari yang sama = tetap hari ini. Database tetap pemutus.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ run: [] as FormData[], prev: [] as string[], prevReply: { ok: true, ringkasan: ["Jurnal pembalik bertanggal 2026-11-01."], tolakTanggal: null, minTanggal: "2026-11-01" } as unknown, gate: null as Promise<void> | null }));
vi.mock("../actions", () => ({
  batalkanPenerimaanKlinik: async (f: FormData) => { calls.run.push(f); return { ok: true, hasil: { status: "CANCELLED", cancellation_id: "c1", invoice_id: "i1", invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 310000, direct_amount: 310000, cash_amount: 0, shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-18", effective_date: "2026-11-01", actual_date: "2026-11-18", backdated: true } }; },
  pratinjauTanggalBatalPenerimaan: async (_i: string, t: string) => { calls.prev.push(t); if (calls.gate) await calls.gate; return calls.prevReply; },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { BatalPenerimaanForm } from "../BatalPenerimaanForm";

let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
async function setVal(sel: string, v: string) { await act(async () => { const i = host.querySelector<HTMLInputElement>(sel)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function mount(props: Record<string, unknown>) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<BatalPenerimaanForm visitId="v1" invoiceId="i1" invoiceNo="INV-9" ringkasan={["Penerimaan langsung Rp 310.000 (QRIS) dikeluarkan dari Bank."]} requestKey="kunci-9" kembaliHref="/k" {...props} />));
}
const setuju = async () => { await setVal("#alasan-batal", "Harga salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click()); };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.run = []; calls.prev = []; calls.gate = null; calls.prevReply = { ok: true, ringkasan: ["Jurnal pembalik bertanggal 2026-11-01."], tolakTanggal: null, minTanggal: "2026-11-01" }; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("Owner, transaksi tgl 1 Nov dibatalkan tgl 18 Nov: tanggal bawaan = 1 Nov, kontrol terbuka, pratinjau 1 Nov dimuat, ringkasan diganti", async () => {
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: true });
  const d = host.querySelector<HTMLInputElement>("#tanggal-efektif")!;
  expect([d.value, d.min, d.max]).toEqual(["2026-11-01", "2026-11-01", "2026-11-18"]);
  expect(host.querySelector<HTMLDetailsElement>('[data-testid="ubah-tanggal-pembukuan"]')!.open).toBe(true);
  expect(calls.prev).toEqual(["2026-11-01"]);
  expect(host.textContent).toContain("Jurnal pembalik bertanggal 2026-11-01.");
  expect(host.textContent).toContain("tanggal transaksi asli");
});
it("tanpa mengubah apa pun, kiriman membawa effective_date = tanggal asli (1 Nov)", async () => {
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: true });
  await setuju();
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run[0].get("effective_date")).toBe("2026-11-01");
});
it("Owner masih bisa memilih hari ini secara sadar: kiriman effective_date = hari ini", async () => {
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: true });
  await setVal("#tanggal-efektif", "2026-11-18");
  await setuju();
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run[0].get("effective_date")).toBe("2026-11-18");
});
it("transaksi hari ini (min = hari ini): bawaan hari ini, tertutup, tanpa pratinjau tambahan", async () => {
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-18", bolehMundur: true });
  expect(host.querySelector<HTMLInputElement>("#tanggal-efektif")!.value).toBe("2026-11-18");
  expect(host.querySelector<HTMLDetailsElement>('[data-testid="ubah-tanggal-pembukuan"]')!.open).toBe(false);
  expect(calls.prev).toEqual([]);
  expect(host.textContent).not.toContain("tanggal transaksi asli");
});
it("tanggal asli ditolak database (periode terkunci / gaji): pesan tampil, tombol terkunci sampai Owner memilih tanggal lain", async () => {
  calls.prevReply = { ok: true, ringkasan: ["x"], tolakTanggal: "Penggajian untuk bulan 2026-11 sudah dibuat.", minTanggal: "2026-11-01" };
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: true });
  expect(host.textContent).toContain("Penggajian untuk bulan 2026-11 sudah dibuat.");
  await setuju();
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  calls.prevReply = { ok: true, ringkasan: ["ok"], tolakTanggal: null, minTanggal: "2026-11-01" };
  await setVal("#tanggal-efektif", "2026-11-18");
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
});
it("tombol terkunci selama pratinjau tanggal asli belum dijawab database, lalu terbuka", async () => {
  let lepas: () => void = () => {};
  calls.gate = new Promise<void>((r) => { lepas = r; });
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: true });
  await setuju();
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  await act(async () => { lepas(); await calls.gate; });
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
});
it("peran tanpa izin: tidak ada kata tanggal, tidak ada pratinjau, kiriman tanpa effective_date", async () => {
  await mount({ hariIni: "2026-11-18", minTanggal: "2026-11-01", bolehMundur: false });
  expect(host.querySelector("#tanggal-efektif")).toBeNull();
  expect(calls.prev).toEqual([]);
  expect(host.textContent).not.toMatch(/tanggal|Owner/i);
  await setuju();
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run[0].has("effective_date")).toBe(false);
});
