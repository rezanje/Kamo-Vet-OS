// @vitest-environment jsdom
// Form "Kembalikan saldo uang muka": jumlah (default = seluruh saldo), tujuan transfer, alasan; ajukan terkunci sampai isian lengkap.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ run: [] as FormData[], reply: { ok: true, noRefund: "RUM-202611-0001" } as { ok: boolean; noRefund?: string; pesan?: string } }));
vi.mock("../uang-muka-refund-actions", () => ({ ajukanRefundUangMuka: async (f: FormData) => { calls.run.push(f); return calls.reply; } }));
vi.mock("next/link", () => ({ default: ({ href, children }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import { UangMukaRefundForm } from "../UangMukaRefundForm";

let root: Root, host: HTMLDivElement;
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t))!;
async function type(id: string, v: string) {
  await act(async () => { const i = host.querySelector<HTMLInputElement>(`#${id}`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); });
}
const isi = async () => { await type("rum-bank", "BCA"); await type("rum-rek", "1234567890"); await type("rum-nama", "Keripik Tempe"); await type("rum-alasan", "Dikembalikan sesuai keputusan Andri"); };
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.run = []; calls.reply = { ok: true, noRefund: "RUM-202611-0001" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<UangMukaRefundForm advanceId="a1" noUangMuka="UMK-202611-0045" saldo={30000} requestKey="kunci-7" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("menampilkan saldo uang muka dan mengisi jumlah dengan seluruh saldo; tombol terkunci sampai tujuan dan alasan lengkap", async () => {
  expect(host.textContent).toContain("UMK-202611-0045");
  expect(host.textContent).toContain("30.000");
  expect(host.querySelector<HTMLInputElement>("#rum-jumlah")!.value).toBe("30000");
  expect(btn("Ajukan pengembalian").disabled).toBe(true);
  await type("rum-bank", "BCA"); await type("rum-rek", "1234567890"); await type("rum-nama", "Keripik Tempe");
  expect(btn("Ajukan pengembalian").disabled).toBe(true);
  await type("rum-alasan", "ab c");
  expect(btn("Ajukan pengembalian").disabled).toBe(true);
  await type("rum-alasan", "Dikembalikan sesuai keputusan Andri");
  expect(btn("Ajukan pengembalian").disabled).toBe(false);
});

it("jumlah di atas saldo atau nol mengunci tombol dan menjelaskan batasnya", async () => {
  await isi();
  await type("rum-jumlah", "30001");
  expect(btn("Ajukan pengembalian").disabled).toBe(true);
  expect(host.textContent).toContain("tidak boleh melebihi saldo");
  await type("rum-jumlah", "0");
  expect(btn("Ajukan pengembalian").disabled).toBe(true);
  await type("rum-jumlah", "10000");
  expect(btn("Ajukan pengembalian").disabled).toBe(false);
});

it("pengajuan mengirim isian beserta kunci permintaan yang sama; sukses menampilkan nomor refund dan tautan ke antrean Finance, tombol tidak bisa ditekan dua kali", async () => {
  await isi();
  await act(async () => btn("Ajukan pengembalian").click());
  expect(calls.run).toHaveLength(1);
  const f = calls.run[0];
  expect([f.get("advance_id"), f.get("amount"), f.get("bank"), f.get("account"), f.get("holder"), f.get("request_key")]).toEqual(["a1", "30000", "BCA", "1234567890", "Keripik Tempe", "kunci-7"]);
  expect(f.get("reason")).toBe("Dikembalikan sesuai keputusan Andri");
  expect(host.textContent).toContain("RUM-202611-0001");
  expect(host.textContent).toContain("Finance");
  expect(host.querySelector("a")!.getAttribute("href")).toBe("/kas-bank/refund?status=pending");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Ajukan pengembalian"))).toBe(false);
});

it("penolakan ditampilkan dalam bahasa Indonesia, isian tetap ada, dan bisa diajukan ulang dengan kunci yang sama", async () => {
  calls.reply = { ok: false, pesan: "Jumlah melebihi saldo uang muka yang belum terpakai." };
  await isi();
  await act(async () => btn("Ajukan pengembalian").click());
  expect(host.querySelector("[role=alert]")!.textContent).toContain("melebihi saldo");
  expect(host.querySelector<HTMLInputElement>("#rum-alasan")!.value).toBe("Dikembalikan sesuai keputusan Andri");
  calls.reply = { ok: true, noRefund: "RUM-202611-0002" };
  await act(async () => btn("Ajukan pengembalian").click());
  expect(calls.run.map((f) => f.get("request_key"))).toEqual(["kunci-7", "kunci-7"]);
});

it("tidak ada saldo: form tidak ditampilkan", async () => {
  await act(async () => root.render(<UangMukaRefundForm advanceId="a1" noUangMuka="UMK-1" saldo={0} requestKey="k" />));
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("belum terpakai");
});
