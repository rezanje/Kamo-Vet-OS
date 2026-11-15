// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Permintaan klinik 15 Nov 2026: akun di Jurnal Umum bisa diketik/dicari, bukan di-scroll.
vi.mock("@/components/CorrectionTransactionForm", () => ({
  CorrectionTransactionForm: ({ children }: { children: (s: { ready: boolean }) => React.ReactNode }) => <form>{children({ ready: true })}</form>,
}));
vi.mock("@/app/(app)/keuangan/jurnal/actions", () => ({ jurnalManual: vi.fn(), koreksiJurnal: vi.fn(), batalkanJurnal: vi.fn() }));
import { JurnalForm } from "@/app/(app)/keuangan/jurnal/JurnalForm";
import { JurnalCorrectionForm } from "@/app/(app)/keuangan/jurnal/JurnalCorrectionForm";

const accounts = [
  { id: "a-kas", code: "110001", name: "Kas Blu BCA" },
  { id: "a-promo", code: "730001", name: "Beban Iklan dan Promosi" },
  { id: "a-kit", code: "730002", name: "Beban Marketing Kit" },
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const combo = (label: string) => host.querySelector<HTMLInputElement>(`[role=combobox][aria-label="${label}"]`)!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const lines = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="lines"]')!.value) as { account_id: string }[];
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("new manual journal: each line's account is searchable by name or code and saves the account id", async () => {
  await act(async () => root.render(<JurnalForm userId="u" accounts={accounts} branches={[]} />));
  expect(host.querySelector('select option[value="a-kas"]')).toBeNull(); // bukan dropdown panjang lagi
  await type(combo("Akun baris 1"), "promosi");
  expect(options().map((o) => o.textContent)).toEqual(["Beban Iklan dan PromosiKode: 730001"]);
  await act(async () => options()[0].click());
  await type(combo("Akun baris 2"), "1100");
  await act(async () => options()[0].click());
  expect(lines().map((l) => l.account_id)).toEqual(["a-promo", "a-kas"]);
  expect(combo("Akun baris 1").value).toBe("730001 · Beban Iklan dan Promosi");
});

it("journal correction: the account is searchable too", async () => {
  await act(async () => root.render(<JurnalCorrectionForm userId="u" entryId="e" revision={0} tanggal="2026-11-05" deskripsi="x" accounts={accounts}
    lines={[{ account_id: "a-promo", debit: 100, credit: 0 }, { account_id: "a-kas", debit: 0, credit: 100 }]} />));
  expect(combo("Akun baris 1").value).toBe("730001 · Beban Iklan dan Promosi");
  await type(combo("Akun baris 1"), "kit");
  await act(async () => options()[0].click());
  expect(lines()[0].account_id).toBe("a-kit");
});
