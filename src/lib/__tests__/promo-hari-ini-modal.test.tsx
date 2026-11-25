// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromoHariIniModal } from "@/app/kasir/PromoHariIniModal";
import { cariPromo, promoAturan, promoBerlaku, promoCabang, promoChip, tanggalPendek, type PromoPopupRow } from "@/lib/promo-popup";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.style.overflow = ""; });

const banyak = (n: number): PromoPopupRow[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Promo nomor ${i + 1}`, promo_type: "diskon_produk", discount_type: i % 2 ? "percent" : "nominal", discount_value: i % 2 ? 50 : 7000,
  min_qty: i % 3 === 0 ? 2 : null, kelipatan: i % 3 === 0, valid_from: "2026-11-03", valid_until: "2026-12-31", rule: i === 0 ? { suggest: "Bolt 800gr Campur Varian - 2 Rp38.000 / 6 Rp110.000" } : null,
  branch_ids: i === 1 ? ["b1"] : null,
}));
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const render = async (promos: PromoPopupRow[], onClose = vi.fn()) => { await act(async () => root.render(<PromoHariIniModal promos={promos} branchName="Kamo Petshop Ciawi" onClose={onClose} />)); return onClose; };

describe("PromoHariIniModal", () => {
  it("13+ promo: semua tampil di dalam daftar yang bisa digulir sendiri (bukan di panel ber-overflow hidden)", async () => {
    await render(banyak(14));
    expect(container.querySelectorAll('[data-testid="promo-popup-item"]')).toHaveLength(14);
    const list = q("promo-popup-list")!, panel = q("promo-popup-panel")!;
    const ls = getComputedStyle(list), ps = getComputedStyle(panel);
    expect(ls.overflowY).toBe("auto");
    expect(ls.overflowX).toBe("hidden");
    expect(ls.minHeight).toMatch(/^0(px)?$/); // wajib agar anak flex boleh menyusut dan menggulir
    expect(ps.display).toBe("flex"); expect(ps.flexDirection).toBe("column");
    expect(ps.maxHeight).toMatch(/vh|px/); // panel dibatasi tinggi layar
    // Regresi bug 25 Nov: panel yang sama TIDAK boleh memegang overflowY:auto lalu ditimpa overflow:hidden.
    expect(ps.overflow).toBe("hidden");
    expect(list.parentElement).toBe(panel);
    expect(panel.firstElementChild!.textContent).toContain("Promo Berjalan Hari Ini"); // header di luar area gulir
    expect(list.contains(panel.firstElementChild)).toBe(false);
  });
  it("mengunci gulir halaman di belakang dan melepasnya saat ditutup", async () => {
    await render(banyak(3)); expect(document.body.style.overflow).toBe("hidden");
    await act(async () => root.render(<div />)); expect(document.body.style.overflow).toBe("");
  });
  it("kartu: nama tebal, chip tipe, aturan, masa berlaku, cabang", async () => {
    await render(banyak(4));
    const items = container.querySelectorAll('[data-testid="promo-popup-item"]');
    expect(items[0].textContent).toContain("Promo nomor 1");
    expect(items[0].textContent).toContain("Potongan Rp");
    expect(items[0].textContent).toContain("Bolt 800gr Campur Varian - 2 Rp38.000 / 6 Rp110.000");
    expect(items[0].textContent).toContain("Berlaku 3 Nov 2026 s/d 31 Des 2026");
    expect(items[1].textContent).toContain("Potongan %");
    expect(items[1].textContent).toContain("Khusus cabang ini");
    expect(items[1].textContent).toContain("Diskon 50%");
    expect(items[3].textContent).toContain("min. 2 pcs, berlaku kelipatan");
  });
  it("pencarian hanya muncul bila lebih dari 8 promo, menyaring, dan ada pesan kosong", async () => {
    await render(banyak(8)); expect(q("promo-popup-cari")).toBeNull();
    await render(banyak(13)); const cari = q("promo-popup-cari") as HTMLInputElement; expect(cari).not.toBeNull();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cari, "nomor 13"); cari.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelectorAll('[data-testid="promo-popup-item"]')).toHaveLength(1);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cari, "zzz"); cari.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(q("promo-popup-kosong")!.textContent).toContain("zzz");
  });
  it("tombol tutup, klik latar, dan Escape menutup; klik isi panel tidak", async () => {
    const onClose = await render(banyak(2));
    await act(async () => q("promo-popup-panel")!.click()); expect(onClose).not.toHaveBeenCalled();
    await act(async () => q("promo-popup-tutup")!.click()); expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => q("promo-popup")!.click()); expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); }); expect(onClose).toHaveBeenCalledTimes(3);
  });
  it("tanpa promo: pesan kosong; tidak ada elemen yang melebar horizontal (nama panjang membungkus)", async () => {
    await render([]); expect(container.textContent).toContain("Tidak ada promo aktif hari ini untuk cabang ini.");
    await render([{ id: "x", name: "A".repeat(200), valid_from: null, valid_until: null }]);
    const nama = container.querySelector('[data-testid="promo-popup-item"] div div') as HTMLElement;
    expect(getComputedStyle(nama).overflowWrap).toBe("anywhere");
    expect(container.textContent).toContain("Berlaku — s/d tanpa batas");
  });
});

describe("promo-popup helper", () => {
  it("tanggal, chip, aturan, cabang, cari", () => {
    expect(tanggalPendek("2026-11-03")).toBe("3 Nov 2026"); expect(tanggalPendek("rusak")).toBe("rusak"); expect(tanggalPendek(null)).toBe("");
    const p = (x: Partial<PromoPopupRow>): PromoPopupRow => ({ id: "i", name: "n", ...x });
    expect(promoChip(p({ rule: { discount_mode: "quantity_pool" } })).label).toBe("Harga paket");
    expect(promoChip(p({ rule: { discount_mode: "package_total" } })).label).toBe("Harga paket");
    expect(promoChip(p({ promo_type: "bundling", rule: { discount_mode: "syarat_hasil" } })).label).toBe("Bundling");
    expect(promoChip(p({ discount_type: "percent", discount_value: "100.00" })).label).toBe("Gratis");
    expect(promoChip(p({ discount_type: "percent", discount_value: "50.00" })).label).toBe("Potongan %");
    expect(promoChip(p({ discount_type: "nominal", discount_value: 1000 })).label).toBe("Potongan Rp");
    expect(promoChip(p({})).label).toBe("Promo");
    expect(promoAturan(p({ discount_type: "percent", discount_value: "50.00", min_qty: "2.0000", kelipatan: true }))).toBe("Diskon 50% · min. 2 pcs, berlaku kelipatan");
    expect(promoAturan(p({ discount_type: "nominal", discount_value: 7000 }))).toBe("Potongan Rp7.000");
    expect(promoBerlaku(p({ valid_from: "2026-11-03" }))).toBe("Berlaku 3 Nov 2026 s/d tanpa batas");
    expect(promoCabang(p({ branch_ids: [] }))).toBeNull(); expect(promoCabang(p({ branch_ids: ["a", "b"] }))).toBe("2 cabang");
    expect(cariPromo([p({ name: "Free ANC Creamy" }), p({ name: "Bolt" })], "anc").map((x) => x.name)).toEqual(["Free ANC Creamy"]);
    expect(cariPromo([p({ name: "a" })], "  ")).toHaveLength(1);
  });
});
