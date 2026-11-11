// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ save: vi.fn(), recover: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pos/expense/actions", () => ({ periksaExpense: fixture.recover }));

import { ExpenseForm } from "@/components/pengeluaran/ExpenseForm";

let host: HTMLDivElement, root: Root;
const STALE = { ok: false, outcome: "rejected", code: "stale_request_key", message: "Kunci simpan lama sudah dipakai. Pengeluaran ini BELUM tersimpan. Tekan Simpan sekali lagi." };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState(null, "", "/");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const keyOf = () => host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
async function mount() {
  await act(async () => root.render(<ExpenseForm userId="u1" scope="clinic-expense:s1" action={fixture.save}>
    <input name="jumlah" defaultValue="" /><button type="submit">Simpan</button>
  </ExpenseForm>));
}
async function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[name="jumlah"]')!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

it("kunci basi ditolak server: kunci diganti, isian tetap, pesan jelas, tanpa 'belum terkonfirmasi'", async () => {
  fixture.save.mockResolvedValueOnce(STALE);
  await mount(); await type("80000");
  const before = keyOf();
  await submit();
  expect(keyOf()).not.toBe(before);
  expect(sessionStorage.getItem("vetos:expense-request:v1:u1:clinic-expense:s1")).toBe(keyOf());
  expect(sessionStorage.getItem("vetos:expense-attempt:v1:u1:clinic-expense:s1")).toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("80000");
  expect(host.textContent).toContain("BELUM tersimpan");
  expect(host.textContent).not.toContain("Respons simpan belum terkonfirmasi");
});

it("percobaan berikutnya memakai kunci baru dan tidak ditolak lagi", async () => {
  fixture.save.mockResolvedValueOnce(STALE).mockResolvedValueOnce(undefined);
  await mount(); await type("80000");
  const before = keyOf();
  await submit();
  await submit();
  const keys = fixture.save.mock.calls.map(call => (call[0] as FormData).get("request_key"));
  expect(keys[0]).toBe(before);
  expect(keys[1]).not.toBe(before);
  expect(keys[1]).toBe(keyOf());
});

it("kunci yang sama tetap dipakai saat respons hilang (jangan menggandakan transaksi)", async () => {
  fixture.save.mockRejectedValueOnce(Error("network"));
  await mount(); await type("80000");
  const before = keyOf();
  await submit();
  expect(keyOf()).toBe(before);
  expect(host.textContent).toContain("Respons simpan belum terkonfirmasi");
});
