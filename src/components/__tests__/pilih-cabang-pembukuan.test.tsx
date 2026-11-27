// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/faktur/actions", () => ({ bayarFaktur: vi.fn() }));
const access = vi.hoisted(() => ({ allowed: null as string[] | null }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => access.allowed }));
import { PurchasePaymentForm } from "@/components/PurchasePaymentForm";
import { PilihCabangPembukuan } from "@/components/PilihCabangPembukuan";
import { TEKS_CABANG_PEMBUKUAN, bacaCabangPembukuan, muatCabangPembukuan } from "@/lib/cabang-pembukuan";

const DC = { id: "92d0ea42-cb6c-4c9d-b049-b6c6cbb19031", name: "DC" };
const CMGG = { id: "130cc8e2-e613-4f54-8aef-49cdb2646c6a", name: "Kamo Petshop Cimanggu" };
let root: Root; let host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); access.allowed = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const form = (props: Partial<React.ComponentProps<typeof PurchasePaymentForm>> = {}) => <PurchasePaymentForm userId="finance" invoiceId="inv-1" remaining={500000} today="2026-11-27" accounts={[]} advances={[]} {...props} />;

describe("Cabang pembukuan pada form bayar faktur", () => {
  it("defaults to the invoice branch, lists every branch the user may use, and explains it in one plain sentence", async () => {
    await act(async () => root.render(form({ branches: [CMGG, DC], invoiceBranchId: DC.id })));
    const select = host.querySelector<HTMLSelectElement>('select[name="journal_branch_id"]')!;
    expect(select.value).toBe(DC.id);
    expect([...select.options].map((o) => o.textContent)).toEqual(["Kamo Petshop Cimanggu", "DC"]);
    expect(host.querySelector("label[for=\"journal-branch-inv-1\"]")?.textContent).toBe("Cabang pembukuan");
    expect(host.textContent).toContain("Jurnal pembayaran dicatat di cabang ini. Hutang tetap milik cabang faktur.");
    expect(TEKS_CABANG_PEMBUKUAN).toBe("Jurnal pembayaran dicatat di cabang ini. Hutang tetap milik cabang faktur.");
  });
  it("is part of the submitted form so the action receives the chosen branch", async () => {
    await act(async () => root.render(form({ branches: [CMGG, DC], invoiceBranchId: DC.id })));
    const select = host.querySelector<HTMLSelectElement>('select[name="journal_branch_id"]')!;
    await act(async () => { select.value = CMGG.id; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(new FormData(host.querySelector("form")!).get("journal_branch_id")).toBe(CMGG.id);
  });
  it("falls back to an explicit 'Cabang faktur' (empty value) when the invoice branch is unknown or not selectable", async () => {
    await act(async () => root.render(form({ branches: [CMGG, DC], invoiceBranchId: null })));
    const select = host.querySelector<HTMLSelectElement>('select[name="journal_branch_id"]')!;
    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe("Cabang faktur");
    expect(bacaCabangPembukuan(new FormData(host.querySelector("form")!).get("journal_branch_id"))).toBeNull();
  });
  it("stays hidden when the user has no choice (one branch or none), so the old form is unchanged", async () => {
    await act(async () => root.render(form({ branches: [DC], invoiceBranchId: DC.id })));
    expect(host.querySelector('select[name="journal_branch_id"]')).toBeNull();
    await act(async () => root.render(form()));
    expect(host.querySelector('select[name="journal_branch_id"]')).toBeNull();
    expect(host.textContent).not.toContain("Cabang pembukuan");
  });
  it("renders on its own for the payment-order form", async () => {
    await act(async () => root.render(<form><PilihCabangPembukuan cabang={[DC, CMGG]} awal={CMGG.id} id="order-1" width={150} /></form>));
    expect(host.querySelector<HTMLSelectElement>("select#order-1")!.value).toBe(CMGG.id);
  });
});

describe("muatCabangPembukuan", () => {
  const client = (data: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data, error }) }) }) }) });
  it("returns all active branches for an all-branch role", async () => {
    expect(await muatCabangPembukuan(client([DC, CMGG]), "u")).toEqual([DC, CMGG]);
  });
  it("returns only the branches a placed user may access", async () => {
    access.allowed = [CMGG.id];
    expect(await muatCabangPembukuan(client([DC, CMGG]), "u")).toEqual([CMGG]);
  });
  it("hides the selector (empty list) when the read fails or there is no user", async () => {
    expect(await muatCabangPembukuan(client(null, { message: "x" }), "u")).toEqual([]);
    expect(await muatCabangPembukuan(client([DC, CMGG]), "")).toEqual([]);
  });
});
