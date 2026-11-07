// @vitest-environment jsdom
// Andri 7 Nov 2026: "kalau gua udah hapus dan save ... yang udah dihapus sebelumnya muncul lagi; jasa/obat yang ditambahkan
// admin kasir malah hilang." Real InpatientCashier + REAL simpanBayar action + a tiny in-memory stand-in for the database:
// the money step is rejected (PRICE_BELOW_HPP) and the visible cart must still survive the reload.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Row = { id: string; item_id: string | null; nama_obat: string; qty: number; harga: number; satuan: string; jenis: string; service_performers?: unknown };
const db = vi.hoisted(() => ({
  rows: [] as Row[], calls: [] as { name: string; args: Record<string, unknown> }[], push: vi.fn(), refresh: vi.fn(),
  moneyError: null as { code: string; message: string } | null,
}));
const snapshotOf = (rows: Row[]) => `snap:${JSON.stringify(rows.map(row => [row.id, row.qty, row.harga]))}`;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.calls.push({ name, args });
      const rows = args.p_rows as Row[];
      if (args.p_snapshot !== snapshotOf(db.rows)) return { data: null, error: { code: "P0001", message: "CART_STALE: muat ulang" } };
      if (name === "clinic_save_inpatient_cart_draft") {
        db.rows = rows.map(row => ({ ...row })); // draft = REPLACE the pending set with the visible cart
        return { data: { status: "DRAFT_SAVED", visit_id: "visit", record_id: "stay", snapshot: snapshotOf(db.rows) }, error: null };
      }
      if (db.moneyError) return { data: null, error: db.moneyError }; // whole money transaction rolled back, nothing kept
      db.rows = [];
      return { data: { status: "SAVED", visit_id: "visit", record_id: "stay", invoice_id: "invoice-1" }, error: null };
    },
  }),
}));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: db.push, refresh: db.refresh }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn(() => { throw new Error("Never post a ward through outpatient action"); }) }));
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";

