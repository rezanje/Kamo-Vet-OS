// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Permintaan klinik 27 Nov 2026 (Mba Anisa): form edit jurnal terjepit di kolom Tindakan.
// Form sekarang dibuka selebar tabel di baris sendiri; tombolnya tetap di kolom Tindakan.
vi.mock("@/components/CorrectionTransactionForm", () => ({
  CorrectionTransactionForm: ({ children }: { children: (s: { ready: boolean }) => React.ReactNode }) => <form>{children({ ready: true })}</form>,
}));
vi.mock("@/app/(app)/keuangan/jurnal/actions", () => ({ jurnalManual: vi.fn(), koreksiJurnal: vi.fn(), batalkanJurnal: vi.fn() }));
import { JurnalKoreksiBaris, JurnalKoreksiProvider, JurnalKoreksiTombol } from "@/app/(app)/keuangan/jurnal/JurnalKoreksiPanel";

const accounts = [
  { id: "a-kasbon", code: "182001", name: "Casbon Karyawan" },
  { id: "a-kas", code: "110001", name: "Kas Blu BCA" },
];
const form = (entryId: string) => ({
  userId: "u", entryId, revision: 0, tanggal: "2026-11-13", deskripsi: "kekurangan gaji", accounts,
  lines: [{ account_id: "a-kasbon", debit: 1555000, credit: 0 }, { account_id: "a-kas", debit: 0, credit: 1555000 }],
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

async function renderTabel(ids = ["e1"]) {
  await act(async () => root.render(
    <JurnalKoreksiProvider>
      <table><tbody>
        {ids.map((id) => <React.Fragment key={id}>
          <tr data-jurnal={id}><td>JRN-{id}</td><td data-tindakan={id}><JurnalKoreksiTombol entryId={id} /></td></tr>
          <JurnalKoreksiBaris colSpan={9} noJurnal={`JRN-${id}`} {...form(id)} />
        </React.Fragment>)}
      </tbody></table>
    </JurnalKoreksiProvider>,
  ));
}
const tombol = (id: string) => host.querySelector<HTMLButtonElement>(`[data-tindakan="${id}"] button`)!;
const baris = (id: string) => host.querySelector<HTMLTableRowElement>(`#koreksi-jurnal-${id}`)!;
const klik = (el: HTMLElement) => act(async () => el.click());

it("the edit form opens as a full-width row under the journal, not inside the narrow Tindakan cell", async () => {
  await renderTabel();
  expect(tombol("e1").textContent).toContain("Edit jurnal manual");
  expect(tombol("e1").getAttribute("aria-expanded")).toBe("false");
  expect(baris("e1").hidden).toBe(true);
  // Form tidak lagi berada di dalam sel Tindakan.
  expect(host.querySelector('[data-tindakan="e1"] form')).toBeNull();
  expect(host.querySelector('[data-tindakan="e1"] [role=combobox]')).toBeNull();

  await klik(tombol("e1"));
  expect(tombol("e1").getAttribute("aria-expanded")).toBe("true");
  expect(tombol("e1").getAttribute("aria-controls")).toBe(baris("e1").id);
  expect(baris("e1").hidden).toBe(false);
  // Tepat di bawah baris jurnalnya, satu sel selebar seluruh kolom tabel.
  expect(baris("e1").previousElementSibling?.getAttribute("data-jurnal")).toBe("e1");
  expect(baris("e1").cells).toHaveLength(1);
  expect(baris("e1").cells[0].colSpan).toBe(9);
  expect(baris("e1").textContent).toContain("JRN-e1");
  // Akun tampil utuh (kode · nama), berikut debit/kredit dan totalnya.
  expect(baris("e1").querySelector<HTMLInputElement>('[role=combobox][aria-label="Akun baris 1"]')!.value).toBe("182001 · Casbon Karyawan");
  expect(baris("e1").querySelector('[aria-label="Debit baris 1"]')).not.toBeNull();
  expect(baris("e1").querySelector('[aria-label="Kredit baris 2"]')).not.toBeNull();
  expect(baris("e1").querySelector('[data-testid="koreksi-total"]')!.textContent).toContain("Rp 1.555.000");
});

it("closing keeps what was typed; each journal opens independently", async () => {
  await renderTabel(["e1", "e2"]);
  await klik(tombol("e1"));
  expect(baris("e1").hidden).toBe(false);
  expect(baris("e2").hidden).toBe(true);

  const alasan = baris("e1").querySelector<HTMLInputElement>('[aria-label="Alasan koreksi"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(alasan, "salah akun");
    alasan.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Tombol "Tutup" di panel menutup; membuka jurnal lain tidak mengganggu.
  const tutup = [...baris("e1").querySelectorAll("button")].find((b) => b.textContent?.includes("Tutup"))!;
  await klik(tutup);
  expect(baris("e1").hidden).toBe(true);
  expect(tombol("e1").getAttribute("aria-expanded")).toBe("false");
  await klik(tombol("e2"));
  expect(baris("e2").hidden).toBe(false);
  expect(baris("e1").hidden).toBe(true);

  await klik(tombol("e1"));
  expect(baris("e1").hidden).toBe(false);
  expect(baris("e2").hidden).toBe(false);
  expect(baris("e1").querySelector<HTMLInputElement>('[aria-label="Alasan koreksi"]')!.value).toBe("salah akun");
});

it("save stays locked until debit equals credit and a reason is given", async () => {
  await renderTabel();
  await klik(tombol("e1"));
  const simpan = () => [...baris("e1").querySelectorAll<HTMLButtonElement>("button[type=submit]")].find((b) => b.textContent?.includes("Simpan koreksi"))!;
  const isi = async (label: string, value: string) => {
    const el = baris("e1").querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  expect(simpan().disabled).toBe(true); // alasan belum diisi
  await isi("Alasan koreksi", "salah nominal");
  expect(simpan().disabled).toBe(false);
  await isi("Debit baris 1", "1000000");
  expect(simpan().disabled).toBe(true);
  expect(baris("e1").querySelector('[data-testid="koreksi-total"]')!.textContent).toContain("belum balance");
  await isi("Kredit baris 2", "1000000");
  expect(simpan().disabled).toBe(false);
  expect(JSON.parse(baris("e1").querySelector<HTMLInputElement>('input[name="lines"]')!.value)).toEqual([
    { account_id: "a-kasbon", debit: 1000000, credit: 0 }, { account_id: "a-kas", debit: 0, credit: 1000000 },
  ]);
});
