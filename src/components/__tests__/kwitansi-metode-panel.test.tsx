// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ action: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/payment-correction-actions", () => ({ ubahMetodeKwitansiKlinik: fixture.action }));
import { KwitansiMetodePanel } from "@/app/(app)/klinik/pembayaran/[visitId]/KwitansiMetodePanel";
import { METODE_BAYAR } from "@/lib/metode-bayar";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const receipt = (extra = {}) => ({ id: "r1", no: "KWT-202611-0001", tanggal: "2026-11-12", shiftClosed: false,
  parts: [{ id: "p1", urutan: 1, metode: "Tunai" as const, amount: 150000 }, { id: "p2", urutan: 2, metode: "QRIS" as const, amount: 50000 }], ...extra });

it("satu formulir per bagian kwitansi; pilihan = semua metode lain; nama bagian dan nominal tampil", async () => {
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt()]} history={[]} readError={false} />));
  const selects = [...host.querySelectorAll<HTMLSelectElement>('select[name="metode"]')];
  expect(selects).toHaveLength(2);
  expect([...selects[0].options].map(o => o.value).filter(Boolean)).toEqual(METODE_BAYAR.map(o => o.m).filter(m => m !== "Tunai"));
  expect([...selects[1].options].map(o => o.value).filter(Boolean)).toEqual(METODE_BAYAR.map(o => o.m).filter(m => m !== "QRIS"));
  expect(host.textContent).toContain("KWT-202611-0001");
  expect(host.textContent).toContain("UBAH METODE BAYAR KWITANSI");
  expect(host.querySelector<HTMLInputElement>('input[name="partId"]')!.value).toBe("p1");
  expect(host.querySelector<HTMLInputElement>('input[name="receiptId"]')!.value).toBe("r1");
  expect(selects[0].required).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[name="alasan"]')!.required).toBe(true);
});

it("tombol nonaktif sampai metode dipilih; memilih non-Tunai dari Tunai menjelaskan efek laci shift", async () => {
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt()]} history={[]} readError={false} />));
  const btn = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(btn.disabled).toBe(true);
  const select = host.querySelector<HTMLSelectElement>('select[name="metode"]')!;
  await act(async () => { select.value = "QRIS"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("dikeluarkan dari hitungan laci shift");
  expect(host.textContent).not.toContain("sudah ditutup");
});

it("shift sudah tutup: peringatan bahwa angka penutupan tidak diubah", async () => {
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt({ shiftClosed: true })]} history={[]} readError={false} />));
  const select = host.querySelector<HTMLSelectElement>('select[name="metode"]')!;
  await act(async () => { select.value = "Debit"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("angka penutupannya TIDAK diubah");
});

it("non-Tunai ke Tunai: laci bertambah; non-Tunai ke non-Tunai: tanpa catatan laci", async () => {
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt()]} history={[]} readError={false} />));
  const selects = [...host.querySelectorAll<HTMLSelectElement>('select[name="metode"]')];
  await act(async () => { selects[1].value = "Debit"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).not.toContain("hitungan laci shift kasir yang menerimanya");
  await act(async () => { selects[1].value = "Tunai"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("ditambahkan ke hitungan laci");
});

it("riwayat koreksi tampil; kegagalan baca tidak menampilkan formulir; tanpa kwitansi: pesan", async () => {
  const h = [{ id: "h1", receipt_id: "r1", revision: 1, amount: 150000, from_method: "Tunai", to_method: "QRIS", reason: "Kasir salah pilih", created_at: "2026-11-12T03:00:00Z" }];
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt()]} history={h} readError={false} />));
  expect(host.textContent).toContain("Revisi 1");
  expect(host.textContent).toContain("Kasir salah pilih");
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[receipt()]} history={[]} readError />));
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("belum dapat dibaca");
  await act(async () => root.render(<KwitansiMetodePanel userId="u" visitId="v" receipts={[]} history={[]} readError={false} />));
  expect(host.textContent).toContain("Tidak ada kwitansi aktif");
});
