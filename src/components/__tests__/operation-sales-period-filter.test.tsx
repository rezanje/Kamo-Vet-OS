// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PeriodPresetSync } from "@/app/(app)/laporan/operasional-penjualan/PeriodPresetSync";

let root: Root;
let form: HTMLFormElement;
const q = <T extends Element>(selector: string) => form.querySelector(selector) as unknown as T;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  form = document.createElement("form");
  form.innerHTML = `
    <select name="preset"><option value="today">Hari ini</option><option value="mtd" selected>Bulan berjalan</option><option value="custom">Rentang custom</option></select>
    <input type="date" name="from" value="2026-11-01" />
    <input type="date" name="to" value="2026-11-03" />
    <div id="host"></div>`;
  document.body.append(form);
  root = createRoot(form.querySelector("#host")!);
  await act(async () => root.render(<PeriodPresetSync today="2026-11-03" />));
});
afterEach(async () => { await act(async () => root.unmount()); form.remove(); });

function setDate(name: "from" | "to", value: string) {
  const input = q<HTMLInputElement>(`input[name="${name}"]`);
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function setPreset(value: string) {
  const select = q<HTMLSelectElement>('select[name="preset"]');
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
const submitted = () => Object.fromEntries(new FormData(form).entries());

it("mengubah tanggal saat preset Bulan berjalan otomatis jadi Rentang custom (laporan Faizal 3 Nov)", () => {
  setDate("from", "2026-10-01");
  setDate("to", "2026-10-31");
  expect(submitted()).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-10-31" });
});

it("memilih preset Hari ini / Bulan berjalan mengisi ulang tanggal", () => {
  setDate("from", "2026-10-01");
  setPreset("today");
  expect(submitted()).toEqual({ preset: "today", from: "2026-11-03", to: "2026-11-03" });
  setPreset("mtd");
  expect(submitted()).toEqual({ preset: "mtd", from: "2026-11-01", to: "2026-11-03" });
});