const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "080000000000", address: "Alamat fiktif", dokter: "Dokter Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const accounts = [{ method: "Tunai", code: "110003", name: "Kas Fiktif", bank: null, number: null }];
const FLOOR = "PRICE_BELOW_HPP: Harga neto Obat Fiktif Rp1.000 di bawah HPP Rp2.000.\n- Obat Fiktif: harga neto Rp1.000 per pcs, HPP Rp2.000 per pcs, harga minimum Rp2.000 per pcs.";
const masterObat = [{ id: "sku", code: "O", name: "Obat Fiktif", unit: "pcs", harga: 25000 }];
const masterJasa = [{ id: "jasa-new", code: "J", name: "Jasa Tambahan Kasir", unit: "kali", harga: 70000, units: [{ unit: "kali", factor: 1, sell_price: 70000, buy_price: 0 }] }];
let host: HTMLDivElement, root: Root;
const serverData = (): InpatientCashierData => {
  const pending = db.rows.reduce((sum, row) => sum + row.qty * row.harga, 0);
  return { tax_settings: { mode_pkp: false, ppn_rate: 0 }, snapshot: snapshotOf(db.rows), rows: db.rows.map(row => ({ ...row })), history: [], receipts: [], applications: [],
    quote: { token: "q", remaining: pending, pending, debt: 0, credit: 0, subtotal: pending, tax: 0, amount: 0, excess: 0, accounts } } as InpatientCashierData;
};
const render = async (error: string | null = null) => act(async () => root.render(<InpatientCashier key={snapshotOf(db.rows)} data={serverData()} patient={patient} visitId="visit" recordId="stay" requestKey={`key-${db.calls.length}`}
  masterObat={masterObat} masterJasa={masterJasa} ppnRate={0} minDpPercent={50} bolehTerobos={false} initialError={error} />));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  db.rows = [
    { id: "rx-jasa", item_id: null, nama_obat: "Jasa Rawat Inap Fiktif", qty: 1, harga: 100000, satuan: "hari", jenis: "jasa" },
    { id: "rx-obat", item_id: "sku", nama_obat: "Obat Fiktif", qty: 2, harga: 1000, satuan: "pcs", jenis: "obat" },
    { id: "rx-dupe", item_id: "sku", nama_obat: "Obat Fiktif", qty: 1, harga: 1000, satuan: "pcs", jenis: "obat" },
  ];
  db.calls = []; db.push.mockReset(); db.refresh.mockReset(); db.moneyError = { code: "P0001", message: FLOOR };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const names = () => [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Nama"]')].map(input => input.value).sort();
async function removeDuplicate() {
  await act(async () => host.querySelectorAll<HTMLElement>('[aria-label^="Hapus baris Obat Fiktif"]')[1].click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('dialog[aria-label="Hapus item tagihan"] button')].find(button => button.textContent?.includes("Tetap hapus"))!.click());
}
async function addJasa() {
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.includes("Tambah"))[1].click());
  const picker = [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Nama"]')].find(input => input.value === "")!;
  await act(async () => { picker.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, "Jasa Tambahan"); picker.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await act(async () => { picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
const submit = async () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const draftButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Simpan Draft"));

it("Simpan with a removed doctor line and a cashier-added jasa: the money step is rejected, yet the draft keeps both and the reload shows them", async () => {
  await render();
  expect(names()).toEqual(["Jasa Rawat Inap Fiktif", "Obat Fiktif", "Obat Fiktif"]);
  await removeDuplicate(); await addJasa();
  expect(names()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
  await submit();
  // the visible cart (not the old one) is what the database now holds
  expect(db.calls.map(call => call.name)).toEqual(["clinic_save_inpatient_cashier", "clinic_save_inpatient_cart_draft"]);
  expect(db.rows.map(row => row.nama_obat).sort()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
  expect(db.rows.some(row => row.id === "rx-dupe")).toBe(false);
  expect(db.rows.find(row => row.nama_obat === "Jasa Tambahan Kasir")).toMatchObject({ item_id: "jasa-new", qty: 1, harga: 70000, jenis: "jasa" });
  const href = String(db.push.mock.calls[0][0]);
  expect(href).toContain("/klinik/pembayaran/visit?error=");
  expect(decodeURIComponent(href)).toContain("Harga neto Obat Fiktif"); expect(decodeURIComponent(href)).toContain("sudah disimpan sebagai draft");
  expect(db.refresh).toHaveBeenCalledTimes(1);
  // reload = the page renders again from what the database holds
  await render(decodeURIComponent(href.split("error=")[1]));
  expect(names()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
  // the rejected row is still marked (red border + minimum price) after the reload, via the error carried in the URL
  expect(host.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
  expect(host.textContent).toContain("2.000");
});

it("a second Simpan of the reloaded cart is idempotent: nothing resurrects, nothing duplicates, and once the money step passes it bills exactly that cart", async () => {
  await render(); await removeDuplicate(); await addJasa(); await submit();
  await render();
  const before = JSON.stringify(db.rows);
  await submit();                                    // still rejected: the same draft is saved again
  expect(JSON.stringify(db.rows)).toBe(before);
  db.moneyError = null; db.calls = [];
  await render(); await submit();
  expect(db.calls.map(call => call.name)).toEqual(["clinic_save_inpatient_cashier"]);          // success path: one call, no rescue
  expect((db.calls[0].args.p_rows as Row[]).map(row => row.nama_obat).sort()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
});

it("'Simpan Draft' saves the visible cart only: no money call, success notice, removal and addition persist", async () => {
  await render(); await removeDuplicate(); await addJasa();
  await act(async () => draftButton()!.click());
  expect(db.calls.map(call => call.name)).toEqual(["clinic_save_inpatient_cart_draft"]);
  expect(db.calls[0].args).toMatchObject({ p_snapshot: "snap:" + JSON.stringify([["rx-jasa", 1, 100000], ["rx-obat", 2, 1000], ["rx-dupe", 1, 1000]]), p_reason: "Konfirmasi keranjang rawat inap" });
  expect(db.push).toHaveBeenCalledWith("/klinik/pembayaran/visit?success=draft");
  expect(db.rows.map(row => row.nama_obat).sort()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
  await render();
  expect(names()).toEqual(["Jasa Rawat Inap Fiktif", "Jasa Tambahan Kasir", "Obat Fiktif"]);
});

it("a stale snapshot is refused for the draft too and the cashier is told, no silent overwrite", async () => {
  await render(); await removeDuplicate();
  db.rows = [...db.rows, { id: "doctor-new", item_id: null, nama_obat: "Baris Baru Dokter", qty: 1, harga: 5000, satuan: "kali", jenis: "jasa" }];   // doctor added a line after the page loaded
  await submit();
  expect(db.rows.map(row => row.id)).toContain("doctor-new");
  expect(db.rows.map(row => row.id)).toContain("rx-dupe");                                    // the stale cart changed nothing
  expect(db.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Belum ada yang tersimpan");
});
