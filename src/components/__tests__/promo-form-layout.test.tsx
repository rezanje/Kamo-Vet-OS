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
