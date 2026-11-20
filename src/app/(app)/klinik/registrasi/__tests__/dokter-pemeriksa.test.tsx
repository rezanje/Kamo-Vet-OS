// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/app/(app)/klinik/registrasi/actions", () => ({ registrasiPasien: vi.fn(), registrasiDanBayar: vi.fn(), lookupPetsByPhone: vi.fn() }));
import { DraftUserProvider } from "@/components/LocalTransactionDraft";
import { RegistrasiForm } from "@/app/(app)/klinik/registrasi/RegistrasiForm";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const staf = [
  { id: "agung", nama: "Agung", jabatan: "Staff Toko - Groomer" },
  { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter Hewan", jaga: true },
  { id: "aini", nama: "DRH. AINI", jabatan: "Dokter Hewan Poli" },
  { id: "sari", nama: "Sari", jabatan: "Paramedis" },
];
const render = async (awal?: { poli: string; keluhan: string }) => act(async () => root.render(
  <DraftUserProvider userId="user-a"><RegistrasiForm branches={[{ id: "b", name: "Cabang A" }]} dokter={staf}
    awal={awal ? { bookingId: "bk", phone: "0812", nama: "Wita", branchId: "b", namaHewan: "Belang", jenisHewan: "Kucing", ...awal } : undefined} /></DraftUserProvider>));
const poli = () => container.querySelector<HTMLSelectElement>("select[name=\"poli\"]")!;
const pemeriksa = () => container.querySelector<HTMLSelectElement>("select[name=\"pemeriksa_id\"]");
const pilihPoli = async (nilai: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(poli(), nilai);
  poli().dispatchEvent(new Event("change", { bubbles: true }));
});
const pilihPemeriksa = async (nilai: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(pemeriksa()!, nilai);
  pemeriksa()!.dispatchEvent(new Event("change", { bubbles: true }));
});
const pengingat = () => container.querySelector("[data-testid=\"notice-pemeriksa\"]");

it("Poli Umum: tidak ada isian Dokter pemeriksa (poli medis sudah punya Dokter)", async () => {
  await render();
  expect(pemeriksa()).toBeNull(); expect(pengingat()).toBeNull();
  expect(container.querySelector("select[name=\"doctor_id\"]")).not.toBeNull();
});

it("Grooming: dua isian terpisah — Groomer (doctor_id, tetap) dan Dokter pemeriksa (pemeriksa_id, baru)", async () => {
  await render({ poli: "Grooming", keluhan: "Grooming" });
  const groomer = container.querySelector<HTMLSelectElement>("select[name=\"doctor_id\"]")!;
  expect(Array.from(groomer.options).map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Agung")]));
  expect(Array.from(groomer.options).some((o) => (o.textContent ?? "").includes("ILHAM"))).toBe(false);
  // Paramedis ikut ditawarkan (di klinik merekalah yang menggroming), sesudah groomer, lengkap dengan jabatannya.
  expect(Array.from(groomer.options).map((o) => o.textContent)).toEqual(["— belum ditentukan —", "Agung · Staff Toko - Groomer", "Sari · Paramedis"]);
  expect(pemeriksa()).not.toBeNull();
  expect(container.textContent).toContain("Dokter pemeriksa");
});

it("pilihan Dokter pemeriksa hanya dokter; groomer dan paramedis tidak ditawarkan; penanda jaga tampil", async () => {
  await render({ poli: "Grooming", keluhan: "x" });
  const teks = Array.from(pemeriksa()!.options).map((o) => o.textContent ?? "");
  expect(teks.some((t) => t.includes("ILHAM") && t.includes("jaga hari ini"))).toBe(true);
  expect(teks.some((t) => t.includes("AINI"))).toBe(true);
  expect(teks.some((t) => t.includes("Agung") || t.includes("Sari"))).toBe(false);
  expect(pemeriksa()!.options[0].value).toBe(""); // bawaan: belum dipilih
  expect(pemeriksa()!.hasAttribute("required")).toBe(false); // opsional
});

it("pengingat lembut saat belum dipilih; hilang setelah dipilih; tidak memblokir (tidak required)", async () => {
  await render({ poli: "Grooming", keluhan: "x" });
  expect(pengingat()?.textContent).toContain("Dokter pemeriksa belum dipilih");
  await pilihPemeriksa("aini");
  expect(pemeriksa()!.value).toBe("aini");
  expect(pengingat()).toBeNull();
  await pilihPemeriksa("");
  expect(pengingat()).not.toBeNull();
});

it("beralih poli: isian muncul hanya di Grooming dan hilang (tidak terkirim) saat poli lain", async () => {
  await render();
  await pilihPoli("Grooming"); expect(pemeriksa()).not.toBeNull();
  await pilihPemeriksa("ilham");
  await pilihPoli("Poli Umum"); expect(pemeriksa()).toBeNull(); expect(pengingat()).toBeNull();
  await pilihPoli("Grooming"); expect(pemeriksa()!.value).toBe(""); // tidak membawa pilihan lama diam-diam
});

it("isian Dokter pemeriksa tidak mengubah isian Groomer maupun poli", async () => {
  await render({ poli: "Grooming", keluhan: "x" });
  const groomer = container.querySelector<HTMLSelectElement>("select[name=\"doctor_id\"]")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(groomer, "agung"); groomer.dispatchEvent(new Event("change", { bubbles: true })); });
  await pilihPemeriksa("ilham");
  expect(container.querySelector<HTMLSelectElement>("select[name=\"doctor_id\"]")!.value).toBe("agung");
  expect(poli().value).toBe("Grooming");
  expect(pemeriksa()!.value).toBe("ilham");
});
