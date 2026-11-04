// @vitest-environment jsdom
// Editor Promo Paket (Syarat → Pilih Barang → Hasil): satu halaman ringkas, pratinjau kalimat langsung, validasi Indonesia,
// stale-version, izin di bawah HPP khusus Owner, aktivasi dengan penjelasan saklar rilis, tanpa hapus.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  simpan: vi.fn(), status: vi.fn(), taksir: vi.fn(), salin: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => m.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/app/(app)/crm/promo/paket/actions", () => ({ simpanPromoPaket: m.simpan, ubahStatusPromoPaket: m.status, taksirHppPaket: m.taksir, salinPromoPaket: m.salin }));
import { PaketEditor } from "@/app/(app)/crm/promo/paket/PaketEditor";
import { emptyPaketForm, type PaketForm, type PaketItemInfo } from "@/lib/promo-paket";

const IKAN = "11111111-1111-4111-8111-111111111111", DONAT = "22222222-2222-4222-8222-222222222222", ANC = "33333333-3333-4333-8333-333333333333";
const CAB1 = "44444444-4444-4444-8444-444444444444", CAB2 = "55555555-5555-4555-8555-555555555555", PID = "66666666-6666-4666-8666-666666666666";
const V1 = "a".repeat(32), V2 = "b".repeat(32);
const items: PaketItemInfo[] = [
  { id: IKAN, code: "BLT-IKAN", name: "Bolt Ikan 800gr", units: ["PCS", "BOX"], active: true },
  { id: DONAT, code: "BLT-DONAT", name: "Bolt Donat 800gr", units: ["PCS"], active: true },
  { id: ANC, code: "ANC-CS", name: "ANC Creamy Stick", units: ["PCS"], active: true },
];
const branches = [{ id: CAB1, name: "Cabang Satu" }, { id: CAB2, name: "Cabang Dua" }];
const filled = (over: Partial<PaketForm> = {}): PaketForm => ({
  name: "Beli 2 Bolt, ANC -Rp1.000", branchIds: [], validFrom: "2026-11-04", validUntil: "", repeat: true,
  syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }] }],
  hasil: { items: [{ item_id: ANC, unit: "PCS" }], rewardQty: "1", discountType: "nominal", value: "1000", maxAmount: "" },
  belowHpp: { allowed: false, reason: "" }, ...over,
});

