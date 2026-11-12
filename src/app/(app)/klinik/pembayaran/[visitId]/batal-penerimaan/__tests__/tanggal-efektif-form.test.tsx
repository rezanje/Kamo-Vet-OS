// @vitest-environment jsdom
// Form "Batalkan penerimaan" dengan tanggal efektif: pemilih tanggal hanya untuk yang berhak, batas min/max, pratinjau ulang, penolakan menahan tombol.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ run: [] as FormData[], prev: [] as string[], prevReply: { ok: true, ringkasan: ["Jurnal pembalik bertanggal 2026-11-09."], tolakTanggal: null, minTanggal: "2026-11-09" } as unknown }));
vi.mock("../actions", () => ({
  batalkanPenerimaanKlinik: async (f: FormData) => { calls.run.push(f); return { ok: true, hasil: { status: "CANCELLED", cancellation_id: "c1", invoice_id: "i1", invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 108000, direct_amount: 108000, cash_amount: 0, shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-09", effective_date: "2026-11-09", actual_date: "2026-11-12", backdated: true } }; },
  pratinjauTanggalBatalPenerimaan: async (_i: string, t: string) => { calls.prev.push(t); return calls.prevReply; },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { BatalPenerimaanForm } from "../BatalPenerimaanForm";

let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
async function setVal(sel: string, v: string) { await act(async () => { const i = host.querySelector<HTMLInputElement>(sel)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function mount(props: Record<string, unknown>) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<BatalPenerimaanForm visitId="v1" invoiceId="i1" invoiceNo="INV-9" ringkasan={["Penerimaan langsung Rp 108.000 (QRIS) dikeluarkan dari Bank."]} requestKey="kunci-9" kembaliHref="/k" {...props} />));
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.run = []; calls.prev = []; calls.prevReply = { ok: true, ringkasan: ["Jurnal pembalik bertanggal 2026-11-09."], tolakTanggal: null, minTanggal: "2026-11-09" }; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("Owner: pemilih tanggal bawaan hari ini, batas min = tanggal penerimaan asli, max = hari ini", async () => {
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: true });
  const d = host.querySelector<HTMLInputElement>("#tanggal-efektif")!;
  expect([d.type, d.value, d.min, d.max]).toEqual(["date", "2026-11-12", "2026-11-09", "2026-11-12"]);
  expect(host.textContent).toContain("masuk omzet hari aslinya");
});
it("peran tanpa izin tanggal mundur: tidak ada pemilih tanggal, hanya keterangan hari ini; kiriman tanpa effective_date", async () => {
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: false });
  expect(host.querySelector("#tanggal-efektif")).toBeNull();
  expect(host.textContent).toContain("hanya untuk Owner");
  await setVal("#alasan-batal", "Harga salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run[0].has("effective_date")).toBe(false);
});
it("memilih tanggal mundur memuat pratinjau ulang (ringkasan baru) dan mengirim effective_date", async () => {
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: true });
  await setVal("#tanggal-efektif", "2026-11-09");
  expect(calls.prev).toEqual(["2026-11-09"]);
  expect(host.textContent).toContain("Jurnal pembalik bertanggal 2026-11-09.");
  expect(host.textContent).toContain("pada tanggal 2026-11-09");
  await setVal("#alasan-batal", "Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run[0].get("effective_date")).toBe("2026-11-09");
  expect(host.textContent).toContain("Keduanya otomatis dibukukan pada tanggal 2026-11-09");
  expect(host.textContent).toContain("dicatat sebenarnya 2026-11-12");
});
it("tanggal ditolak database (periode terkunci): pesan tampil dan tombol tetap terkunci sampai tanggal valid", async () => {
  calls.prevReply = { ok: true, ringkasan: ["x"], tolakTanggal: "Periode akuntansi sampai 2026-11-09 sudah ditutup. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku.", minTanggal: "2026-11-09" };
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: true });
  await setVal("#tanggal-efektif", "2026-11-09");
  expect(host.textContent).toContain("Tutup Buku");
  await setVal("#alasan-batal", "Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  calls.prevReply = { ok: true, ringkasan: ["ok"], tolakTanggal: null, minTanggal: "2026-11-09" };
  await setVal("#tanggal-efektif", "2026-11-10");
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
});
it("pratinjau gagal (tidak ok) menahan tombol dan menampilkan alasan", async () => {
  calls.prevReply = { ok: false, pesan: "Tagihan ini sudah/sedang direfund." };
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: true });
  await setVal("#tanggal-efektif", "2026-11-09");
  expect(host.textContent).toContain("sudah/sedang direfund");
  await setVal("#alasan-batal", "Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
});
it("kosongkan tanggal menahan tombol; tanpa props tanggal (versi lama) perilaku lama persis", async () => {
  await mount({ hariIni: "2026-11-12", minTanggal: "2026-11-09", bolehMundur: true });
  await setVal("#tanggal-efektif", "");
  await setVal("#alasan-batal", "Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  await act(async () => root.unmount()); host.remove();
  await mount({});
  expect(host.querySelector("#tanggal-efektif")).toBeNull();
  await setVal("#alasan-batal", "Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
});
