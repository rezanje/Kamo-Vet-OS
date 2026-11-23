// @vitest-environment jsdom
// Penerimaan faktur grosir: pilihan cabang penerima uang (kas per cabang, permintaan Anisa 23 Nov 2026).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CabangPenerimaan, rekeningUntukCabang } from "@/app/(app)/penjualan/faktur/CabangPenerimaan";
import type { RekeningOpsi } from "@/components/PilihRekening";

const rekening: RekeningOpsi[] = [
  { id: "bca", nama: "Bank BCA Transaksi", coa_code: "120002", jenis: "Bank", branch_id: null },
  { id: "kas-dc", nama: "Kas DC", coa_code: "110030", jenis: "Kas", branch_id: "dc" },
  { id: "kas-cms", nama: "Kas Toko CMS", coa_code: "110006", jenis: "Kas", branch_id: "cms" },
];
const cabang = [{ id: "dc", name: "DC" }, { id: "cms", name: "CMS" }];

let root: Root, host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<form><CabangPenerimaan rekening={rekening} cabang={cabang} cabangFaktur="dc" namaCabangFaktur="DC" /></form>));
const select = (name: string) => host.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
const options = (name: string) => [...select(name).querySelectorAll("option")].map((o) => o.value);
const pilih = (name: string, value: string) => act(async () => {
  const el = select(name);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
});

it("rekening yang ditawarkan hanya yang tanpa cabang atau milik cabang itu", () => {
  expect(rekeningUntukCabang(rekening, "cms").map((r) => r.id)).toEqual(["bca", "kas-cms"]);
  expect(rekeningUntukCabang(rekening, "dc").map((r) => r.id)).toEqual(["bca", "kas-dc"]);
});

it("bawaan = cabang faktur, tanpa catatan antar cabang", async () => {
  await render();
  expect(select("branch_id").value).toBe("dc");
  expect(host.textContent).toContain("DC (cabang faktur)");
  expect(options("account_id")).toEqual(["", "kas-dc", "bca"]);
  expect(host.textContent).not.toContain("tetap lunas");
  expect(new FormData(host.querySelector("form")!).get("invoice_branch_id")).toBe("dc");
});

it("pindah cabang: rekening ikut cabang baru, rekening cabang lama dilepas, ada catatan", async () => {
  await render();
  await pilih("account_id", "kas-dc");
  expect(new FormData(host.querySelector("form")!).get("account_id")).toBe("kas-dc");
  await pilih("branch_id", "cms");
  expect(options("account_id")).toEqual(["", "kas-cms", "bca"]);
  const data = new FormData(host.querySelector("form")!);
  expect(data.get("branch_id")).toBe("cms");
  expect(data.get("account_id")).toBe("");
  expect(host.textContent).toContain("Uang dicatat masuk ke kas CMS; tagihan tetap lunas di DC.");
});

it("rekening tanpa cabang tetap terpilih saat cabang diganti", async () => {
  await render();
  await pilih("account_id", "bca");
  await pilih("branch_id", "cms");
  expect(select("account_id").value).toBe("bca");
});

it("draf yang dipulihkan mengembalikan cabang dan rekening", async () => {
  await render();
  await act(async () => { select("branch_id").dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: "cms" })); });
  await act(async () => { select("account_id").dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: "kas-cms" })); });
  expect(select("branch_id").value).toBe("cms");
  expect(select("account_id").value).toBe("kas-cms");
});

it("cabang faktur yang tidak ada di daftar pengguna tetap bisa dipilih sebagai bawaan", async () => {
  await act(async () => root.render(<form><CabangPenerimaan rekening={[]} cabang={[{ id: "cms", name: "CMS" }]} cabangFaktur="dc" namaCabangFaktur="DC" /></form>));
  expect(options("branch_id")).toEqual(["dc", "cms"]);
  expect(select("branch_id").value).toBe("dc");
  expect(host.querySelector('select[name="account_id"]')).toBeNull();
  vi.restoreAllMocks();
});
