// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Pelanggan nonaktif (Aldi 5 Nov 2026): tombol Nonaktifkan/Aktifkan lagi di menu Pelanggan.
// Aksi server diganti; aturan perannya diuji di database (scripts/test-pelanggan-nonaktif-postgres.py).
const s = vi.hoisted(() => ({ calls: [] as Array<[string, boolean, string]>, reply: null as unknown }));
vi.mock("@/app/(app)/crm/pelanggan/actions", () => ({
  ubahStatusPelanggan: async (id: string, aktif: boolean, alasan: string) => { s.calls.push([id, aktif, alasan]); return s.reply; },
}));
import { StatusPelangganPanel } from "@/app/(app)/crm/pelanggan/StatusPelanggan";

const ID = "11111111-1111-4111-8111-111111111111";
const AKTIF = { is_active: true, deactivated_at: null, deactivation_reason: null, penonaktif: null };
const NONAKTIF = { is_active: false, deactivated_at: "2026-11-05T08:00:00Z", deactivation_reason: "Akun penampung CS pusat", penonaktif: "Reza" };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  s.calls = []; s.reply = null;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const tombol = (teks: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(teks));
const klik = async (el: Element | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };

it("staf biasa tidak melihat tombol apa pun untuk pelanggan aktif", async () => {
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={AKTIF} isAdmin={false} onBerubah={() => {}} />));
  expect(host.textContent).toBe("");
});

it("admin menonaktifkan setelah konfirmasi, dengan alasan, lalu layar diberi status baru", async () => {
  const onBerubah = vi.fn();
  s.reply = { ok: true, status: NONAKTIF };
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={AKTIF} isAdmin onBerubah={onBerubah} />));
  await klik(tombol("Nonaktifkan pelanggan"));
  expect(host.textContent).toContain("tidak akan muncul lagi di pencarian kasir");
  const alasan = host.querySelector<HTMLInputElement>('input[aria-label="Alasan menonaktifkan"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(alasan, "Akun penampung CS pusat");
    alasan.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await klik(tombol("Ya, nonaktifkan"));
  expect(s.calls).toEqual([[ID, false, "Akun penampung CS pusat"]]);
  expect(onBerubah).toHaveBeenCalledWith(NONAKTIF);
});

it("batal tidak mengirim apa pun", async () => {
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={AKTIF} isAdmin onBerubah={() => {}} />));
  await klik(tombol("Nonaktifkan pelanggan"));
  await klik(tombol("Batal"));
  expect(s.calls).toEqual([]);
  expect(tombol("Nonaktifkan pelanggan")).toBeTruthy();
});

it("pelanggan nonaktif menampilkan keterangan untuk semua peran; hanya admin yang bisa mengaktifkan lagi", async () => {
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={NONAKTIF} isAdmin={false} onBerubah={() => {}} />));
  expect(host.textContent).toContain("Pelanggan nonaktif");
  expect(host.textContent).toContain("oleh Reza");
  expect(host.textContent).toContain("Akun penampung CS pusat");
  expect(tombol("Aktifkan lagi")).toBeUndefined();

  const onBerubah = vi.fn();
  s.reply = { ok: true, status: AKTIF };
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={NONAKTIF} isAdmin onBerubah={onBerubah} />));
  await klik(tombol("Aktifkan lagi"));
  expect(s.calls).toEqual([[ID, true, ""]]);
  expect(onBerubah).toHaveBeenCalledWith(AKTIF);
});

it("penolakan server ditampilkan, status tidak berubah", async () => {
  const onBerubah = vi.fn();
  s.reply = { ok: false, error: "Hanya owner/admin yang bisa menonaktifkan atau mengaktifkan pelanggan." };
  await act(async () => root.render(<StatusPelangganPanel id={ID} nama="CS Pusat" status={NONAKTIF} isAdmin onBerubah={onBerubah} />));
  await klik(tombol("Aktifkan lagi"));
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Hanya owner/admin");
  expect(onBerubah).not.toHaveBeenCalled();
});
