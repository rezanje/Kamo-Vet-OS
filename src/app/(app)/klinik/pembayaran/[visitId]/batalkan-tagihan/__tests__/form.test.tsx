// @vitest-environment jsdom
// Form "Batalkan tagihan" (B2): ringkasan efek dulu, alasan wajib, persetujuan eksplisit, lalu satu kali kirim dengan kunci tetap.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ run: [] as FormData[], reply: { ok: true, dp: 0 } as { ok: boolean; pesan?: string; dp?: number } }));
vi.mock("../actions", () => ({
  batalkanTagihanKlinik: async (f: FormData) => {
    calls.run.push(f);
    return calls.reply.ok
      ? { ok: true, hasil: { status: "VOIDED", void_id: "w1", invoice_id: "i1", invoice_no: "INV-9", visit_id: "v1", original_date: "2026-11-03", tanggal: "2026-11-14",
          total: 170000, dp_converted: calls.reply.dp ?? 0, advance_id: calls.reply.dp ? "a1" : null, advance_no: calls.reply.dp ? "UMK-202611-0001" : null,
          stock_value: 4000, hpp_reversed: 4000, stock: [], points_delta: 0, withdrawn: 2 } }
      : { ok: false, pesan: calls.reply.pesan };
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { BatalTagihanForm } from "../BatalTagihanForm";

let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
async function type(v: string) { await act(async () => { const i = host.querySelector<HTMLInputElement>("#alasan-batal-tagihan")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); }); }
const centang = () => act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.run = []; calls.reply = { ok: true, dp: 0 };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<BatalTagihanForm visitId="v1" invoiceId="i1" invoiceNo="INV-9" ringkasan={["Tagihan INV-9 (Rp 170.000) dibatalkan tanpa tagihan pengganti.", "Obat senilai Rp 4.000 kembali ke stok."]}
    requestKey="kunci-9" kembaliHref="/klinik/pembayaran/v1" halamanIni="/klinik/pembayaran/v1/batalkan-tagihan?invoice_id=i1" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("menampilkan ringkasan efek dari database sebelum apa pun dikirim, tanpa istilah teknis", () => {
  expect(host.textContent).toContain("Obat senilai Rp 4.000 kembali ke stok.");
  expect(host.textContent).not.toMatch(/RPC|journal|jurnal|idempot|void/i);
  expect(calls.run).toEqual([]);
});
it("tombol terkunci sampai alasan >= 3 huruf DAN persetujuan dicentang", async () => {
  expect(btn("Ya, batalkan tagihan").disabled).toBe(true);
  await type("ab"); await centang(); expect(btn("Ya, batalkan tagihan").disabled).toBe(true);
  await type("Data percobaan"); expect(btn("Ya, batalkan tagihan").disabled).toBe(false);
});
it("kirim memakai kunci yang sama; hasil menunjukkan langkah berikutnya (arsip paksa)", async () => {
  await type("Data percobaan"); await centang();
  await act(async () => btn("Ya, batalkan tagihan").click());
  const f = calls.run[0];
  expect([f.get("invoice_id"), f.get("visit_id"), f.get("reason"), f.get("request_key")]).toEqual(["i1", "v1", "Data percobaan", "kunci-9"]);
  expect(host.textContent).toContain("Tagihan INV-9 dibatalkan");
  expect(host.textContent).toContain("Paksa arsip");
  expect(host.textContent).not.toContain("Kembalikan DP");
});
it("DP: hasil menyebut saldo uang muka dan menawarkan pengembalian DP", async () => {
  calls.reply = { ok: true, dp: 100000 };
  await type("Data percobaan"); await centang();
  await act(async () => btn("Ya, batalkan tagihan").click());
  expect(host.textContent).toContain("UMK-202611-0001");
  expect([...host.querySelectorAll("a")].some((a) => a.textContent?.includes("Kembalikan DP") && a.getAttribute("href") === "/klinik/pembayaran/v1/batalkan-tagihan?invoice_id=i1")).toBe(true);
});
it("penolakan database tampil dalam bahasa biasa; formulir bisa diulang dengan kunci yang sama", async () => {
  calls.reply = { ok: false, pesan: "Tagihan ini sudah Lunas. Batalkan penerimaannya dulu." };
  await type("Data percobaan"); await centang();
  await act(async () => btn("Ya, batalkan tagihan").click());
  expect(host.textContent).toContain("Batalkan penerimaannya dulu");
  await act(async () => btn("Ya, batalkan tagihan").click());
  expect(calls.run.map((f) => f.get("request_key"))).toEqual(["kunci-9", "kunci-9"]);
});
