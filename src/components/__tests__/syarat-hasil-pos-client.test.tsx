// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POS_DRAFT_KEY } from "@/lib/pos-draft";
import type { PromoHitung } from "@/lib/promo-hitung";
import type { SyaratHasilDef } from "@/lib/promo-syarat-hasil";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/pos/transaksi/actions", () => ({ checkoutSale: vi.fn() }));
import { PosClient } from "@/app/(app)/pos/transaksi/PosClient";

// STAGE 4: the back-office screen shows the same promo result the server charges (same composer, no picker on this screen).
const pcs = (price: number) => [{ unit: "PCS", factor: 1, sell_price: price, buy_price: 1000 }];
const items = [
  { id: "a", name: "Bolt Ikan", item_type: "Persediaan", sell_price: 20000, target_species: "Kucing", units: pcs(20000) },
  { id: "c", name: "ANC Creamy Stick", item_type: "Persediaan", sell_price: 15000, target_species: "Kucing", units: pcs(15000) },
];
const pool: PromoHitung = { id: "bolt", name: "Bolt 2/6", itemIds: ["a"], discountMode: "quantity_pool", quantityPool: { version: 1, unit: "PCS", normal_price: 20000, tiers: [{ qty: 6, total: 110000 }, { qty: 2, total: 38000 }] }, minQty: null, maxQty: null, kelipatan: true, autoApply: true, discountType: null, discountValue: null };
const sh = (value: number): SyaratHasilDef => ({ id: "sh1", name: "Beli 2 Bolt, ANC -Rp" + value, repeat: true, syarat: [{ kind: "qty", min: 2, items: [{ item_id: "a", unit: "PCS" }] }], hasil: { items: [{ item_id: "c", unit: "PCS" }], discount: { type: "nominal", value } } });
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });

async function render(syaratHasilPerCabang?: Record<string, SyaratHasilDef[]>) {
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), customerId: "", salespersonId: "", metode: "Tunai", bayar: 0, branchId: "branch", petId: "", discount: 0,
    cart: [{ row_key: "r0", item_id: "a", nama: "Bolt Ikan", qty: 2, harga: 20000, target_species: "Kucing", satuan: "PCS", faktor: 1, item_type: "Persediaan" }, { row_key: "r1", item_id: "c", nama: "ANC Creamy Stick", qty: 1, harga: 15000, target_species: "Kucing", satuan: "PCS", faktor: 1, item_type: "Persediaan" }] }));
  await act(async () => root.render(<PosClient items={items as never} branches={[{ id: "branch", code: "BR", name: "Cabang" }] as never} promoPerCabang={{ branch: [pool] }} syaratHasilPerCabang={syaratHasilPerCabang} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}
const text = () => host.textContent ?? "";

it("no syaratHasilPerCabang (flags OFF): the legacy screen - pool promo 2000, no bundling panel", async () => {
  await render(undefined);
  expect(text()).toContain("-Rp 2.000");
  expect(host.querySelector("[data-testid='pos-promo-diterapkan']")).toBeNull();
});
it("syarat-hasil saves more than the pool: the screen shows the same promo the server will charge, with its name", async () => {
  await render({ branch: [sh(3000)] });
  expect(text()).toContain("-Rp 3.000");
  const panel = host.querySelector("[data-testid='pos-promo-diterapkan']")!;
  expect(panel.textContent).toContain("Beli 2 Bolt, ANC -Rp3000");
  expect(panel.textContent).toContain("HPP"); // the server drops a reward that would sell below cost
});
it("definitions of ANOTHER branch are not used for the selected branch", async () => {
  await render({ other: [sh(3000)] });
  expect(text()).toContain("-Rp 2.000");
  expect(host.querySelector("[data-testid='pos-promo-diterapkan']")).toBeNull();
});
it("the pool saves more: legacy result stays and no bundling panel is shown", async () => {
  await render({ branch: [sh(1000)] });
  expect(text()).toContain("-Rp 2.000");
  expect(host.querySelector("[data-testid='pos-promo-diterapkan']")).toBeNull();
});
