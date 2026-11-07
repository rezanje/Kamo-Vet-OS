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
const quote = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/app/kasir/promo-quote", () => ({ quotePromoGuard: (...args: unknown[]) => quote.fn(...args) }));
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
beforeEach(() => { quote.fn.mockReset(); quote.fn.mockResolvedValue({ excluded: [], notes: [], waiverPromoIds: [] }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });

type Props = { syaratHasil?: { defs: SyaratHasilDef[]; pickerReleased: boolean }; promoHitung?: PromoHitung[]; customer?: boolean; diskon?: number };
const CUSTOMER = { id: "cust", name: "Budi", phone: "", points: 0, tier: null, kategori: "", trx: 0, belanja: 0 };
async function render(lines: [string, number][], props: Props) {
  const cart = lines.map(([id, qty], i) => {
    const it = items.find((x) => x.id === id)!;
    return { row_key: `r${i}`, item_id: id, nama: it.name, qty, harga: it.harga, hargaNormal: it.harga, satuan: "PCS", faktor: 1, item_type: "Persediaan", target_species: "Kucing" };
  });
  sessionStorage.setItem(kasirDraftKey(context), JSON.stringify({ version: 1, savedAt: Date.now(), checkoutKey: "sh-draft", customerId: props.customer ? "cust" : "", salespersonId: "", metode: "Transfer", bayar: 0, cart, diskon: props.diskon ?? 0, diskonPct: false, poin: 0, voucher: "" }));
  await act(async () => root.render(<KasirClient branchName="Uji" items={items} customers={props.customer ? [CUSTOMER] : []} vouchers={[]} hariIni="2026-11-04" draftContext={context} shiftId="shift" promoHitung={props.promoHitung ?? [pool]} syaratHasil={props.syaratHasil} />));
  await wait();
}
// Works with real and fake timers (the HPP-check timeout / retry tests use fake ones).
const wait = (ms = 5) => act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms); else await new Promise((r) => setTimeout(r, ms)); });
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
it("'Tanpa promo' choice (picker released) removes every promo and posts promoPick=none; 'Otomatis' brings them back", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: true } });
  const tanpa = host.querySelector<HTMLInputElement>("[data-testid='promo-tanpa'] input")!;
  expect(tanpa).not.toBeNull();
  await act(async () => { tanpa.click(); });
  expect(pay()).toBe("Bayar Rp 55.000");
  expect(field("promoPick")).toBe("none");
  expect(host.querySelector("[data-testid='promo-diterapkan']")).toBeNull();
  await act(async () => { host.querySelector<HTMLInputElement>("[data-testid='promo-pilih-auto'] input")!.click(); });
  expect(pay()).toBe("Bayar Rp 52.000");
  expect(field("promoPick")).toBe("auto");
});

// ---------------------------------------------------------------------------------------------------- STAGE 3b: picker, payment info, HPP guard
const radios = () => [...host.querySelectorAll<HTMLInputElement>("[data-testid='promo-pemilih'] input[type='radio']")];
const settle = () => wait();

