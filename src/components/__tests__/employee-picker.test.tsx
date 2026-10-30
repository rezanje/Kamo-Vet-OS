// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EmployeePicker } from "@/components/EmployeePicker";

let host: HTMLDivElement;
let root: Root;

const employees = [
  { id: "emp-1", nama: "Ré Nawangsari", jabatan: "Dokter Hewan Poli", branchName: "Kamo Cimanggu" },
  { id: "emp-2", nama: "Budi Santoso", jabatan: "Staff Toko - Groomer", branchName: "Kamo Bogor" },
  { id: "emp-3", nama: "Citra Dewi", jabatan: "Paramedis", branchName: "Kamo Bogor" },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const ketik = async (input: HTMLInputElement, text: string) => {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const teksPilihan = () => [...document.querySelectorAll("[role=option]")].map((node) => node.textContent ?? "");
const tombolCari = () => host.querySelector<HTMLInputElement>('input[role=combobox]')!;
const tersembunyi = () => host.querySelector<HTMLInputElement>('input[type=hidden][name="employee_id"]')!;

it("mencocokkan potongan nama di tengah kata, bukan hanya huruf pertama", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="employee_id" />));
  await ketik(tombolCari(), "santoso");
  expect(teksPilihan()).toHaveLength(1);
  expect(teksPilihan()[0]).toContain("Budi Santoso");
});

it("mengabaikan huruf besar/kecil dan tanda diakritik", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="employee_id" />));
  await ketik(tombolCari(), "RE NAWANG");
  expect(teksPilihan()[0]).toContain("Ré Nawangsari");
});

it("ikut mencari lewat jabatan dan cabang", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="employee_id" />));
  await ketik(tombolCari(), "groomer");
  expect(teksPilihan()[0]).toContain("Budi Santoso");
  await ketik(tombolCari(), "Kamo Bogor");
  expect(teksPilihan()).toHaveLength(2);
  await ketik(tombolCari(), "cimanggu");
  expect(teksPilihan()[0]).toContain("Ré Nawangsari");
});

it("memilih dengan papan ketik dan mengirim id karyawan lewat input tersembunyi", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="employee_id" required />));
  const input = tombolCari();
  expect(input.getAttribute("role")).toBe("combobox");
  expect(input.getAttribute("aria-autocomplete")).toBe("list");
  expect(tersembunyi().value).toBe("");
  await ketik(input, "dewi");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(input.getAttribute("aria-activedescendant")).toBe(document.querySelector("[role=option]")!.id);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(tersembunyi().value).toBe("emp-3");
  expect(input.value).toBe("Citra Dewi");
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("memulai dari nilai bawaan dan menutup daftar dengan Escape", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="emp" defaultValue="emp-2" />));
  expect(host.querySelector<HTMLInputElement>('input[type=hidden][name="emp"]')!.value).toBe("emp-2");
  const input = tombolCari();
  expect(input.value).toBe("Budi Santoso");
  await act(async () => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("menolak pengiriman saat wajib diisi tetapi belum ada karyawan terpilih", async () => {
  await act(async () => root.render(<EmployeePicker employees={employees} name="employee_id" required />));
  const input = tombolCari();
  expect(input.required).toBe(true);
  expect(input.validationMessage).toBe("Pilih karyawan dari daftar.");
  await ketik(input, "budi");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(input.validationMessage).toBe("");
});