let host: HTMLDivElement, root: Root;
type Props = Partial<React.ComponentProps<typeof PaketEditor>>;
const mount = async (p: Props = {}) => {
  await act(async () => root.render(<PaketEditor userId="owner1" mode="baru" initialForm={emptyPaketForm("2026-11-04")} active={false} items={items} branches={branches} role="OWNER" today="2026-11-04" released={true} {...p} />));
};
const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
const byLabel = (text: string) => [...host.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === text) as HTMLElement | undefined;
const btn = (text: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const set = async (el: HTMLElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };
const preview = () => q("[data-testid=pratinjau]")?.textContent ?? "";
const alertText = () => [...host.querySelectorAll("[role=alert]")].map((e) => e.textContent).join(" | ");

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  m.simpan.mockReset(); m.status.mockReset(); m.taksir.mockReset(); m.salin.mockReset(); Object.values(m.router).forEach((f) => f.mockReset());
  m.taksir.mockResolvedValue({ ok: true, rows: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("shows the compact one-page layout: Nama, Cabang, tanggal, kelipatan, Syarat 1 (Kuantitas Barang), Hasil — Indonesian, with the AND hint", async () => {
  await mount();
  expect(q("input[name=nama]")).toBeTruthy();
  expect(host.textContent).toContain("Syarat Promo");
  expect(host.textContent).toContain("Semua syarat harus terpenuhi (DAN)");
  expect(host.textContent).toContain("Hasil — Promo barang");
  expect(host.textContent).toContain("Berlaku kelipatan");
  expect((byLabel("Jenis syarat 1") as HTMLSelectElement).value).toBe("qty");
  expect(q("input[name=tanggal-dari]")).toBeTruthy();
  expect(host.textContent).toContain("Cabang");
  expect(preview()).toContain("belum lengkap");
});

it("builds the Andri example by picking items (Enter adds the first hit) and the sentence updates live", async () => {
  await mount();
  await set(q("input[name=nama]")!, "Beli 2 Bolt, ANC -Rp1.000");
  await set(q("input[name=syarat-min-0]")!, "2");
  const search = byLabel("Cari barang syarat 1") as HTMLInputElement;
  await set(search, "bolt");
  expect(host.querySelectorAll("[role=listbox] [role=option]").length).toBe(2);
  await act(async () => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await set(byLabel("Cari barang syarat 1")!, "donat");
  await click(host.querySelector("[role=listbox] [role=option]"));
  expect(host.textContent).toContain("2 barang dipilih");
  expect(preview()).toContain("Beli 2 PCS Bolt Ikan 800gr / Bolt Donat 800gr (campur varian)");
  await set(byLabel("Cari barang hasil")!, "anc");
  await click(host.querySelector("[role=listbox] [role=option]"));
  await set(q("input[name=hasil-nilai]")!, "1000");
  expect(preview()).toBe("Pratinjau: Beli 2 PCS Bolt Ikan 800gr / Bolt Donat 800gr (campur varian) → potongan Rp1.000 per PCS ANC Creamy Stick, berlaku kelipatan");
});

it("'Tambah semua hasil' adds every variant found, and each item keeps its own unit dropdown (mixing variants/units)", async () => {
  await mount();
  await set(byLabel("Cari barang syarat 1")!, "bolt");
  await click(btn(/Tambah semua hasil \(2\)/));
  expect(host.textContent).toContain("2 barang dipilih");
  const sel = byLabel("Satuan Bolt Ikan 800gr") as HTMLSelectElement;
  expect([...sel.options].map((o) => o.value)).toEqual(["PCS", "BOX"]);
  await set(sel, "BOX");
  expect(preview()).toContain("Bolt Ikan 800gr (BOX)");
  expect(preview()).toContain("(campur varian, campur satuan)");
  await click(byLabel("Buang Bolt Donat 800gr"));
  expect(host.textContent).toContain("1 barang dipilih");
});

it("syarat rows: add up to 8 then the button stops; remove works; the last row cannot be removed; 'Nilai Belanja' has no item picker", async () => {
  await mount({ initialForm: filled() });
  for (let i = 0; i < 7; i++) await click(btn("+ Syarat Promo"));
  expect(host.querySelectorAll("[data-syarat-row]").length).toBe(8);
  expect(btn("+ Syarat Promo")!.disabled).toBe(true);
  expect(host.textContent).toContain("maksimal 8");
  await click(byLabel("Buang syarat 8"));
  expect(host.querySelectorAll("[data-syarat-row]").length).toBe(7);
  await set(byLabel("Jenis syarat 2")!, "nilai");
  expect(byLabel("Cari barang syarat 2")).toBeUndefined();
  expect(q("input[name=syarat-min-1]")).toBeTruthy();
  expect(host.textContent).toContain("seluruh keranjang");
  for (let i = 7; i >= 2; i--) await click(byLabel(`Buang syarat ${i}`));
  expect((byLabel("Buang syarat 1") as HTMLButtonElement).disabled).toBe(true);
});

it("hasil: maksimum diskon only exists for percent; kelipatan toggles the sentence", async () => {
  await mount({ initialForm: filled() });
  expect(q("input[name=hasil-maks]")).toBeNull();
  await set(byLabel("Jenis potongan")!, "percent");
  await set(q("input[name=hasil-nilai]")!, "50");
  await set(q("input[name=hasil-maks]")!, "5000");
  expect(preview()).toContain("potongan 50% per PCS ANC Creamy Stick, maks. diskon Rp5.000 per PCS");
  await click(q("input[name=kelipatan]"));
  expect(preview()).toContain("sekali saja");
  await set(byLabel("Jenis potongan")!, "nominal");
  expect(q("input[name=hasil-maks]")).toBeNull();
});

it("saving an incomplete form shows every Indonesian problem and does not call the server", async () => {
  await mount();
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan).not.toHaveBeenCalled();
  expect(alertText()).toContain("Nama promo wajib diisi.");
  expect(alertText()).toContain("Syarat 1: pilih minimal 1 barang.");
  expect(alertText()).toContain("Hasil: pilih minimal 1 barang hasil.");
});

it("a valid new promo is saved as a draft (id/version null), the page moves to its edit route, and activation then becomes possible", async () => {
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V1, active: false });
  await mount({ initialForm: filled() });
  expect(btn(/Aktifkan/)!.disabled).toBe(true);
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan).toHaveBeenCalledWith({ id: null, version: null, form: filled() });
  expect(m.router.replace).toHaveBeenCalledWith(`/crm/promo/paket/${PID}`);
  expect(host.textContent).toContain("Tersimpan sebagai draf");
});

