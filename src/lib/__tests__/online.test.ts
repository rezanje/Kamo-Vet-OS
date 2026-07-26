import { describe, expect, it } from "vitest";
import {
  formatNoOnline,
  hitungKomisi,
  isChannel,
  isMarketplace,
  prefixNoOnline,
  totalOnline,
} from "../online";

describe("isChannel", () => {
  it("hanya 4 channel yang diakui", () => {
    expect(isChannel("Shopee")).toBe(true);
    expect(isChannel("WA")).toBe(true);
    expect(isChannel("Lazada")).toBe(false);
    expect(isChannel("")).toBe(false);
  });
});

describe("isMarketplace", () => {
  it("marketplace = Shopee/Tokopedia/TikTok Shop, WA bukan", () => {
    expect(isMarketplace("Shopee")).toBe(true);
    expect(isMarketplace("Tokopedia")).toBe(true);
    expect(isMarketplace("TikTok Shop")).toBe(true);
    expect(isMarketplace("WA")).toBe(false);
    expect(isMarketplace("Lazada")).toBe(false);
  });
});

describe("prefixNoOnline / formatNoOnline", () => {
  it("format ONL-YYYYMMDD-NNNN", () => {
    expect(prefixNoOnline(new Date(2026, 6, 26))).toBe("ONL-20260726");
    expect(formatNoOnline(new Date(2026, 6, 26), 1)).toBe("ONL-20260726-0001");
    expect(formatNoOnline(new Date(2026, 11, 3), 42)).toBe("ONL-20261203-0042");
  });
});

describe("totalOnline", () => {
  it("jumlahkan qty x harga", () => {
    expect(totalOnline([{ qty: 2, harga: 5000 }, { qty: 1, harga: 2500 }])).toBe(12500);
  });
  it("baris kosong = 0", () => {
    expect(totalOnline([])).toBe(0);
  });
});

describe("hitungKomisi", () => {
  it("komisi = total - dana cair", () => {
    expect(hitungKomisi(100000, 94000)).toBe(6000);
  });
  it("cair penuh = tanpa komisi", () => {
    expect(hitungKomisi(100000, 100000)).toBe(0);
  });
  it("cair lebih besar dari total tidak bikin komisi negatif", () => {
    expect(hitungKomisi(100000, 110000)).toBe(0);
  });
});
