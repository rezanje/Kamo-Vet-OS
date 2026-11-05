import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/app/(app)/penjualan/online/actions", () => ({ cairkanSekaligus: vi.fn() }));
import { CairSekaligusForm, type GrupPiutang } from "@/app/(app)/penjualan/online/CairSekaligusForm";

const groups: GrupPiutang[] = [
  { key: "Shopee|b2c", channel: "Shopee", cabang: "B2C", orders: [
    { id: "s1", no_struk: "ONL-1", tanggal: "01 Nov 2026", external_ref: "SPX1", pembeli: "Budi", total: 100000 },
    { id: "s2", no_struk: "ONL-2", tanggal: "02 Nov 2026", external_ref: null, pembeli: null, total: 50000 },
  ] },
  { key: "Tokopedia|b2c", channel: "Tokopedia", cabang: "B2C", orders: [
    { id: "s3", no_struk: "ONL-3", tanggal: "03 Nov 2026", external_ref: null, pembeli: null, total: 70000 },
  ] },
];

it("lists the first shop's receivables all ticked, with the request identity and bank choice", () => {
  const html = renderToStaticMarkup(
    <CairSekaligusForm groups={groups} rekening={[{ id: "rek", nama: "Bank BCA Toko" }]} today="2026-11-05" requestKey="key-1" />,
  );
  expect(html).toContain('name="request_key" value="key-1"');
  expect(html).toContain("Shopee · B2C — 2 order · Rp 150.000");
  expect(html).toContain("Tokopedia · B2C — 1 order");
  expect(html.match(/name="sale_id"/g)).toHaveLength(2);
  expect(html).not.toContain('value="s3"');
  expect(html).toContain("Total order dipilih (2): <b>Rp 150.000</b>");
  expect(html).toContain("Bank BCA Toko");
  expect(html).toContain('max="2026-11-05"');
});