it("editing an existing draft sends the page's version token and then uses the returned one", async () => {
  m.simpan.mockResolvedValueOnce({ ok: true, id: PID, version: V2, active: false });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await set(q("input[name=nama]")!, "Nama baru");
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan).toHaveBeenLastCalledWith({ id: PID, version: V1, form: filled({ name: "Nama baru" }) });
  expect(m.router.replace).not.toHaveBeenCalled();
  m.status.mockResolvedValue({ ok: true, id: PID, version: "c".repeat(32), active: true });
  await click(btn(/Aktifkan/));
  expect(m.status).toHaveBeenCalledWith({ id: PID, version: V2, active: true });
});

it("stale version: the edit stays on screen with a reload prompt; reloading refreshes the route and the draft survives in the browser", async () => {
  m.simpan.mockResolvedValue({ ok: false, stale: true, message: "Promo ini sudah diubah orang lain sejak Anda membukanya." });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await set(q("input[name=nama]")!, "Edit saya");
  await click(btn(/Simpan sebagai draf/));
  expect(alertText()).toContain("diubah orang lain");
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Edit saya");
  await click(btn("Muat ulang data terbaru"));
  expect(m.router.refresh).toHaveBeenCalled();
  expect(sessionStorage.getItem("vetos:paket-draft:v1:owner1:" + PID)).toContain("Edit saya");
  // after the reload the page re-mounts with the NEW version: the old draft is NOT applied silently — the user chooses
  await act(async () => root.unmount()); root = createRoot(host);
  await mount({ mode: "ubah", promoId: PID, version: V2, initialForm: filled({ name: "Versi server" }) });
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Versi server");
  expect(btn("Pakai draf saya")).toBeTruthy();
  expect(btn("Buang draf")).toBeTruthy();
  expect(host.textContent).toContain("Data promo sudah berubah di server");
  expect(sessionStorage.getItem("vetos:paket-draft:v1:owner1:" + PID)).toContain("Edit saya");
});

