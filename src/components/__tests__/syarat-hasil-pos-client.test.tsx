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

// STAGE 4: the back-office screen shows the same promo result the server charges (same composer). POS picker: Otomatis / each promo / Tanpa promo, only while the promo_picker flag is released for the branch.
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

async function render(syaratHasilPerCabang?: Record<string, SyaratHasilDef[]>, extra: Record<string, unknown> = {}, qtyAnc = 1) {
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), customerId: "", salespersonId: "", metode: "Tunai", bayar: 0, branchId: "branch", petId: "", discount: 0,
    cart: [{ row_key: "r0", item_id: "a", nama: "Bolt Ikan", qty: 2, harga: 20000, target_species: "Kucing", satuan: "PCS", faktor: 1, item_type: "Persediaan" }, { row_key: "r1", item_id: "c", nama: "ANC Creamy Stick", qty: qtyAnc, harga: 15000, target_species: "Kucing", satuan: "PCS", faktor: 1, item_type: "Persediaan" }] }));
  await act(async () => root.render(<PosClient items={items as never} branches={[{ id: "branch", code: "BR", name: "Cabang" }] as never} promoPerCabang={{ branch: [pool] }} syaratHasilPerCabang={syaratHasilPerCabang} {...extra} />));
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

// ---------------------------------------------------------------------------------------------------- POS picker
const PICKER = { promoPickerPerCabang: { branch: true } };
const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[type='hidden'][name='${name}']`)?.value ?? null;
const choose = async (testid: string) => { await act(async () => { host.querySelector<HTMLInputElement>(`[data-testid='${testid}'] input`)!.click(); }); };
const total = () => host.textContent!.match(/Tagihan barang(Rp [\d.]+)/)?.[1];

it("flags OFF / picker flag OFF: no picker, and no promoPick/promoExpect field at all (the form is what it was)", async () => {
  await render(undefined);
  expect(host.querySelector("[data-testid='pos-promo-pemilih']")).toBeNull();
  expect(hidden("promoPick")).toBeNull(); expect(hidden("promoExpect")).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host);
  await render({ branch: [sh(3000)] }); // syarat_hasil released, promo_picker NOT released for the branch
  expect(host.querySelector("[data-testid='pos-promo-pemilih']")).toBeNull();
  expect(hidden("promoPick")).toBeNull(); expect(hidden("promoExpect")).toBeNull();
});
it("picker flag ON for the branch: Otomatis, each applicable promo with its saving ('dipakai' on the winner) and Tanpa promo; hidden promoPick=auto, promoExpect=server-comparable saving", async () => {
  await render({ branch: [sh(3000)] }, PICKER);
  const panel = host.querySelector("[data-testid='pos-promo-pemilih']")!;
  expect(panel).not.toBeNull();
  expect(panel.textContent).toContain("Otomatis");
  expect(host.querySelector("[data-testid='pos-promo-pilih-sh1']")!.textContent).toContain("hemat Rp 3.000 (dipakai)");
  expect(host.querySelector("[data-testid='pos-promo-pilih-bolt']")!.textContent).toMatch(/Bolt 2\/6 · hemat Rp 2\.000$/);
  expect(host.querySelector("[data-testid='pos-promo-tanpa']")!.textContent).toContain("Tanpa promo");
  expect(hidden("promoPick")).toBe("auto"); expect(hidden("promoExpect")).toBe("3000");
});
it("Tanpa promo: every promo (bundle AND Bolt pool) is gone from the screen, the total is the full price, the note says the cashier cancelled, hidden promoPick=none, promoExpect=0", async () => {
  await render({ branch: [sh(3000)] }, PICKER);
  expect(total()).toBe("Rp 52.000");
  await choose("pos-promo-tanpa");
  expect(total()).toBe("Rp 55.000");
  expect(host.textContent).not.toContain("Promo otomatis");
  const note = host.querySelector("[data-testid='pos-promo-dibatalkan']")!;
  expect(note.textContent).toContain("Promo dibatalkan oleh kasir");
  expect(hidden("promoPick")).toBe("none"); expect(hidden("promoExpect")).toBe("0");
  await choose("pos-promo-pilih-auto");
  expect(host.querySelector("[data-testid='pos-promo-dibatalkan']")).toBeNull();
  expect(total()).toBe("Rp 52.000");
  expect(hidden("promoPick")).toBe("auto"); expect(hidden("promoExpect")).toBe("3000");
});
it("picking the Bolt pool alone while the bundle wins: total 53.000, promoPick=bolt, promoExpect=2000; no cancellation note", async () => {
  await render({ branch: [sh(3000)] }, PICKER);
  await choose("pos-promo-pilih-bolt");
  expect(total()).toBe("Rp 53.000");
  expect(hidden("promoPick")).toBe("bolt"); expect(hidden("promoExpect")).toBe("2000");
  expect(host.querySelector("[data-testid='pos-promo-dibatalkan']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-promo-pilihan-kasir']")!.textContent).toContain("Bolt 2/6");
});
it("picking the bundle that loses the automatic comparison: applied alone (exclusive), promoPick=sh1", async () => {
  await render({ branch: [sh(1000)] }, PICKER);
  expect(total()).toBe("Rp 53.000");
  await choose("pos-promo-pilih-sh1");
  expect(total()).toBe("Rp 54.000");
  expect(hidden("promoPick")).toBe("sh1"); expect(hidden("promoExpect")).toBe("1000");
});
it("a pick that stops applying (the ANC line is removed) falls back to Otomatis with a visible note - never silently", async () => {
  await render({ branch: [sh(3000)] }, PICKER);
  await choose("pos-promo-pilih-sh1");
  await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-label='Hapus ANC Creamy Stick']")!.click(); });
  expect(hidden("promoPick")).toBe("auto");
  expect(host.querySelector("[data-testid='pos-promo-pilihan-hilang']")!.textContent).toContain("tidak berlaku lagi");
});
it("the picker follows the SELECTED branch: a branch without the picker flag shows none", async () => {
  await render({ branch: [sh(3000)] }, { promoPickerPerCabang: { other: true } });
  expect(host.querySelector("[data-testid='pos-promo-pemilih']")).toBeNull();
  expect(hidden("promoPick")).toBeNull();
});
it("a picker flag without definitions for the branch shows nothing (Bolt-only branch: no way to cancel Bolt, same as the cashier)", async () => {
  await render({ other: [sh(3000)] }, PICKER);
  expect(host.querySelector("[data-testid='pos-promo-pemilih']")).toBeNull();
  expect(hidden("promoPick")).toBeNull();
});
it("a campaign code that forces a promo switches the picker off and sends no pick (the server would refuse one)", async () => {
  await render({ branch: [sh(3000)] }, { ...PICKER, kodeKampanye: [{ code: "BOLT26", voucher_code: null, promo_id: "bolt", is_active: true }] });
  await choose("pos-promo-tanpa");
  expect(hidden("promoPick")).toBe("none");
  const input = host.querySelector<HTMLInputElement>("input[aria-label='Kode kampanye']")!;
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "BOLT26"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("[data-testid='pos-promo-pemilih']")).toBeNull();
  expect(hidden("promoPick")).toBeNull(); expect(hidden("promoExpect")).toBeNull();
});
it("the screen keeps saying the server drops a below-cost reward (the POS screen has no cost) - no invented HPP number", async () => {
  await render({ branch: [sh(3000)] }, PICKER);
  expect(host.querySelector("[data-testid='pos-promo-diterapkan']")!.textContent).toContain("HPP");
  expect(host.textContent).not.toMatch(/HPP\s*Rp/);
});
it("a promo that loses the automatic comparison is still offered in the picker with its own saving", async () => {
  await render({ branch: [sh(1000)] }, PICKER, 1); // pool wins (2000 > 1000): the bundle is an alternative, listed in the picker; no 'tidak dipakai' list when the bundle never made it
  expect(host.querySelector("[data-testid='pos-promo-pilih-sh1']")!.textContent).toContain("hemat Rp 1.000");
});
