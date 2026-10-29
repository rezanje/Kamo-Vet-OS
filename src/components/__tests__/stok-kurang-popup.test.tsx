// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { StokKurangPopup, StokKurangDariPesan } from "../StokKurangPopup";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = (node: React.ReactNode) => act(async () => root.render(node));
const dialog = () => host.querySelector("dialog")!;
const tombolUbah = () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Ubah jumlah"))!;

const baris = [
  { kunci: "itm-a", item_id: "itm-a", nama: "Obat A", butuh: 500, tersedia: 250, satuan: "pcs" },
  { kunci: "itm-b", item_id: "itm-b", nama: "Obat B", butuh: 30, tersedia: 25.5, satuan: "box" },
];

it("satu dialog berjudul 'Stok tidak cukup' dengan nama, gudang, dibutuhkan, tersedia, dan kurang", async () => {
  await render(<StokKurangPopup baris={baris} gudang="Gudang Pusat" />);
  const d = dialog();
  expect(d.getAttribute("role")).toBe("dialog");
  expect(d.getAttribute("aria-modal")).toBe("true");
  expect(d.open).toBe(true);
  expect(host.querySelector("#stok-kurang-judul")!.textContent).toContain("Stok tidak cukup");
  expect(d.getAttribute("aria-labelledby")).toBe("stok-kurang-judul");

  const header = Array.from(host.querySelectorAll("th")).map((th) => th.textContent);
  expect(header).toEqual(["Barang", "Gudang", "Dibutuhkan", "Tersedia", "Kurang"]);

  const sel = Array.from(host.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));
  expect(sel[0]).toEqual(["Obat A", "Gudang Pusat", "500 pcs", "250 pcs", "250 pcs"]);
  // Angka pecahan dilokalkan ke gaya Indonesia hanya saat ditampilkan.
  expect(sel[1]).toEqual(["Obat B", "Gudang Pusat", "30 box", "25,5 box", "4,5 box"]);
  expect(tombolUbah()).toBeTruthy();
});

it("tidak menampilkan apa pun bila tidak ada barang yang kurang", async () => {
  await render(<StokKurangPopup baris={[]} />);
  expect(host.querySelector("dialog")).toBeNull();
});

it("gudang per baris menang atas gudang bawaan layar", async () => {
  await render(<StokKurangPopup baris={[{ ...baris[0], gudang: "Gudang pengirim" }]} gudang="Gudang Pusat" />);
  expect(host.querySelector("tbody tr")!.querySelectorAll("td")[1].textContent).toBe("Gudang pengirim");
});

it("penolakan tanpa angka tampil sebagai kalimat, bukan tabel berisi tanda hubung", async () => {
  await render(<StokKurangPopup baris={[{ nama: "Obat A", butuh: null, tersedia: null }]} />);
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector("#stok-kurang-rincian")!.textContent).toContain("Obat A");
  expect(host.querySelector("#stok-kurang-rincian")!.textContent).toContain("Rincian angkanya tidak disertakan");
});

it("petunjuk khas proses dipakai bila ada, kalau tidak ada pakai petunjuk umum", async () => {
  await render(<StokKurangPopup baris={baris} petunjuk="Boleh kirim sebagian." />);
  expect(host.textContent).toContain("Boleh kirim sebagian.");
  await render(<StokKurangPopup baris={baris} />);
  expect(host.textContent).toContain("Kurangi jumlahnya sampai tidak melebihi stok yang tersedia.");
});

it("'Ubah jumlah' menutup dialog dan memindahkan fokus ke isian barang yang kurang", async () => {
  const isian = document.createElement("input");
  isian.setAttribute("data-stok-kurang", "itm-a");
  const lain = document.createElement("input");
  lain.setAttribute("data-stok-kurang", "itm-b");
  document.body.append(lain, isian);          // sengaja terbalik: pemilihan harus lewat kunci, bukan urutan
  try {
    await render(<StokKurangPopup baris={baris} />);
    await act(async () => tombolUbah().click());
    expect(host.querySelector("dialog")!.open).toBe(false);
    expect(document.activeElement).toBe(isian);
  } finally { isian.remove(); lain.remove(); }
});

it("baris tanpa kunci mencari penanda lewat nama barangnya", async () => {
  const isian = document.createElement("input");
  isian.setAttribute("data-stok-kurang", "Obat B");
  document.body.append(isian);
  try {
    await render(<StokKurangPopup baris={[{ nama: "Obat B", butuh: 30, tersedia: 25 }]} />);
    await act(async () => tombolUbah().click());
    expect(document.activeElement).toBe(isian);
  } finally { isian.remove(); }
});

it("Esc menutup dialog tanpa memaksa petugas memakai tetikus", async () => {
  await render(<StokKurangPopup baris={baris} />);
  await act(async () => { dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(host.querySelector("dialog")!.open).toBe(false);
});

it("dari pesan: penolakan stok naik jadi popup, pesan lain tidak memunculkan dialog", async () => {
  await render(<StokKurangDariPesan pesan="Stok gudang pengirim tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs. Kurangi jumlah kirim atau tunggu stok masuk" />);
  expect(host.querySelector("dialog")).toBeTruthy();
  expect(host.textContent).toContain("Obat A");
  expect(host.textContent).toContain("Gudang pengirim");
  expect(host.textContent).toContain("kirim sebagian");

  await render(<StokKurangDariPesan pesan="Hanya Kepala Gudang / Manajer yang bisa mengirim" />);
  expect(host.querySelector("dialog")).toBeNull();

  await render(<StokKurangDariPesan pesan={undefined} />);
  expect(host.querySelector("dialog")).toBeNull();
});

it("dari pesan: setelah ditutup tidak muncul lagi untuk pesan yang sama", async () => {
  const pesan = "Stok tidak cukup";
  await render(<StokKurangDariPesan pesan={pesan} />);
  await act(async () => tombolUbah().click());
  await render(<StokKurangDariPesan pesan={pesan} />);
  expect(host.querySelector("dialog")).toBeNull();
  // Penolakan berikutnya (pesan berbeda) tetap muncul.
  await render(<StokKurangDariPesan pesan="Stok tidak cukup: Obat A" />);
  expect(host.querySelector("dialog")).toBeTruthy();
});