it("stale refresh: 'Pakai draf saya' applies the old draft on the new version token (explicit choice), 'Buang draf' drops it", async () => {
  const key = "vetos:paket-draft:v1:owner1:" + PID;
  const stored = () => sessionStorage.setItem(key, JSON.stringify({ baseVersion: V1, form: filled({ name: "Edit saya" }), at: 1 }));
  stored();
  await mount({ mode: "ubah", promoId: PID, version: V2, initialForm: filled({ name: "Versi server" }) });
  await click(btn("Pakai draf saya"));
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Edit saya");
  expect(btn("Pakai draf saya")).toBeUndefined();
  expect(JSON.parse(sessionStorage.getItem(key)!).baseVersion).toBe(V2);
  await act(async () => root.unmount()); root = createRoot(host); sessionStorage.clear(); stored();
  await mount({ mode: "ubah", promoId: PID, version: V2, initialForm: filled({ name: "Versi server" }) });
  await click(btn("Buang draf"));
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Versi server");
  expect(btn("Buang draf")).toBeUndefined();
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("a draft saved for the SAME version is restored directly (with the plain notice), no choice banner", async () => {
  const key = "vetos:paket-draft:v1:owner1:" + PID;
  sessionStorage.setItem(key, JSON.stringify({ baseVersion: V1, form: filled({ name: "Edit saya" }), at: 1 }));
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Edit saya");
  expect(host.textContent).toContain("Draf Anda dipulihkan dari browser ini");
  expect(btn("Pakai draf saya")).toBeUndefined();
});

it("a draft is never restored over an ACTIVE (locked) promo, nor over a waiver-locked one for ADMIN; the stale draft is cleared", async () => {
  const key = "vetos:paket-draft:v1:owner1:" + PID;
  sessionStorage.setItem(key, JSON.stringify({ baseVersion: V1, form: filled({ name: "Draf lama" }), at: 1 }));
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled({ name: "Yang aktif" }), active: true });
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Yang aktif");
  expect(preview()).not.toContain("Draf lama");
  expect(host.textContent).not.toContain("Draf Anda dipulihkan");
  expect(btn("Pakai draf saya")).toBeUndefined();
  expect(sessionStorage.getItem(key)).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host);
  sessionStorage.setItem(key, JSON.stringify({ baseVersion: V1, form: filled({ name: "Draf lama" }), at: 1 }));
  await mount({ role: "ADMIN", mode: "ubah", promoId: PID, version: V1, initialForm: filled({ name: "Berizin Owner", belowHpp: { allowed: true, reason: "barang reject sisa gudang" } }) });
  expect((q("input[name=nama]") as HTMLInputElement).value).toBe("Berizin Owner");
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("after a successful save, later drafts carry the NEW version as base (a reload does not show a misleading 'server changed' notice)", async () => {
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V2, active: false });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await set(q("input[name=nama]")!, "Satu");
  await click(btn(/Simpan sebagai draf/));
  await set(q("input[name=nama]")!, "Dua");
  expect(JSON.parse(sessionStorage.getItem("vetos:paket-draft:v1:owner1:" + PID)!).baseVersion).toBe(V2);
});

it("a successful save clears the saved browser draft", async () => {
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V2, active: false });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await set(q("input[name=nama]")!, "Edit saya");
  expect(sessionStorage.getItem("vetos:paket-draft:v1:owner1:" + PID)).toContain("Edit saya");
  await click(btn(/Simpan sebagai draf/));
  expect(sessionStorage.getItem("vetos:paket-draft:v1:owner1:" + PID)).toBeNull();
});

it("release flag OFF: a visible notice up front, and clicking Aktifkan shows the refusal in Indonesian", async () => {
  m.status.mockResolvedValue({ ok: false, message: "Fitur promo paket belum dirilis oleh Owner. Promo tetap tersimpan sebagai draf dan bisa diaktifkan setelah dirilis." });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled(), released: false });
  expect(host.textContent).toContain("Fitur promo paket belum dirilis oleh Owner");
  await click(btn(/Aktifkan/));
  expect(m.status).toHaveBeenCalledWith({ id: PID, version: V1, active: true });
  expect(alertText()).toContain("Fitur promo paket belum dirilis oleh Owner");
});

it("Aktifkan is blocked while there are unsaved changes (the token would not match what is on screen)", async () => {
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  expect(btn(/Aktifkan/)!.disabled).toBe(false);
  await set(q("input[name=nama]")!, "Diubah");
  expect(btn(/Aktifkan/)!.disabled).toBe(true);
  expect(host.textContent).toContain("Simpan perubahan dulu");
});

