// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Form "Tambah tindakan / obat" rawat jalan (Andri 29 Okt, opsi B). Tabnya sama dengan
// form pemeriksaan, dan muatan yang dikirim adalah keranjang yang sama — bukan baris
// tagihan. Penautan & pencatatannya dijaga RPC, bukan layar.
const kirim = vi.hoisted(() => vi.fn(async () => ({ saved: true, href: "/klinik/rekam-medis/visit?success=susulan" })));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ tambahItemRekamMedis: kirim }));
import { TambahItemForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/tambah-item/TambahItemForm";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  kirim.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const obat = { id: "obat", code: null, name: "Amoxicillin", unit: "tablet", sell_price: 5000, stok: 20, item_type: "Persediaan", units: [] };
const tindakan = { id: "steril", code: null, name: "Sintetis Steril", unit: "pcs", sell_price: 75000, stok: 0, item_type: "Jasa", tindakan_kategori: "Bedah", units: [] };
async function render(tabAwal?: string) {
  await act(async () => root.render(
    <TambahItemForm visitId="visit" requestKey="request" draftUserId="owner" tabAwal={tabAwal}
      items={[obat]} jasaItems={[]} tindakanItems={[tindakan]} bahanItems={[]} racikanItems={[]}
      katalogRacikan={[]} bolehManual serviceStaff={[]} visitDoctorId="doctor" />));
}
const tindakanPanel = () => host.querySelector('section[aria-label="Pilih tindakan / racikan"]');
const obatPanel = () => host.querySelector('[placeholder="Cari nama obat / scan barcode…"]');
const tombolTab = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(label))!;
const resep = () => JSON.parse((host.querySelector('input[name="resep"]') as HTMLInputElement).value);

it("membuka tab Tindakan & Racikan lebih dulu, tapi tab Obat dan Jasa tetap ada", async () => {
  await render();
  expect(tindakanPanel()).not.toBeNull();
  expect(obatPanel()).toBeNull();
  for (const label of ["Obat", "Jasa", "Tindakan & Racikan"]) expect(tombolTab(label)).toBeDefined();
  await act(async () => tombolTab("Obat").click());
  expect(obatPanel()).not.toBeNull();
});

it("alamat boleh meminta tab Obat untuk resep susulan biasa", async () => {
  await render("obat");
  expect(obatPanel()).not.toBeNull();
  expect(tindakanPanel()).toBeNull();
});

it("obat yang dipilih masuk keranjang dengan pelaksana awal dokter PJ kunjungan", async () => {
  await render("obat");
  await act(async () => (host.querySelector('button[title="Tambah"]') as HTMLButtonElement).click());
  expect(resep()).toMatchObject([{ item_id: "obat", nama_obat: "Amoxicillin", qty: 1, satuan: "tablet",
    harga: 5000, jenis: "obat", service_performers: { doctor_id: "doctor", staff_id: null } }]);
});

it("menolak simpan selagi keranjang kosong, jadi tidak ada panggilan kosong ke server", async () => {
  await render();
  const simpan = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Simpan ke rekam medis"))!;
  await act(async () => simpan.click());
  expect(kirim).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Pilih minimal satu obat, jasa, tindakan, atau racikan.");
});
