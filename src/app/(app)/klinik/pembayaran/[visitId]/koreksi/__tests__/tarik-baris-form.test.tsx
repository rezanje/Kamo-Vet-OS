// @vitest-environment jsdom
// Form "Tarik baris (Owner)": hanya baris yang boleh bisa dipilih, pratinjau dulu, alasan wajib, lalu tarik.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ preview: [] as FormData[], run: [] as FormData[], runReply: { ok: true } as { ok: boolean; pesan?: string } }));
const P = { invoice_no: "INV-9", total_before: 555000, total_after: 525000, removed_total: 30000, hpp_removed: 29578.29,
  stock: [{ name: "Infus Rl", qty: 1, cost: 9770.15 }], journals: [{ source: "klinik-edit", amount: 30000 }, { source: "klinik-ar", amount: 30000 }], advance: { no_uang_muka: "UMK-9", balance_before: 0, balance_after: 30000 } };
vi.mock("../actions", () => ({
  pratinjauTarikBaris: async (f: FormData) => { calls.preview.push(f); return { ok: true, pratinjau: P, selesai: false }; },
  tarikBarisLunas: async (f: FormData) => { calls.run.push(f); return calls.runReply.ok ? { ok: true, pratinjau: P, selesai: true } : { ok: false, pesan: calls.runReply.pesan }; },
}));
import { TarikBarisForm } from "../TarikBarisForm";

const LINES = [
  { invoice_item_id: "l-inf", deskripsi: "Infus Refill", qty: 1, harga: 30000, hpp: 29578.29, eligible: true, message: null, quote: null },
  { invoice_item_id: "l-rac", deskripsi: "Obat Racik", qty: 1, harga: 80000, hpp: 50901, eligible: false, message: "RECIPE_LINKED: baris racikan tidak bisa ditarik dari sini", quote: null },
];
let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
const box = (t: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Tarik ${t}"]`)!;
async function type(v: string) { await act(async () => { const i = host.querySelector<HTMLInputElement>("#alasan-tarik")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.preview = []; calls.run = []; calls.runReply = { ok: true };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<TarikBarisForm visitId="v1" invoiceId="i1" invoiceNo="INV-9" lines={LINES} requestKey="kunci-9" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("baris yang ditolak database tidak bisa dipilih dan alasannya ditampilkan", () => {
  expect(box("Infus Refill").disabled).toBe(false);
  expect(box("Obat Racik").disabled).toBe(true);
  expect(host.textContent).toContain("Baris racikan tidak bisa ditarik dari sini");
  expect(host.textContent).not.toContain("RECIPE_LINKED");
});

it("tombol Tarik baris terkunci sampai ada pratinjau dan alasan >= 5 huruf", async () => {
  expect(btn("Pratinjau").disabled).toBe(true);
  await act(async () => box("Infus Refill").click());
  expect(btn("Pratinjau").disabled).toBe(false);
  expect(btn("Tarik baris").disabled).toBe(true);
  await act(async () => btn("Pratinjau").click());
  expect(host.textContent).toContain("Pratinjau (belum ada yang berubah)");
  expect(host.textContent).toContain("Saldo uang muka pasien");
  expect(host.textContent).toContain("Kas/bank tidak bergerak");
  expect(btn("Tarik baris").disabled).toBe(true);
  await type("ab c");
  expect(btn("Tarik baris").disabled).toBe(true);
  await type("Infus tidak jadi dipakai");
  expect(btn("Tarik baris").disabled).toBe(false);
});

it("mengirim baris, alasan dan kunci yang sama; setelah sukses menampilkan hasil tanpa tombol ulang", async () => {
  await act(async () => box("Infus Refill").click());
  await type("Infus tidak jadi dipakai");
  await act(async () => btn("Pratinjau").click());
  await act(async () => btn("Tarik baris").click());
  const f = calls.run[0];
  expect(f.getAll("line")).toEqual(["l-inf"]); expect(f.get("reason")).toBe("Infus tidak jadi dipakai"); expect(f.get("request_key")).toBe("kunci-9"); expect(f.get("invoice_id")).toBe("i1");
  expect(host.textContent).toContain("Baris sudah ditarik dari INV-9");
  expect(host.textContent).toContain("Tidak ada uang kas atau bank yang bergerak");
  expect(btn("Tarik baris")).toBeUndefined();
});

it("galat dari server ditampilkan dan form tetap bisa dicoba lagi dengan kunci yang sama", async () => {
  calls.runReply = { ok: false, pesan: "Periode akuntansi sudah ditutup, koreksi tidak boleh dilakukan." };
  await act(async () => box("Infus Refill").click());
  await type("Infus tidak jadi dipakai");
  await act(async () => btn("Pratinjau").click());
  await act(async () => btn("Tarik baris").click());
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Periode akuntansi sudah ditutup");
  await act(async () => btn("Tarik baris").click());
  expect(calls.run.map((f) => f.get("request_key"))).toEqual(["kunci-9", "kunci-9"]);
});

it("mengganti pilihan membatalkan pratinjau lama (tidak boleh menarik baris yang belum dipratinjau)", async () => {
  await act(async () => box("Infus Refill").click());
  await act(async () => btn("Pratinjau").click());
  expect(host.textContent).toContain("Pratinjau (belum ada yang berubah)");
  await act(async () => box("Infus Refill").click());
  expect(host.textContent).not.toContain("Pratinjau (belum ada yang berubah)");
});