it("an ACTIVE promo opens read-only: fields locked, no save button, only 'Nonaktifkan untuk mengubah'", async () => {
  m.status.mockResolvedValue({ ok: true, id: PID, version: V2, active: false });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled(), active: true });
  expect((q("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect(btn(/Simpan sebagai draf/)).toBeUndefined();
  expect(host.textContent).toContain("Promo sedang aktif");
  await click(btn("Nonaktifkan untuk mengubah"));
  expect(m.status).toHaveBeenCalledWith({ id: PID, version: V1, active: false });
  expect((q("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  expect(btn(/Simpan sebagai draf/)).toBeTruthy();
});

it("there is no way to delete a promo anywhere in the editor", async () => {
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  const all = [...host.querySelectorAll("button,a,[aria-label]")].map((e) => `${e.textContent} ${e.getAttribute("aria-label") ?? ""}`).join(" ");
  expect(all).not.toMatch(/hapus|delete|remove/i);
});

const belowHpp = { ok: true, rows: [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }] };
it("OWNER sees the below-HPP block: estimated loss per unit from HPP, an explicit confirmation, and a required reason", async () => {
  m.taksir.mockResolvedValue(belowHpp);
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V1, active: false });
  await mount({ initialForm: filled() });
  expect(m.taksir).toHaveBeenCalledWith([{ item_id: ANC, unit: "PCS" }], []);
  expect(host.textContent).toContain("rugi sekitar Rp500/unit");
  expect(host.textContent).toContain("Perkiraan di bawah modal");
  expect(host.textContent).toContain("perlu izin Owner");
  const box = q("input[name=izin-hpp]") as HTMLInputElement;
  expect(host.textContent).toContain("Saya mengerti dan mengizinkan penjualan di bawah HPP untuk promo ini");
  expect(box.checked).toBe(false);
  await click(box);
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan).not.toHaveBeenCalled();
  expect(alertText()).toContain("Alasan izin di bawah HPP minimal 10 karakter.");
  await set(q("input[name=izin-hpp-alasan]")!, "barang mendekati expired");
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan.mock.calls[0][0].form.belowHpp).toEqual({ allowed: true, reason: "barang mendekati expired" });
});

it("ADMIN never gets the waiver checkbox; the estimate is shown with an 'ask the Owner' explanation", async () => {
  m.taksir.mockResolvedValue(belowHpp);
  await mount({ role: "ADMIN", initialForm: filled() });
  expect(q("input[name=izin-hpp]")).toBeNull();
  expect(host.textContent).toContain("hanya dapat diizinkan oleh Owner");
  expect(host.textContent).toContain("rugi sekitar Rp500/unit");
});

it("ADMIN opening a promo that already carries the Owner's waiver cannot edit it (only deactivate)", async () => {
  await mount({ role: "ADMIN", mode: "ubah", promoId: PID, version: V1, initialForm: filled({ belowHpp: { allowed: true, reason: "barang reject sisa gudang" } }) });
  expect((q("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect(host.textContent).toContain("hanya Owner yang dapat mengubah isinya");
  expect(btn(/Simpan sebagai draf/)).toBeUndefined();
});

it("unknown HPP is said plainly (never shown as safe)", async () => {
  m.taksir.mockResolvedValue({ ok: true, rows: [{ item_id: ANC, unit: "PCS", price: 15000, hpp: null, source: null }] });
  await mount({ initialForm: filled() });
  expect(host.textContent).toContain("HPP tidak terbaca");
});

it("saving a draft that does not need a waiver sends belowHpp.allowed=false even if the Owner ticked and unticked it", async () => {
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V1, active: false });
  await mount({ initialForm: filled() });
  const box = q("input[name=izin-hpp]") as HTMLInputElement;
  await click(box); await click(box);
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan.mock.calls[0][0].form.belowHpp.allowed).toBe(false);
});

it("branch picker: default 'Semua cabang', choosing branches is reflected in the saved form", async () => {
  m.simpan.mockResolvedValue({ ok: true, id: PID, version: V1, active: false });
  await mount({ initialForm: filled() });
  expect(host.textContent).toContain("Semua cabang");
  await click(q("input[name=cabang-" + CAB2 + "]"));
  await click(btn(/Simpan sebagai draf/));
  expect(m.simpan.mock.calls[0][0].form.branchIds).toEqual([CAB2]);
});

