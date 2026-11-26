// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ kirim: [] as FormData[] }));
vi.mock("../../actions", () => ({ simpanOpnameOperasional: async (f: FormData) => { s.kirim.push(f); } }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => <button type="submit" disabled={disabled}>{children}</button> }));
import { OpnameForm } from "../OpnameForm";

const ITEMS = [
  { id: "a", nama: "Sapu", satuan: "buah", qty: 3, revision: 1, updated_at: "" },
  { id: "b", nama: "Ember", satuan: "buah", qty: 40, revision: 1, updated_at: "" },
];
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); s.kirim = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<OpnameForm branchId="br" requestKey="rk" items={ITEMS} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const input = (id: string) => host.querySelector<HTMLInputElement>(`#fisik-${id}`)!;
async function isi(id: string, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), v);
    input(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function alasan(id: string) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>(`input[name=alasan_${id}]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "salah hitung");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
// Formulir benar-benar terkirim = aksi server dipanggil (React menjalankan aksi hanya bila onSubmit tidak membatalkan).
const kirim = () => act(async () => { host.querySelector("form")!.requestSubmit(); await Promise.resolve(); });
const dialog = () => host.querySelector<HTMLElement>("[role=alertdialog]");
const tombol = (t: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === t)!;

it("satuan besar di samping isian dan kalimat petunjuk", () => {
  expect(input("a").closest("td")!.querySelector("[data-satuan-besar]")!.textContent).toBe("buah");
  expect(input("a").closest("td")!.querySelector("[data-petunjuk-satuan]")!.textContent).toBe("Isi jumlah fisik dalam buah");
});
it("hitungan normal dikirim tanpa dialog", async () => {
  await isi("a", "3"); await isi("b", "41"); await alasan("b");
  await kirim();
  expect(dialog()).toBeNull(); expect(s.kirim).toHaveLength(1);
});
it("1000 vs tercatat 3 -> dialog 'Yakin 1.000 buah? Sistem 3 buah'; batal tidak mengirim", async () => {
  await isi("a", "1000"); await alasan("a"); await isi("b", "40");
  await kirim();
  expect(dialog()!.textContent).toContain("Yakin 1.000 buah? Sistem 3 buah");
  expect(s.kirim).toHaveLength(0);
  await act(async () => tombol("Periksa lagi").click());
  expect(dialog()).toBeNull(); expect(s.kirim).toHaveLength(0);
});
it("Ya mengirim tepat sekali", async () => {
  await isi("a", "1000"); await alasan("a"); await isi("b", "40");
  await kirim(); await act(async () => tombol("Ya, jumlah ini benar").click());
  expect(dialog()).toBeNull(); expect(s.kirim).toHaveLength(1);
  // kunci idempotensi dan isian terkirim apa adanya
  expect(s.kirim[0].get("request_key")).toBe("rk"); expect(s.kirim[0].get("fisik_a")).toBe("1000");
});
it("dua barang janggal -> satu dialog untuk semuanya", async () => {
  await isi("a", "50"); await alasan("a"); await isi("b", "5000"); await alasan("b"); await kirim();
  expect(dialog()!.querySelectorAll("[data-butir-janggal]")).toHaveLength(2);
  expect(dialog()!.textContent).toContain("Sistem 40");
});
