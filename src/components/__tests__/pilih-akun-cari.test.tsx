// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PilihAkunCari } from "@/components/PilihAkunCari";

// Permintaan klinik 12 Nov 2026: akun beban di Kas Keluar bisa diketik/dicari, bukan di-scroll.
const akun = [
  { code: "610001", name: "Beban Listrik" },
  { code: "610002", name: "Beban Air Galon" },
  { code: "620010", name: "Beban Parkir & Tol" },
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const input = () => host.querySelector<HTMLInputElement>("[role=combobox]")!;
const hidden = () => host.querySelector<HTMLInputElement>('input[type=hidden][name="lawan_code"]')!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
async function type(value: string) {
  await act(async () => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const render = () => act(async () => root.render(<form><PilihAkunCari name="lawan_code" akun={akun} required ariaLabel="Untuk akun (beban)" /></form>));

it("filters accounts by typed name or code and submits the chosen code", async () => {
  await render();
  expect(hidden().value).toBe("");
  expect(input().validity.valid).toBe(false);
  await type("galon");
  expect(options().map((o) => o.textContent)).toEqual(["Beban Air GalonKode: 610002"]);
  await act(async () => options()[0].click());
  expect(hidden().value).toBe("610002");
  expect(input().value).toBe("610002 · Beban Air Galon");
  expect(input().validity.valid).toBe(true);
  await type("6200");
  expect(options().map((o) => o.textContent)).toEqual(["Beban Parkir & TolKode: 620010"]);
});

it("restores a saved draft code and ignores unknown codes", async () => {
  await render();
  await act(async () => hidden().dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: "610001" })));
  expect(hidden().value).toBe("610001");
  expect(input().value).toBe("610001 · Beban Listrik");
  await act(async () => hidden().dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: "999999" })));
  expect(hidden().value).toBe("");
});

it("marks the hidden code for draft saving", async () => {
  await render();
  expect(hidden().hasAttribute("data-draft-state")).toBe(true);
});