it("activation that succeeds with a below-HPP estimate shows the warning (not an error)", async () => {
  m.status.mockResolvedValue({ ok: true, id: PID, version: V2, active: true, warning: "Peringatan: perkiraan di bawah modal; perlu izin Owner. Dengan promo ini harga jual barang hasil (Rp14.000) di bawah perkiraan HPP (Rp14.500)." });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await click(btn(/Aktifkan/));
  expect(host.textContent).toContain("Promo aktif");
  expect(host.textContent).toContain("perkiraan di bawah modal; perlu izin Owner");
  expect(alertText()).not.toContain("perkiraan di bawah modal");
});

it("several branches with different price/HPP: one estimate row per distinct combination, named by branch", async () => {
  m.taksir.mockResolvedValue({ ok: true, rows: [
    { item_id: ANC, unit: "PCS", price: 15000, hpp: 13000, source: "lapisan", branch_ids: [CAB1] },
    { item_id: ANC, unit: "PCS", price: 13500, hpp: 14000, source: "lapisan", branch_ids: [CAB2] },
  ] });
  await mount({ initialForm: filled() });
  const rows = [...host.querySelectorAll("table[aria-label='Taksiran HPP barang hasil'] tbody tr")].map((r) => r.textContent);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("Cabang Satu");
  expect(rows[1]).toContain("Cabang Dua");
  expect(host.textContent).toContain("rugi sekitar Rp1.500/unit"); // CAB2: 13.500 - 1.000 = 12.500 < 14.000
});

it("with the Owner's waiver ticked the below-HPP note is neutral ('diizinkan Owner'), not a warning that asks for permission", async () => {
  m.taksir.mockResolvedValue(belowHpp);
  await mount({ initialForm: filled({ belowHpp: { allowed: true, reason: "barang mendekati expired" } }) });
  expect(host.textContent).toContain("diizinkan Owner");
  expect(host.textContent).not.toContain("perlu izin Owner");
});

