// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// G: racikan yang belum siap diserahkan tidak menolak pembayaran, tetapi kasir harus
// mengkonfirmasi sekali sebelum tagihan diposting.
const m = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn(async () => ({ saved: true, href: "/" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: m.save }));
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

const service = { deskripsi: "Jasa fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: "service" };
const props = {
  visitId: "visit", requestKey: "request", draftUserId: "cashier",
  patient: { photo: null, name: "Pasien fiktif", species: "Kucing", owner: "Pemilik", phone: "", address: "",
    dokter: "Dokter", jenisLayanan: "Klinik", noInvoice: "(baru)", tanggal: "2026-10-28" },
  initialObat: [], initialJasa: [service], catatanResep: null,
  bekal: { promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-10-28",
    customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 },
};
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); m.push.mockClear(); m.save.mockClear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const render = async (racikanPending: boolean) =>
  act(async () => root.render(React.createElement(PembayaranForm, { ...props, racikanPending })));
const simpan = async () => {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')]
    .find(candidate => candidate.textContent?.includes("Simpan"))!;
  await act(async () => button.click());
};
const dialog = () => container.querySelector<HTMLDialogElement>('dialog[aria-label="Racikan belum siap"]');

it("posts straight away when every compound of the visit is ready", async () => {
  await render(false);
  expect(dialog()).toBeNull();
  await simpan();
  expect(m.save).toHaveBeenCalledTimes(1);
});

it("warns before posting while a compound is still pending, and does not post yet", async () => {
  await render(true);
  await simpan();
  expect(m.save).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain("Ada racikan yang belum siap diserahkan. Lanjutkan pembayaran?");
});

it("still allows payment after the cashier confirms, without asking again", async () => {
  await render(true);
  await simpan();
  const confirm = [...dialog()!.querySelectorAll("button")].find(button => button.textContent?.includes("Lanjutkan pembayaran"))!;
  await act(async () => confirm.click());
  expect(m.save).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
  await simpan();
  expect(m.save).toHaveBeenCalledTimes(2);
});

it("cancelling the warning keeps the bill unposted and the form intact", async () => {
  await render(true);
  await simpan();
  const cancel = [...dialog()!.querySelectorAll("button")].find(button => button.textContent === "Batal")!;
  await act(async () => cancel.click());
  expect(m.save).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  expect(container.querySelector<HTMLInputElement>('[name="items"]')!.value).toContain("Jasa fiktif");
});
