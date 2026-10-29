// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { QtyInput } from "../QtyInput";

// Andri 29 Okt: qty di klinik tidak bisa dikosongkan — selalu diawali 0, jadi
// mengetik "2" menghasilkan "02" (atau "12" di layar yang memaksa minimal 1).
let host: HTMLDivElement; let root: Root; let last = 0;
function Harness({ awal = 1 }: { awal?: number }) {
  const [qty, setQty] = useState(awal);
  return <QtyInput aria-label="qty" min={1} value={qty} onValue={(n) => { setQty(n); last = n; }} />;
}
const input = () => host.querySelector<HTMLInputElement>('input[aria-label="qty"]')!;
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
async function ketik(v: string) { await act(async () => { setter.call(input(), v); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
async function blur() { await act(async () => { input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); }

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("isian boleh kosong sementara, lalu mengetik 2 menjadi 2 (bukan 02/12)", async () => {
  last = 1; await act(async () => root.render(<Harness />));
  await ketik("");
  expect(input().value).toBe("");
  expect(last).toBe(1); // nilai lama dipertahankan selama kosong
  await ketik("2");
  expect(input().value).toBe("2");
  expect(last).toBe(2);
});

it("dibiarkan kosong lalu ditinggal: kembali ke nilai terakhir yang sah", async () => {
  last = 3; await act(async () => root.render(<Harness awal={3} />));
  await ketik("");
  await blur();
  expect(input().value).toBe("3");
  expect(last).toBe(3);
});

it("angka di bawah minimum tidak dikirim", async () => {
  last = 4; await act(async () => root.render(<Harness awal={4} />));
  await ketik("0");
  expect(last).toBe(4);
  await blur();
  expect(input().value).toBe("4");
});

it("ikut berubah bila nilai dari luar berubah", async () => {
  function Luar() { const [q, setQ] = useState(1); return <><button onClick={() => setQ(5)}>x</button><QtyInput aria-label="qty" min={1} value={q} onValue={setQ} /></>; }
  await act(async () => root.render(<Luar />));
  await act(async () => host.querySelector("button")!.click());
  expect(input().value).toBe("5");
});
