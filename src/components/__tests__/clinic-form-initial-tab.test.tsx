// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Tombol "Tambah tindakan / obat" di Detail rekam medis mengantar dokter ke form yang
// benar lewat `?tab=tindakan`. Formnya harus langsung terbuka di tab Tindakan & Racikan,
// bukan di tab Obat yang lalu harus diklik lagi.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn(), koreksiRekamMedis: vi.fn() }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const tindakan = { id: "steril", code: null, name: "Sintetis Steril", unit: "pcs", sell_price: 75000, stok: 0, item_type: "Jasa", tindakan_kategori: "Bedah" };
const common = {
  requestKey: "request", draftUserId: "owner", items: [], jasaItems: [], tindakanItems: [tindakan],
  bahanItems: [], racikanItems: [], katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Hewan Uji", species: "Kucing", breed: null, noRM: "RM-UJI", owner: "Pemilik Uji", phone: "0800", address: "", photo: null, dokter: "Dokter" };
async function render(kind: "exam" | "inap", tabAwal?: string) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} tabAwal={tabAwal} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "29 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} tabAwal={tabAwal} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "29 Oct", kondisi: "Stabil" }} />));
}
const tindakanPanel = () => host.querySelector('section[aria-label="Pilih tindakan / racikan"]');
const obatPanel = () => host.querySelector('[placeholder="Cari nama obat / scan barcode…"]');

it.each(["exam", "inap"] as const)("opens %s on Tindakan & Racikan when the address asks for it", async kind => {
  await render(kind, "tindakan");
  expect(tindakanPanel()).not.toBeNull();
  expect(obatPanel()).toBeNull();
});

it.each(["exam", "inap"] as const)("still starts %s on Obat without the parameter", async kind => {
  await render(kind);
  expect(obatPanel()).not.toBeNull();
  expect(tindakanPanel()).toBeNull();
});

it.each(["exam", "inap"] as const)("ignores an unknown tab name on %s instead of showing a blank panel", async kind => {
  await render(kind, "entah-apa");
  expect(obatPanel()).not.toBeNull();
  expect(tindakanPanel()).toBeNull();
});
