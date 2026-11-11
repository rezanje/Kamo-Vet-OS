// @vitest-environment jsdom
// Form "Batalkan penerimaan": ringkasan efek dulu, alasan wajib, persetujuan eksplisit, lalu satu kali kirim.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ run: [] as FormData[], reply: { ok: true } as { ok: boolean; pesan?: string } }));
const HASIL = { status: "CANCELLED", cancellation_id: "c1", invoice_id: "i1", invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 175000, direct_amount: 175000, cash_amount: 0, shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-11" };
vi.mock("../actions", () => ({
  batalkanPenerimaanKlinik: async (f: FormData) => { calls.run.push(f); return calls.reply.ok ? { ok: true, hasil: HASIL } : { ok: false, pesan: calls.reply.pesan }; },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { BatalPenerimaanForm } from "../BatalPenerimaanForm";

let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
async function type(v: string) { await act(async () => { const i = host.querySelector<HTMLInputElement>("#alasan-batal")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.run = []; calls.reply = { ok: true };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<BatalPenerimaanForm visitId="v1" invoiceId="i1" invoiceNo="INV-9" ringkasan={["Penerimaan langsung Rp 175.000 (QRIS) dikeluarkan dari Bank.", "Tagihan INV-9 kembali Belum Lunas."]} requestKey="kunci-9" kembaliHref="/klinik/pembayaran/v1?invoice_id=i1" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("menampilkan ringkasan efek dari database sebelum apa pun dikirim, tanpa istilah teknis", () => {
  expect(host.textContent).toContain("Yang akan terjadi (belum ada yang berubah)");
  expect(host.textContent).toContain("Penerimaan langsung Rp 175.000 (QRIS) dikeluarkan dari Bank.");
  expect(host.textContent).toContain("Tidak ada kredit atau saldo tersembunyi");
  expect(host.textContent).not.toMatch(/RPC|journal|idempot/i);
  expect(calls.run).toEqual([]);
});
it("tombol terkunci sampai alasan >= 3 huruf DAN persetujuan dicentang", async () => {
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  await type("ab"); expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  await type("Harga salah");
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
});
it("kirim memakai kunci yang sama dan menampilkan hasil + langkah berikutnya", async () => {
  await type("Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run.length).toBe(1);
  const f = calls.run[0];
  expect([f.get("invoice_id"), f.get("visit_id"), f.get("reason"), f.get("request_key")]).toEqual(["i1", "v1", "Harga vaksin salah", "kunci-9"]);
  expect(host.textContent).toContain("Penerimaan INV-9 dibatalkan");
  expect(host.textContent).toContain("ubah tagihan di halaman tagihan");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/klinik/pembayaran/v1?invoice_id=i1");
});
it("penolakan database ditampilkan dalam bahasa biasa dan formulir tetap bisa diulang dengan kunci yang sama", async () => {
  calls.reply = { ok: false, pesan: "Tagihan ini sudah/sedang direfund." };
  await type("Harga vaksin salah"); await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(host.textContent).toContain("Tagihan ini sudah/sedang direfund.");
  expect(btn("Ya, batalkan penerimaan").disabled).toBe(false);
  await act(async () => btn("Ya, batalkan penerimaan").click());
  expect(calls.run.map((f) => f.get("request_key"))).toEqual(["kunci-9", "kunci-9"]);
});