it("picker released: Otomatis, every promo that would save (with its saving) and Tanpa promo; the one in use is marked", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: true } });
  const panel = host.querySelector("[data-testid='promo-pemilih']")!;
  expect(radios().map((r) => r.value)).toEqual(["auto", "sh1", "bolt", "none"]);
  expect(panel.textContent).toContain("Beli 2 Bolt, ANC -Rp1000");
  expect(panel.textContent).toContain("hemat Rp 1.000");
  expect(panel.textContent).toContain("Bolt 2/6");
  expect(panel.textContent).toContain("hemat Rp 2.000");
  expect(host.querySelector("[data-testid='promo-pilih-bolt']")!.textContent).toContain("dipakai");
  expect(host.querySelector("[data-testid='promo-pilih-sh1']")!.textContent).not.toContain("dipakai");
  expect(radios().find((r) => r.checked)!.value).toBe("auto");
});
it("picker: choosing the syarat-hasil promo although the pool saves more switches the total and posts promoPick=<id> and promoExpect", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: true } });
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(field("promoExpect")).toBe("2000");
  await act(async () => { radios().find((r) => r.value === "sh1")!.click(); });
  expect(pay()).toBe("Bayar Rp 54.000");
  expect(field("promoPick")).toBe("sh1");
  expect(field("promoExpect")).toBe("1000");
  expect(host.querySelector("[data-testid='promo-diterapkan']")!.textContent).toContain("Beli 2 Bolt, ANC -Rp1000");
});
it("picker: choosing the Bolt pool although syarat-hasil saves more -> pool only", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: true } });
  expect(pay()).toBe("Bayar Rp 52.000");
  await act(async () => { radios().find((r) => r.value === "bolt")!.click(); });
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(field("promoPick")).toBe("bolt");
});
it("picker flag OFF: no radios and no switch, but the payment panel still lists the other applicable promo with its saving", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: false } });
  expect(radios()).toHaveLength(0);
  expect(host.querySelector("[data-testid='promo-tidak-dipakai']")!.textContent).toContain("hemat Rp 1.000");
});
it("HPP guard: a planned claim is checked by the server; while it runs paying is blocked, then the below-cost promo is dropped with a note and the total falls back", async () => {
  let release!: (v: unknown) => void;
  quote.fn.mockImplementation(() => new Promise((r) => { release = r; }));
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  expect(pay()).toBe("Bayar Rp 49.000"); // optimistic number (6000 reward) shown, but...
  expect(host.querySelector("[data-testid='promo-memeriksa']")).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>("button.kpos-bayar")!.disabled).toBe(true);
  await act(async () => { release({ excluded: [{ promo_id: "sh1", name: "Beli 2 Bolt, ANC -Rp6000", reason: "below_hpp" }], notes: ['Promo "Beli 2 Bolt, ANC -Rp6000" tidak diterapkan: hadiah di bawah modal.'], waiverPromoIds: [] }); await new Promise((r) => setTimeout(r, 5)); });
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(host.querySelector("[data-testid='promo-memeriksa']")).toBeNull();
  expect(host.querySelector("[data-testid='promo-catatan']")!.textContent).toContain("hadiah di bawah modal");
  expect(host.querySelector<HTMLButtonElement>("button.kpos-bayar")!.disabled).toBe(false);
  expect(field("promoExpect")).toBe("2000");
  expect(quote.fn).toHaveBeenCalledTimes(1);
});
const payBtn = () => host.querySelector<HTMLButtonElement>("button.kpos-bayar")!;
const gagal = () => host.querySelector("[data-testid='promo-gagal']");
it("L3: picker OFF - if the advisory HPP check fails the cashier is NOT stuck: automatic retry once, then paying stays possible and the message is correct (no 'Tanpa promo' that is not offered)", async () => {
  vi.useFakeTimers();
  quote.fn.mockRejectedValue(new Error("boom"));
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  await wait(10);
  expect(radios()).toHaveLength(0);
  expect(gagal()!.textContent).toContain("Cek harga promo gagal, coba lagi atau muat ulang kasir");
  expect(gagal()!.textContent).not.toContain("Tanpa promo");
  expect(payBtn().disabled).toBe(false);
  await wait(5000); // automatic retry fires (still failing)
  expect(quote.fn).toHaveBeenCalledTimes(2);
  await wait(20000); // ... and only once
  expect(quote.fn).toHaveBeenCalledTimes(2);
  expect(gagal()!.textContent).not.toContain("Tanpa promo");
  expect(payBtn().disabled).toBe(false);
});
it("L3: the automatic retry succeeds -> the message disappears and the server's drop/note is applied", async () => {
  vi.useFakeTimers();
  quote.fn.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ excluded: [{ promo_id: "sh1", name: "Beli 2 Bolt, ANC -Rp6000", reason: "below_hpp" }], notes: ["Promo di bawah modal."], waiverPromoIds: [] });
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  await wait(10);
  expect(gagal()).not.toBeNull();
  await wait(5000);
  expect(gagal()).toBeNull();
  expect(quote.fn).toHaveBeenCalledTimes(2);
  expect(pay()).toBe("Bayar Rp 53.000");
  expect(host.querySelector("[data-testid='promo-catatan']")!.textContent).toContain("di bawah modal");
});
it("L3: a manual 'Coba lagi' button re-runs the check after the automatic retry gave up", async () => {
  vi.useFakeTimers();
  quote.fn.mockRejectedValue(new Error("boom"));
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  await wait(30000);
  expect(quote.fn).toHaveBeenCalledTimes(2);
  quote.fn.mockResolvedValue({ excluded: [], notes: [], waiverPromoIds: [] });
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-testid='promo-coba-lagi']")!.click(); });
  await wait(10);
  expect(quote.fn).toHaveBeenCalledTimes(3);
  expect(gagal()).toBeNull();
  expect(pay()).toBe("Bayar Rp 49.000");
});
it("L3: a check that never answers blocks paying only for a very short time, then times out into the same non-blocking failure state", async () => {
  vi.useFakeTimers();
  quote.fn.mockImplementation(() => new Promise(() => {}));
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  expect(host.querySelector("[data-testid='promo-memeriksa']")).not.toBeNull();
  expect(payBtn().disabled).toBe(true);
  await wait(1500);
  expect(payBtn().disabled).toBe(true); // still genuinely pending
  await wait(2500);
  expect(host.querySelector("[data-testid='promo-memeriksa']")).toBeNull();
  expect(gagal()!.textContent).toContain("Cek harga promo gagal");
  expect(payBtn().disabled).toBe(false);
});
it("L3: picker ON - same: a failed advisory check never blocks paying (the server drops below-cost promos itself)", async () => {
  vi.useFakeTimers();
  quote.fn.mockRejectedValue(new Error("boom"));
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: true }, customer: true });
  await wait(10);
  await act(async () => { host.querySelector<HTMLInputElement>("[data-testid='promo-pilih-sh1'] input")!.click(); });
  await wait(10);
  expect(gagal()!.textContent).toContain("Cek harga promo gagal");
  expect(payBtn().disabled).toBe(false);
});
it("HPP guard: no claim planned (pool wins) -> the server check is never called", async () => {
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(1000)], pickerReleased: true } });
  await settle();
  expect(quote.fn).not.toHaveBeenCalled();
});
it("HPP guard: no claim planned (Bolt-only cart) -> the server check is never called", async () => {
  await render([["a", 1], ["b", 1]], { syaratHasil: { defs: [sh(3000)], pickerReleased: true } });
  await settle();
  expect(quote.fn).not.toHaveBeenCalled();
});
it("waiver sale with a receipt-level discount: the screen says so and paying is blocked (same rule the DB enforces)", async () => {
  quote.fn.mockResolvedValue({ excluded: [], notes: [], waiverPromoIds: ["sh1"] });
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true, diskon: 1000 });
  await settle();
  expect(host.querySelector("[data-testid='promo-waiver-gabung']")!.textContent).toMatch(/voucher.*poin.*diskon total/i);
  expect(host.querySelector<HTMLButtonElement>("button.kpos-bayar")!.disabled).toBe(true);
});
it("waiver sale without receipt-level discount: payable", async () => {
  quote.fn.mockResolvedValue({ excluded: [], notes: [], waiverPromoIds: ["sh1"] });
  await render([["a", 2], ["c", 1]], { syaratHasil: { defs: [sh(6000)], pickerReleased: false }, customer: true });
  await settle();
  expect(host.querySelector("[data-testid='promo-waiver-gabung']")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>("button.kpos-bayar")!.disabled).toBe(false);
});