// ───────────── accessibility ─────────────
it("every form control has an accessible name (label association or aria-label): numeric inputs, selects, reason, picker", async () => {
  m.taksir.mockResolvedValue(belowHpp);
  await mount({ initialForm: filled(), role: "OWNER" });
  await set(byLabel("Jenis potongan")!, "percent");
  await click(q("input[name=izin-hpp]"));
  const controls = [...host.querySelectorAll("input,select,textarea")].filter((e) => (e as HTMLInputElement).type !== "hidden") as (HTMLInputElement | HTMLSelectElement)[];
  expect(controls.length).toBeGreaterThan(12);
  const nameless = controls.filter((e) => !(e.getAttribute("aria-label")?.trim() || e.getAttribute("aria-labelledby") || (e.labels && e.labels.length > 0 && [...e.labels].some((l) => l.textContent?.trim()))));
  expect(nameless.map((e) => e.outerHTML.slice(0, 90))).toEqual([]);
  const ids = controls.map((e) => e.id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  // the visible label text is what names the numeric inputs
  expect((q("input[name=syarat-min-0]") as HTMLInputElement).labels![0].textContent).toContain("Kuantitas minimum");
  expect((q("input[name=hasil-nilai]") as HTMLInputElement).labels![0].textContent).toContain("Persen potongan");
  expect((q("input[name=hasil-maks]") as HTMLInputElement).labels![0].textContent).toContain("Maksimum diskon");
  expect((q("input[name=hasil-jumlah]") as HTMLInputElement).labels![0].textContent).toContain("Unit hasil");
});

it("ids stay unique with several syarat rows", async () => {
  await mount({ initialForm: filled() });
  await click(btn("+ Syarat Promo")); await click(btn("+ Syarat Promo"));
  const ids = [...host.querySelectorAll("[id]")].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect((q("input[name=syarat-min-2]") as HTMLInputElement).labels![0].textContent).toContain("Kuantitas minimum");
});

const key = (el: HTMLElement, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
it("item picker: combobox/listbox roles, ArrowDown/ArrowUp move aria-activedescendant, Enter adds the highlighted item, Escape closes", async () => {
  await mount();
  const search = byLabel("Cari barang syarat 1") as HTMLInputElement;
  expect(search.getAttribute("role")).toBe("combobox");
  expect(search.getAttribute("aria-autocomplete")).toBe("list");
  await set(search, "bolt");
  const opts = () => [...host.querySelectorAll("[role=listbox] [role=option]")] as HTMLElement[];
  expect(opts()).toHaveLength(2);
  expect(opts().every((o) => !!o.id)).toBe(true);
  expect(new Set(opts().map((o) => o.id)).size).toBe(2);
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
  expect(opts().map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "false"]);
  await key(search, "ArrowDown");
  expect(search.getAttribute("aria-activedescendant")).toBe(opts()[0].id);
  expect(opts().map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  await key(search, "ArrowDown");
  expect(search.getAttribute("aria-activedescendant")).toBe(opts()[1].id);
  await key(search, "ArrowDown"); // wraps
  expect(search.getAttribute("aria-activedescendant")).toBe(opts()[0].id);
  await key(search, "ArrowUp"); // wraps backwards
  expect(search.getAttribute("aria-activedescendant")).toBe(opts()[1].id);
  await key(search, "Enter");
  expect(host.textContent).toContain("1 barang dipilih");
  expect(host.querySelector("table[aria-label='Barang terpilih syarat 1']")!.textContent).toContain("Bolt Donat 800gr"); // the 2nd hit, not the first
  expect((byLabel("Cari barang syarat 1") as HTMLInputElement).value).toBe("");
  await set(byLabel("Cari barang syarat 1")!, "bolt");
  await key(byLabel("Cari barang syarat 1")!, "Escape");
  expect(host.querySelectorAll("[role=listbox]").length).toBe(0);
  expect((byLabel("Cari barang syarat 1") as HTMLInputElement).value).toBe("");
});

it("item picker: Enter with nothing highlighted still adds the first hit; the highlight resets when the query changes", async () => {
  await mount();
  const search = byLabel("Cari barang hasil") as HTMLInputElement;
  await set(search, "bolt");
  await key(search, "ArrowDown"); await key(search, "ArrowDown");
  await set(search, "bolt i");
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
  await key(search, "Enter");
  expect(host.querySelector("table[aria-label='Barang terpilih hasil']")!.textContent).toContain("Bolt Ikan 800gr");
});

// ───────────── Salin promo (Andri 5.2) ─────────────
it("'Salin promo' on a saved promo (also an ACTIVE one, without deactivating) creates the copy server-side and opens it in the editor", async () => {
  m.salin.mockResolvedValue({ ok: true, id: "77777777-7777-4777-8777-777777777777", version: V2, active: false });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled(), active: true });
  await click(btn("Salin promo"));
  expect(m.salin).toHaveBeenCalledWith({ id: PID });
  expect(m.router.push).toHaveBeenCalledWith("/crm/promo/paket/77777777-7777-4777-8777-777777777777?salinan=1");
});

it("'Salin promo' failure stays on the page with the Indonesian message; unsaved edits disable it; a brand-new promo has none", async () => {
  m.salin.mockResolvedValue({ ok: false, message: "Salinan gagal: x" });
  await mount({ mode: "ubah", promoId: PID, version: V1, initialForm: filled() });
  await click(btn("Salin promo"));
  expect(alertText()).toContain("Salinan gagal: x");
  expect(m.router.push).not.toHaveBeenCalled();
  await set(q("input[name=nama]")!, "Diubah");
  expect(btn("Salin promo")!.disabled).toBe(true);
  await act(async () => root.unmount()); root = createRoot(host);
  await mount();
  expect(btn("Salin promo")).toBeUndefined();
});
