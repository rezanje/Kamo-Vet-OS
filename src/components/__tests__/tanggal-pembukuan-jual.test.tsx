// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TanggalPembukuanJual } from "../TanggalPembukuanJual";

let root: Root; let host: HTMLDivElement;
const BATAS = { max: "2026-11-17", min: "2026-10-18", canBackdate: true };
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const type = async (name: string, value: string) => act(async () => {
  const input = field(name)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("tanpa hak (batas null atau can_backdate false): tidak ada apa pun di layar", () => {
  expect(renderToStaticMarkup(<TanggalPembukuanJual batas={null} idPrefix="x" hariIni="2026-11-18" />)).toBe("");
  expect(renderToStaticMarkup(<TanggalPembukuanJual batas={{ ...BATAS, canBackdate: false }} idPrefix="x" hariIni="2026-11-18" />)).toBe("");
});

it("Owner/berizin: satu bagian tertutup, kolom tanggal kosong (= hari ini), batas min/max dari database, tanpa alasan sebelum tanggal dipilih", () => {
  const html = renderToStaticMarkup(<TanggalPembukuanJual batas={BATAS} idPrefix="kasir" hariIni="2026-11-18" />);
  expect(html).toContain("<details"); expect(html).not.toContain("<details open");
  expect(html).toContain("Ubah tanggal pembukuan (opsional)");
  expect(html).toContain('name="tanggal_pembukuan"'); expect(html).toContain('min="2026-10-18"'); expect(html).toContain('max="2026-11-17"'); expect(html).toContain('type="date"');
  expect(html).not.toContain('name="alasan_tanggal"'); expect(html).not.toContain("banner-tanggal-mundur");
  expect(html).toContain("harga master hari ini"); expect(html).toContain("tanpa promo, voucher, atau poin");
  expect(html).not.toContain("Tanggal mundur"); // kata layar tenang: tidak ada label "Tanggal mundur"
});

it("memilih kemarin: alasan wajib muncul, banner selalu terlihat (di luar bagian tertutup) dan menyebut tanggal", async () => {
  await act(async () => { root.render(<TanggalPembukuanJual batas={BATAS} idPrefix="kasir" hariIni="2026-11-18" />); });
  await type("tanggal_pembukuan", "2026-11-17");
  const alasan = field("alasan_tanggal")!;
  expect(alasan).not.toBeNull(); expect(alasan.required).toBe(true); expect(alasan.minLength).toBe(3); expect(alasan.maxLength).toBe(200);
  const banner = host.querySelector('[data-testid="banner-tanggal-mundur"]')!;
  expect(banner.textContent).toBe("Struk ini dicatat di tanggal 17/11/2026 (dicatat hari ini 18/11/2026)");
  expect(banner.closest("details")).toBeNull();
  await type("alasan_tanggal", "Barang lupa diinput kemarin");
  expect(field("alasan_tanggal")!.value).toBe("Barang lupa diinput kemarin");
});

it("Pakai hari ini mengosongkan tanggal dan alasan; banner hilang", async () => {
  await act(async () => { root.render(<TanggalPembukuanJual batas={BATAS} idPrefix="kasir" hariIni="2026-11-18" />); });
  await type("tanggal_pembukuan", "2026-11-17");
  const tombol = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Pakai hari ini")!;
  await act(async () => { tombol.click(); });
  expect(field("tanggal_pembukuan")!.value).toBe(""); expect(field("alasan_tanggal")).toBeNull();
  expect(host.querySelector('[data-testid="banner-tanggal-mundur"]')).toBeNull();
});

it("tanggal awal dari peringatan HPP: bagian terbuka, tanggal dan alasan terisi, banner terlihat", async () => {
  await act(async () => { root.render(<TanggalPembukuanJual batas={BATAS} idPrefix="pos" tanggalAwal="2026-11-17" alasanAwal="Barang lupa" hariIni="2026-11-18" />); });
  expect(host.querySelector("details")!.open).toBe(true);
  expect(field("tanggal_pembukuan")!.value).toBe("2026-11-17"); expect(field("alasan_tanggal")!.value).toBe("Barang lupa");
  expect(host.querySelector('[data-testid="banner-tanggal-mundur"]')).not.toBeNull();
});
