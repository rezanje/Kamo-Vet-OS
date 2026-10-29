// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/hris/karyawan/actions", () => ({ simpanPenugasanCabang: vi.fn() }));
import { PenugasanCabangForm } from "@/app/(app)/hris/karyawan/PenugasanCabangForm";

let host: HTMLDivElement;
let root: Root;

const employees = [
  { id: "emp-1", nama: "Ré Nawangsari", jabatan: "Dokter Hewan Poli", branch_id: "b1", branchName: "Kamo Cimanggu" },
  { id: "emp-2", nama: "Budi Santoso", jabatan: "Staff Toko - Groomer", branch_id: "b2", branchName: "Kamo Bogor" },
];
const branches = [{ id: "b1", name: "Kamo Cimanggu" }, { id: "b2", name: "Kamo Bogor" }, { id: "b3", name: "Kamo Depok" }];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = () => act(async () => root.render(<PenugasanCabangForm employees={employees} branches={branches} today="2026-10-29" />));
const kotakCari = () => host.querySelector<HTMLInputElement>("input[role=combobox]")!;
const pilihKaryawan = async (kata: string) => {
  const input = kotakCari();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, kata);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (document.querySelector<HTMLButtonElement>('button[role="option"]')!).click());
};

it("tetap mengirim id karyawan sebagai employee_id setelah dipilih lewat ketikan", async () => {
  await render();
  const form = host.querySelector("form")!;
  expect(new FormData(form).get("employee_id")).toBe("");
  await pilihKaryawan("santoso");
  const data = new FormData(form);
  expect(data.get("employee_id")).toBe("emp-2");
  expect(data.get("role")).toBe("SECONDARY");
  expect(data.get("effective_date")).toBe("2026-10-29");
});

it("membuka pilihan cabang tambahan dan mengirimnya sebagai branch_ids", async () => {
  await render();
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await pilihKaryawan("nawang");
  expect(host.querySelector("fieldset")!.disabled).toBe(false);
  const depok = host.querySelector<HTMLInputElement>('input[aria-label="Kamo Depok"]')!;
  await act(async () => depok.click());
  const data = new FormData(host.querySelector("form")!);
  expect(data.get("employee_id")).toBe("emp-1");
  expect(data.getAll("branch_ids")).toEqual(["b3"]);
  // Cabang utama karyawan tidak boleh ikut dipilih sebagai cabang tambahan.
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Kamo Cimanggu"]')!.disabled).toBe(true);
});

it("mengosongkan cabang terpilih saat karyawan diganti", async () => {
  await render();
  await pilihKaryawan("nawang");
  await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Kamo Depok"]')!.click());
  expect(new FormData(host.querySelector("form")!).getAll("branch_ids")).toEqual(["b3"]);
  await pilihKaryawan("budi");
  const data = new FormData(host.querySelector("form")!);
  expect(data.get("employee_id")).toBe("emp-2");
  expect(data.getAll("branch_ids")).toEqual([]);
});
