// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { koreksi, refresh } = vi.hoisted(() => ({ koreksi: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/keuangan/saldo-awal-faktur/actions", () => ({ koreksiSaldoAwalFaktur: koreksi }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { KoreksiSaldoAwalFaktur } from "@/app/(app)/keuangan/saldo-awal-faktur/KoreksiSaldoAwalFaktur";
import type { OpeningInvoiceCorrectionRow } from "@/app/(app)/keuangan/saldo-awal-faktur/types";

const base = { batch_id: "b", as_of: "2026-10-30", batal: false, periode_tutup: false, jumlah_koreksi: 0 };
const rows: OpeningInvoiceCorrectionRow[] = [
  { ...base, line_id: "11111111-1111-4111-8111-111111111111", jenis: "HUTANG", invoice_id: "i1", no_faktur: "FB.2026.10.00030", no_asal: "PI.2026.10.00114", pihak: "Loving Pet", total: 9939500, dibayar: 0 },
  { ...base, line_id: "22222222-2222-4222-8222-222222222222", jenis: "HUTANG", invoice_id: "i2", no_faktur: "FB.2026.10.00031", no_asal: "PI-X", pihak: "Twin Petfood", total: 2000000, dibayar: 1500000 },
  { ...base, line_id: "33333333-3333-4333-8333-333333333333", jenis: "PIUTANG", invoice_id: "i3", no_faktur: "FJ.2026.10.00001", no_asal: "SI-1", pihak: "Toko Kucing", total: 500000, dibayar: 0, periode_tutup: true },
];
let host: HTMLDivElement; let root: Root;
async function render(isOwner = true) { await act(async () => root.render(<KoreksiSaldoAwalFaktur rows={rows} isOwner={isOwner} />)); }
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function fill(name: string, value: string) {
  const input = host.querySelector(`[name="${name}"]`)!;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
const koreksiFor = (no: string) => [...host.querySelectorAll("tr")].find(tr => tr.textContent?.includes(no))!.querySelector("button");
const check = async () => { const box = host.querySelector('[name="yakin"]') as HTMLInputElement; await act(async () => box.click()); };

it("searches by number or party and blocks closed-period rows", async () => {
  await render();
  await fill("cari", "loving");
  expect(host.textContent).toContain("FB.2026.10.00030");
  expect(host.textContent).not.toContain("FB.2026.10.00031");
  await fill("cari", "");
  expect(koreksiFor("FJ.2026.10.00001")).toBeNull();
  expect(host.textContent).toContain("Periode tanggal saldo awal sudah ditutup.");
});

it("shows the impact, requires reason and confirmation, then sends the correction once", async () => {
  await render();
  await act(async () => koreksiFor("FB.2026.10.00030")!.click());
  await fill("nilai", "10.101.500");
  expect(host.textContent).toContain("naik Rp 162.000");
  expect(host.textContent).toContain("Sisa tagihan menjadi Rp 10.101.500");
  expect(host.textContent).toContain("Modal Pemilik (410001) debit, Utang Supplier (311001) kredit");
  expect(button("Simpan koreksi")!.disabled).toBe(true);
  await fill("alasan", "Salah ketik di file impor");
  expect(button("Simpan koreksi")!.disabled).toBe(true);
  await check();
  expect(button("Simpan koreksi")!.disabled).toBe(false);
  koreksi.mockResolvedValue({ ok: true, receipt: { correction_id: "c", journal_id: "j", no_jurnal: "JRN-202610-0042", no_faktur: "FB.2026.10.00030", jenis: "HUTANG", old_total: 9939500, new_total: 10101500, delta: 162000, dibayar: 0, sisa: 10101500 } });
  await act(async () => button("Simpan koreksi")!.click());
  expect(koreksi).toHaveBeenCalledTimes(1);
  expect(koreksi.mock.calls[0][0]).toMatchObject({ lineId: rows[0].line_id, expectedTotal: 9939500, newTotal: "10.101.500", reason: "Salah ketik di file impor", confirmed: true });
  expect(koreksi.mock.calls[0][0].requestKey).toBeTruthy();
  expect(host.textContent).toContain("Koreksi tersimpan");
  expect(host.textContent).toContain("JRN-202610-0042");
  expect(refresh).toHaveBeenCalled();
});

it("refuses a value below what was already paid and keeps the same request key on retry", async () => {
  await render();
  await act(async () => koreksiFor("FB.2026.10.00031")!.click());
  await fill("nilai", "1.000.000");
  expect(host.textContent).toContain("lebih kecil dari yang sudah dibayar (Rp 1.500.000)");
  await fill("nilai", "1.500.000"); await fill("alasan", "Faktur ternyata lebih kecil"); await check();
  expect(host.textContent).toContain("(lunas)");
  koreksi.mockResolvedValueOnce({ ok: false, error: "Koneksi terputus" });
  await act(async () => button("Simpan koreksi")!.click());
  expect(host.textContent).toContain("Koneksi terputus");
  koreksi.mockResolvedValueOnce({ ok: false, error: "lagi" });
  await act(async () => button("Simpan koreksi")!.click());
  expect(koreksi.mock.calls[1][0].requestKey).toBe(koreksi.mock.calls[0][0].requestKey);
  expect(koreksi.mock.calls[1][0].newTotal).toBe("1.500.000");
});

it("non-owners can look but not save", async () => {
  await render(false);
  expect(host.textContent).toContain("Hanya OWNER yang dapat menyimpan koreksi");
  await act(async () => koreksiFor("FB.2026.10.00030")!.click());
  await fill("nilai", "10.101.500"); await fill("alasan", "Salah ketik di file impor");
  expect((host.querySelector('[name="yakin"]') as HTMLInputElement).disabled).toBe(true);
  expect(button("Simpan koreksi")!.disabled).toBe(true);
});
