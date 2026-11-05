// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Babibu 3 Nov: Enter di kolom satu baris form pemeriksaan langsung menyimpan dan
// melempar ke Resep / Pembayaran. Enter di kolom isian tidak boleh lagi memicu simpan;
// textarea tetap membuat baris baru dan tombol yang difokus tetap bisa di-Enter.
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

const common = {
  requestKey: "request", draftUserId: "owner", items: [], jasaItems: [], tindakanItems: [],
  bahanItems: [], racikanItems: [], katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Hewan Uji", species: "Kucing", breed: null, noRM: "RM-UJI", owner: "Pemilik Uji", phone: "0800", address: "", photo: null, dokter: "Dokter" };
async function render(kind: "exam" | "inap") {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "3 Nov", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "3 Nov", kondisi: "Stabil" }} />));
}
function enter(el: Element) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event.defaultPrevented;
}

it("blocks Enter in every single-line field of the examination form", async () => {
  await render("exam");
  const fields = ["keluhan", "berat", "suhu", "gejala_klinis", "hasil_penunjang"]
    .map(name => host.querySelector(`input[name="${name}"]`)!);
  fields.push(host.querySelector('[placeholder="Cari nama obat / scan barcode…"]')!);
  for (const field of fields) expect(enter(field), field.outerHTML).toBe(true);
});

it("keeps Enter for new lines in textareas and for a focused save button", async () => {
  await render("exam");
  expect(enter(host.querySelector('textarea[name="diagnosis"]')!)).toBe(false);
  expect(enter(host.querySelector('button[type="submit"]')!)).toBe(false);
});

it("blocks Enter in the inpatient note form too", async () => {
  await render("inap");
  const inputs = [...host.querySelectorAll("form input:not([type=hidden])")];
  expect(inputs.length).toBeGreaterThan(0);
  for (const input of inputs) expect(enter(input), input.outerHTML).toBe(true);
});
