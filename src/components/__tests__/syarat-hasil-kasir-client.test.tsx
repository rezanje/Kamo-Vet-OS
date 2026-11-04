// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { kasirDraftKey } from "@/lib/pos-draft";
import type { PromoHitung } from "@/lib/promo-hitung";
import type { SyaratHasilDef } from "@/lib/promo-syarat-hasil";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
import { KasirClient } from "@/app/kasir/KasirClient";

const context = "sh:branch:shift";
const pcs = (price: number) => [{ unit: "PCS", factor: 1, sell_price: price, buy_price: 1000 }];
const items = [
  { id: "a", code: "a", name: "Bolt Ikan", itemType: "Persediaan" as const, harga: 20000, kategori: "Pakan", stok: 100, satuan: pcs(20000) },
  { id: "b", code: "b", name: "Bolt Donat", itemType: "Persediaan" as const, harga: 20000, kategori: "Pakan", stok: 100, satuan: pcs(20000) },
  { id: "c", code: "c", name: "ANC Creamy Stick", itemType: "Persediaan" as const, harga: 15000, kategori: "Snack", stok: 100, satuan: pcs(15000) },
];
const pool: PromoHitung = { id: "bolt", name: "Bolt 2/6", itemIds: ["a", "b"], discountMode: "quantity_pool", quantityPool: { version: 1, unit: "PCS", normal_price: 20000, tiers: [{ qty: 6, total: 110000 }, { qty: 2, total: 38000 }] }, minQty: null, maxQty: null, kelipatan: true, autoApply: true, discountType: null, discountValue: null };
const sh = (value: number): SyaratHasilDef => ({
  id: "sh1", name: "Beli 2 Bolt, ANC -Rp" + value, repeat: true,
  syarat: [{ kind: "qty", min: 2, items: [{ item_id: "a", unit: "PCS" }, { item_id: "b", unit: "PCS" }] }],
  hasil: { items: [{ item_id: "c", unit: "PCS" }], discount: { type: "nominal", value } },
});
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });

type Props = { syaratHasil?: { defs: SyaratHasilDef[]; pickerReleased: boolean }; promoHitung?: PromoHitung[] };
async function render(lines: [string, number][], props: Props) {
  const cart = lines.map(([id, qty], i) => {
    const it = items.find((x) => x.id === id)!;
    return { row_key: `r${i}`, item_id: id, nama: it.name, qty, harga: it.harga, hargaNormal: it.harga, satuan: "PCS", faktor: 1, item_type: "Persediaan", target_species: "Kucing" };
  });
  sessionStorage.setItem(kasirDraftKey(context), JSON.stringify({ version: 1, savedAt: Date.now(), checkoutKey: "sh-draft", customerId: "", salespersonId: "", metode: "Transfer", bayar: 0, cart, diskon: 0, diskonPct: false, poin: 0, voucher: "" }));
  await act(async () => root.render(<KasirClient branchName="Uji" items={items} customers={[]} vouchers={[]} hariIni="2026-11-04" draftContext={context} shiftId="shift" promoHitung={props.promoHitung ?? [pool]} syaratHasil={props.syaratHasil} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}
const pay = () => host.querySelector("button.kpos-bayar")!.textContent?.trim();
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

it("no syaratHasil prop (flags OFF): the screen is the legacy one - pool total, no promo panel, no promoPick field", async () => {
  await render([["a", 2], ["c", 1]], {});
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(host.querySelector("[data-testid='promo-diterapkan']")).toBeNull();
  expect(field("promoPick")).toBeUndefined();
});
it("syaratHasil with a cart that earns nothing from it (Bolt-only): identical total to the legacy screen", async () => {
  await render([["a", 1], ["b", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: true } });
  expect(pay()).toBe("Bayar Rp 38.000");
});
it("syarat-hasil saves more than the pool: the total, the 'Promo diterapkan' panel (name + saving) and the posted cart", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: false } });
  expect(pay()).toBe("Bayar Rp 52.000");
  const panel = host.querySelector("[data-testid='promo-diterapkan']")!;
  expect(panel.textContent).toContain("Promo diterapkan");
  expect(panel.textContent).toContain("Beli 2 Bolt, ANC -Rp3000");
  expect(panel.textContent).toContain("Rp 3.000");
  // the form still posts the ORIGINAL cart (the server recomputes and splits)
  expect(JSON.parse(field("cart")!).map((r: { item_id: string; qty: number }) => [r.item_id, r.qty])).toEqual([["a", 2], ["c", 1]]);
  expect(field("promoPick")).toBe("auto");
  expect(host.querySelector("[data-testid='promo-tanpa']")).toBeNull(); // picker flag off: no switch
});
it("the pool saves more: the legacy total stands and the cashier is told the other promo was not used", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: false } });
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(host.querySelector("[data-testid='promo-tidak-dipakai']")!.textContent).toContain("Beli 2 Bolt, ANC -Rp1000");
  expect(host.querySelector("[data-testid='promo-tidak-dipakai']")!.textContent).toContain("Rp 1.000");
});
it("'Tanpa promo' switch (picker released) removes every promo and posts promoPick=none", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: true } });
  const toggle = host.querySelector<HTMLInputElement>("[data-testid='promo-tanpa'] input")!;
  expect(toggle).not.toBeNull();
  await act(async () => { toggle.click(); });
  expect(pay()).toBe("Bayar Rp 55.000");
  expect(field("promoPick")).toBe("none");
  expect(host.querySelector("[data-testid='promo-diterapkan']")).toBeNull();
  await act(async () => { toggle.click(); });
  expect(pay()).toBe("Bayar Rp 52.000");
  expect(field("promoPick")).toBe("auto");
});
