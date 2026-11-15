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

const staff = [{ id: "agung", nama: "Agung", jabatan: "Groomer" }, { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter Hewan" }];
const render = async (awal?: { poli: string; keluhan: string }) => act(async () => root.render(
  <DraftUserProvider userId="user-a"><RegistrasiForm branches={[{ id: "b", name: "Cabang A" }]} dokter={staff}
    awal={awal ? { bookingId: "bk", phone: "0812", nama: "Wita", branchId: "b", namaHewan: "Belang", jenisHewan: "Kucing", ...awal } : undefined} /></DraftUserProvider>));
async function setKeluhan(v: string) {
  const el = container.querySelector<HTMLTextAreaElement>("textarea[placeholder^=\"Batuk\"]")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const notice = () => container.querySelector("[data-testid=\"notice-grooming\"]");
const poli = () => container.querySelector<HTMLSelectElement>("select[name=\"poli\"]")!;
const payload = () => ({ poli: poli().value, pets: container.querySelector<HTMLInputElement>("input[name=\"pets\"]")!.value, doctor: container.querySelector<HTMLSelectElement>("select[name=\"doctor_id\"]")!.value });

it("keluhan 'Grooming' di Poli Umum menampilkan pengingat; tombol memindah poli ke Grooming", async () => {
  await render(); expect(notice()).toBeNull();
  await setKeluhan("Grooming");
  expect(notice()?.textContent).toContain("Ini kunjungan grooming? Pilih Poli Grooming dan isi Groomer.");
  expect(poli().value).toBe("Poli Umum");
  await act(async () => notice()!.querySelector("button")!.click());
  expect(poli().value).toBe("Grooming");
  expect(notice()).toBeNull();
  expect(container.textContent).toContain("Groomer");
  const picker = container.querySelector<HTMLSelectElement>("select[name=\"doctor_id\"]")!;
  expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Agung")]));
  expect(Array.from(picker.options).some((o) => (o.textContent ?? "").includes("ILHAM"))).toBe(false);
});
it("pencarian tidak peka huruf besar/kecil dan membaca keluhan hewan mana pun", async () => {
  await render(); await setKeluhan("mau GrOoMiNg kuku");
  expect(notice()).not.toBeNull();
  await act(async () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Tambah hewan"))!.click());
  expect(notice()).not.toBeNull(); // hewan pertama masih berkeluhan grooming, poli berlaku untuk semua hewan
});
it("Poli Grooming dipilih langsung: tanpa pengingat", async () => {
  await render({ poli: "Grooming", keluhan: "Grooming" });
  expect(poli().value).toBe("Grooming"); expect(notice()).toBeNull();
});
it("tanpa kata grooming (termasuk 'groomer' saja dan keluhan lain): tanpa pengingat", async () => {
  await render(); await setKeluhan("Batuk, nafsu makan turun"); expect(notice()).toBeNull();
  await setKeluhan("tanya groomer"); expect(notice()).toBeNull();
});
it("booking Poli Umum berkeluhan grooming: pengingat muncul dari isian awal", async () => {
  await render({ poli: "Poli Umum", keluhan: "grooming" }); expect(notice()).not.toBeNull();
});
it("pengingat tidak mengubah isi kiriman: poli/dokter/hewan sama, kecuali bila tombol ditekan (poli saja)", async () => {
  await render(); await setKeluhan("Grooming");
  const sebelum = payload();
  await act(async () => notice()!.querySelector("button")!.click());
  const sesudah = payload();
  expect(sesudah.pets).toBe(sebelum.pets); expect(sesudah.doctor).toBe(sebelum.doctor);
  expect(sebelum.poli).toBe("Poli Umum"); expect(sesudah.poli).toBe("Grooming");
  expect(container.querySelector("select[name=\"doctor_id\"]")!.hasAttribute("required")).toBe(false);
  expect(container.querySelector("[data-testid=\"notice-grooming\"] button")).toBeNull();
});
