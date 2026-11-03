// Formulir "Buat Promo": kolom sejajar di atas (bukan rata bawah, yang membuat label turun-naik
// saat teks bantuan beda tinggi) dan Nama + Teks saran kasir berdampingan, bukan dua baris penuh.
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PromoFields } from "@/app/(app)/crm/promo/PromoFields";

const css = readFileSync("src/app/(app)/crm/promo/PromoForm.module.css", "utf8");
const html = (packageTotal: boolean) => renderToStaticMarkup(
  <PromoFields userId="u" items={[]} branches={[]} categories={[]} today="2026-11-03" packageTotal={packageTotal} />);

it("grid formulir rata atas, bukan rata bawah", () => {
  expect(css).toMatch(/\.form\s*{[^}]*align-items:\s*start/);
  expect(css).not.toMatch(/\.form\s*{[^}]*align-items:\s*end/);
});
it("Nama promo dan Teks saran kasir masing-masing 2 kolom (satu baris)", () => {
  const h = html(false);
  expect(h).toMatch(/grid-column:span 2[^>]*><label[^>]*>Nama promo \*/);
  expect(h).toMatch(/grid-column:span 2[^>]*><label[^>]*>Teks saran untuk kasir \*/);
});
it("Cara hitung nominal tidak lagi memecah baris Tipe/Jenis/Nilai/Min. subtotal", () => {
  const h = html(true);
  const urut = ["Tipe", "Jenis diskon", "Nilai diskon", "Min. subtotal", "Cara hitung diskon nominal", "Aturan jumlah beli"].map(t => h.indexOf(t));
  expect(urut.every(i => i >= 0)).toBe(true);
  expect([...urut].sort((a, b) => a - b)).toEqual(urut);
});

import { PromoTargets } from "@/app/(app)/crm/promo/PromoTargets";
it("pemilih Barang dan Cabang berdampingan (kolom 1-2 dan 3-4), bukan dua blok penuh bertumpuk", () => {
  const h = renderToStaticMarkup(<PromoTargets userId="u" items={[]} branches={[]} categories={[]} />);
  expect(h).toMatch(/grid-column:1 \/ span 2[^>]*><label[^>]*>Barang yang kena promo/);
  expect(h).toMatch(/grid-column:3 \/ span 2[^>]*><label[^>]*>Cabang \(kosongkan/);
});
it("barang terkunci (impor Excel): catatan 2 kolom, Cabang tetap berdampingan", () => {
  const h = renderToStaticMarkup(<PromoTargets userId="u" items={[]} branches={[]} lockItems initialItemIds={["i1"]} />);
  expect(h).toMatch(/grid-column:1 \/ span 2[^>]*><p[^>]*>SKU dan satuan dari impor Excel tetap/);
  expect(h).toMatch(/grid-column:3 \/ span 2[^>]*><label[^>]*>Cabang \(kosongkan/);
});

it("pembungkus pemberitahuan draf selebar formulir dan tidak memakai sel kosong", () => {
  expect(css).toMatch(/\.form\s*>\s*span:empty\s*{[^}]*display:\s*none/);
  expect(css).toMatch(/\.form\s*>\s*span\s*{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
