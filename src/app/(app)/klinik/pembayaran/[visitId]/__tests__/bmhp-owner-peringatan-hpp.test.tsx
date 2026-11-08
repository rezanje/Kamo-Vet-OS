// @vitest-environment jsdom
// Review kondisi C2: pada baris yang HPP-nya berbeda dari modal bahannya (mis. Injeksi Non Antibiotik INV-202611-0434: HPP 2.600,74 vs bahan 9.433,68),
// koreksi hanya menggeser HPP sebesar SELISIH BAHAN. Pratinjau (dan hasil simpan) wajib menyebut itu dalam bahasa Indonesia yang jelas.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const aksi = vi.hoisted(() => ({ pratinjau: vi.fn(), simpan: vi.fn() }));
vi.mock("../bmhp-owner-actions", () => ({ pratinjauBmhp: aksi.pratinjau, simpanBmhp: aksi.simpan }));
import { BmhpOwnerForm } from "../BmhpOwnerForm";
import { PERINGATAN_HPP_BEDA_BAHAN } from "@/lib/bmhp-owner";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const komponen = [{ item_id: U(10), name: "Meloxicam Inj Fiktif", qty: 1, unit: null, base_qty: 1, cost: 9433.68 }];
const dasar = { price: 50000, floor_applies: true, price_below_hpp_before: false, price_below_hpp_after: false, cost_before: 9433.68, cost_after: 4716.84, hpp_before: 2600.74, hpp_after: 0 };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); aksi.pratinjau.mockReset(); aksi.simpan.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const tombol = (teks: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(teks)) as HTMLButtonElement | undefined;
const klik = async (el: HTMLElement) => act(async () => { el.click(); });
const ketik = async (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true }));
});
async function bukaDanPratinjau(mode: "pending" | "tagihan") {
  await act(async () => root.render(<BmhpOwnerForm mode={mode} visitId={U(1)} recordId={U(2)} targetId={U(3)} snapshot="snapshot-1" title="Injeksi Non Antibiotik" price={50000} components={komponen} master={[]} requestKey="k" />));
  await klik(tombol("Ubah BMHP (Owner)")!);
  await ketik(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Meloxicam Inj Fiktif"]')!, "0.5");
  await klik(tombol("Pratinjau")!);
}

it("kalimat peringatan memuat arti yang diminta dalam bahasa Indonesia sederhana", () => {
  expect(PERINGATAN_HPP_BEDA_BAHAN).toContain("modal baris ini berbeda dari modal bahannya; koreksi menggeser modal sebesar selisih bahan");
});
it("tagihan: pratinjau dengan hpp_differs_from_cost menampilkan peringatan jelas (role alert) dengan HPP sebelum/sesudah", async () => {
  aksi.pratinjau.mockResolvedValue({ ok: true, pratinjau: { ...dasar, hpp_differs_from_cost: true, hpp_after: 2600.74 } });
  await bukaDanPratinjau("tagihan");
  const alert = [...host.querySelectorAll('[role="alert"]')].find((e) => e.textContent?.includes("modal baris ini berbeda dari modal bahannya"));
  expect(alert).toBeDefined();
  expect(alert!.textContent).toContain("koreksi menggeser modal sebesar selisih bahan");
  expect(host.textContent).toContain("Pratinjau (belum ada yang berubah)");
});
it("tagihan: tanpa perbedaan HPP vs bahan, peringatan tidak muncul", async () => {
  aksi.pratinjau.mockResolvedValue({ ok: true, pratinjau: { ...dasar, hpp_differs_from_cost: false, hpp_before: 9433.68, hpp_after: 4716.84 } });
  await bukaDanPratinjau("tagihan");
  expect(host.textContent).toContain("Pratinjau (belum ada yang berubah)");
  expect(host.textContent).not.toContain("modal baris ini berbeda dari modal bahannya");
});
it("tagihan: sesudah disimpan, hasil yang HPP-nya berbeda dari bahan tetap mengulang peringatan", async () => {
  aksi.pratinjau.mockResolvedValue({ ok: true, pratinjau: { ...dasar, hpp_differs_from_cost: true } });
  aksi.simpan.mockResolvedValue({ ok: true, pratinjau: { ...dasar, hpp_differs_from_cost: true, hpp_after: 1800 } });
  await bukaDanPratinjau("tagihan");
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-" + U(3))!, "Meloxicam 0,5 sesuai pemakaian");
  await klik(tombol("Simpan perubahan BMHP")!);
  expect(host.textContent).toContain("sudah diubah");
  expect(host.textContent).toContain("modal baris ini berbeda dari modal bahannya");
});
it("keranjang kasir (pending): tidak ada klaim HPP berbeda dari bahan (belum ada invoice), tidak muncul", async () => {
  aksi.pratinjau.mockResolvedValue({ ok: true, pratinjau: { ...dasar, hpp_differs_from_cost: true, can_post_after: true } });
  await bukaDanPratinjau("pending");
  expect(host.textContent).toContain("Pratinjau (belum ada yang berubah)");
  expect(host.textContent).not.toContain("modal baris ini berbeda dari modal bahannya");
});
