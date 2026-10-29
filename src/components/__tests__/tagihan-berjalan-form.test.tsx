// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions", () => ({
  tagihSekarang: vi.fn(), terimaPembayaran: vi.fn(), batalkanKwitansi: vi.fn(),
}));
import { TagihSekarangForm } from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/TagihSekarangForm";
import { TerimaPembayaranForm } from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/TerimaPembayaranForm";
import { ringkasTahap } from "@/lib/tagihan-berjalan";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const baris = (id: string, harga = 100_000) => ({
  id, nama_obat: `Obat ${id}`, qty: 1, harga, jenis: "obat",
  item_id: null, satuan: null, compound_recipe_id: null,
});
const nilai = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;

/** React melacak nilai elemen terkendali; menulis `.value` langsung tidak memicu onChange. */
function setNilai(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("Tagih sekarang", () => {
  const render = (props: Partial<React.ComponentProps<typeof TagihSekarangForm>> = {}) =>
    act(async () => root.render(
      <TagihSekarangForm recordId="rec-1" visitId="vis-1" requestKey="key-1"
        baris={[baris("p1"), baris("p2")]} ppnRate={0} minDpPercent={50}
        saldoUangMuka={0} bolehTerobos={false} {...props} />,
    ));

  it("mencentang semua baris belum ditagih secara bawaan", async () => {
    await render();
    expect(JSON.parse(nilai("ids"))).toEqual(["p1", "p2"]);
    expect(host.textContent).toContain("Rp 200.000");
  });

  it("baris yang dilepas centangnya tidak ikut ditagih tahap ini", async () => {
    await render();
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
    expect(JSON.parse(nilai("ids"))).toEqual(["p1"]);
  });

  it("menyebut kekurangan uang muka minimal sebelum kasir menekan tombol", async () => {
    await render();
    expect(host.textContent).toContain("Kurang Rp 100.000");
    expect(host.textContent).toContain("minta OWNER/ADMIN/FINANCE");
    expect(host.querySelector('input[name="dp_override_reason"]')).toBeNull();
  });

  it("peran keuangan mendapat kolom alasan penerobosan", async () => {
    await render({ bolehTerobos: true });
    expect(host.querySelector('input[name="dp_override_reason"]')).not.toBeNull();
  });

  it("uang muka pemilik yang akan terpakai menutup kekurangan minimumnya", async () => {
    await render({ saldoUangMuka: 100_000 });
    expect(host.textContent).not.toContain("Kurang Rp");
  });

  it("PPN ikut dihitung di layar dengan tarif yang sama dengan server", async () => {
    await render({ ppnRate: 11 });
    expect(host.textContent).toContain("PPN 11%");
    expect(host.textContent).toContain("Rp 222.000");
  });

  it("tanpa baris tersisa, layar menjelaskan semuanya sudah ditagih", async () => {
    await render({ baris: [] });
    expect(host.textContent).toContain("sudah masuk tagihan tahap");
    expect(host.querySelector("form")).toBeNull();
  });
});

describe("Terima pembayaran", () => {
  const tahap = ringkasTahap([
    { id: "inv-1", invoice_no: "INV-1", created_at: "2026-10-01T00:00:00Z", total: 100_000, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null },
    { id: "inv-2", invoice_no: "INV-2", created_at: "2026-10-02T00:00:00Z", total: 100_000, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null },
  ], []);
  const render = () => act(async () => root.render(
    <TerimaPembayaranForm recordId="rec-1" visitId="vis-1" requestKey="key-2" tahap={tahap} />,
  ));
  const isi = async (index: number, value: string) => act(async () => {
    setNilai(host.querySelectorAll<HTMLInputElement>('input[type="number"]')[index], value);
  });

  it("mulai dari satu metode dan hanya mengirim bagian bernominal", async () => {
    await render();
    expect(JSON.parse(nilai("parts"))).toEqual([]);
    await isi(0, "120000");
    expect(JSON.parse(nilai("parts"))).toEqual([{ method: "Tunai", amount: 120_000 }]);
  });

  it("pembayaran campuran: tombol tambah metode menambah bagian kedua", async () => {
    await render();
    await isi(0, "120000");
    await act(async () => {
      host.querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => { if (b.textContent?.includes("Tambah metode")) b.click(); });
    });
    await isi(1, "130000");
    expect(JSON.parse(nilai("parts"))).toEqual([
      { method: "Tunai", amount: 120_000 }, { method: "Transfer", amount: 130_000 },
    ]);
  });

  it("pratinjau alokasi memakai aturan tahap tertua lebih dulu dan menyebut sisanya jadi uang muka", async () => {
    await render();
    await isi(0, "250000");
    expect(host.textContent).toContain("INV-1 ← Tunai Rp 100.000");
    expect(host.textContent).toContain("INV-2 ← Tunai Rp 100.000");
    expect(host.textContent).toContain("Sisa Rp 50.000 disimpan sebagai uang muka");
  });

  it("kasir bisa mendahulukan tagihan tertentu", async () => {
    await render();
    await isi(0, "100000");
    await act(async () => setNilai(host.querySelector<HTMLSelectElement>("#tagihan-dipilih")!, "inv-2"));
    expect(nilai("invoice_id")).toBe("inv-2");
    expect(host.textContent).toContain("INV-2 ← Tunai Rp 100.000");
    expect(host.textContent).not.toContain("INV-1 ←");
  });
});
