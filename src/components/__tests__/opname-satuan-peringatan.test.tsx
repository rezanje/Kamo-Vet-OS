// @vitest-environment jsdom
import { act, type FormEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jumlahTakWajar } from "@/lib/opname-jumlah-tak-wajar";

const s = vi.hoisted(() => ({
  sistem: {} as Record<string, number>,
  kunci: [] as [string, number][], simpan: [] as string[], cek: [] as { itemId: string; qty: number }[][],
  cekGagal: false, tahan: null as null | ((v?: unknown) => void),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
// Tiruan PreservedForm: meniru perilaku form action React (onSubmit lebih dulu; dibatalkan = aksi tidak jalan).
vi.mock("@/components/LocalTransactionDraft", () => ({
  PreservedForm: ({ children, onSubmit, action }: { children: ReactNode; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; action: (d: FormData) => void }) =>
    <form onSubmit={(e) => { onSubmit?.(e); if (!e.defaultPrevented) { e.preventDefault(); action(new FormData(e.currentTarget)); } }}>{children}</form>,
  LocalTransactionDraft: () => null,
}));
vi.mock("@/app/(app)/pos/opname/actions", () => ({
  kunciBaris: async (_o: string, id: string, qty: number) => { s.kunci.push([id, qty]); return { ok: true, qtyFisik: qty }; },
  bukaKunci: async () => ({ ok: true }), muatUlangStok: async () => ({ ok: true }),
  simpanHasil: async (f: FormData) => { s.simpan.push(String(f.get("fisik"))); },
  periksaJumlahTakWajar: async (_o: string, baris: { itemId: string; qty: number }[]) => {
    s.cek.push(baris);
    if (s.tahan) await new Promise((r) => { s.tahan = r as never; });
    if (s.cekGagal) return { ok: false, pesan: "Pemeriksaan jumlah belum dapat dipastikan. Coba lagi." };
    return { ok: true, janggal: baris.filter((b) => jumlahTakWajar(b.qty, s.sistem[b.itemId] ?? 0)).map((b) => b.itemId) };
  },
}));
import { HitungForm, type BarisHitung } from "@/app/kasir/opname/[id]/HitungForm";

const baris = (id: string, name: string, unit: string, extra: Partial<BarisHitung> = {}): BarisHitung => ({ item_id: id, code: id.toUpperCase(), name, unit, kategori: "Fiksi", sell_price: 0, ...extra });
const ROWS = [
  baris("th4", "TH4 Disinfektan", "1L"),
  baris("sh", "Shampoo Grooming 3in1 20L", "ML", { turunan: [{ unit: "btl", factor: 500 }] }),
  baris("pk", "Pakan Kucing", "pcs"),
];
let root: Root, host: HTMLDivElement;
let gen = 0; // key baru = layar dimuat ulang (state awal dibaca dari terkunci)
const render = (terkunci: Record<string, number> = {}, rows = ROWS) => act(async () => root.render(<HitungForm key={++gen} orderId="order" rows={rows} terkunci={terkunci} />));
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(s, { sistem: { th4: 1, sh: 0, pk: 40 }, kunci: [], simpan: [], cek: [], cekGagal: false, tahan: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const input = (id: string) => host.querySelector<HTMLInputElement>(`#fisik-${id}`)!;
async function isi(id: string, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), v);
    input(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const tombol = (teks: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === teks)!;
const barisTabel = (id: string) => [...host.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((tr) => tr.cells[0].textContent === id.toUpperCase())!;
async function kunci(id: string) { await act(async () => tombol("Kunci", barisTabel(id)).click()); }
async function simpan() { await act(async () => host.querySelector<HTMLButtonElement>("button[type=submit]")!.click()); }
const dialog = () => host.querySelector<HTMLElement>("[role=alertdialog]");
const tekan = (key: string) => act(async () => { dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

// ---------- 1. satuan besar sejajar dengan isian ----------
it("menulis satuan besar di samping kolom isian dan kalimat 'Isi jumlah fisik dalam <satuan>'", () => {
  const sel = barisTabel("th4").cells[4];
  expect(sel.contains(input("th4"))).toBe(true);
  const badge = sel.querySelector<HTMLElement>("[data-satuan-besar]")!;
  expect(badge.textContent).toBe("1L");
  expect(badge.style.fontSize).toBe("16px");
  expect(badge.parentElement).toBe(input("th4").closest("div")); // satu baris dengan kolom isian
  expect(sel.querySelector("[data-petunjuk-satuan]")!.textContent).toBe("Isi jumlah fisik dalam 1L");
  expect(host.querySelector("[data-awas-satuan]")!.textContent).toContain("Lihat SATUAN");
});
it("baris terkunci tetap menampilkan satuan besar di samping angkanya", async () => {
  await render({ th4: 1 });
  expect(input("th4")).toBeNull();
  expect(barisTabel("th4").cells[4].textContent).toBe("11L");
  expect(barisTabel("th4").cells[4].querySelector("[data-satuan-besar]")!.textContent).toBe("1L");
});

// ---------- 2. isi kemasan ----------
it("menampilkan isi kemasan hanya bila barang punya satuan lain", () => {
  expect(barisTabel("sh").cells[1].querySelector("[data-isi-kemasan]")!.textContent).toBe("Isi kemasan: 1 btl = 500 ML");
  expect(barisTabel("th4").cells[1].querySelector("[data-isi-kemasan]")).toBeNull();
});

// ---------- 3. Kunci per barang ----------
it("1000 vs sistem 1 -> dialog 'Yakin 1.000 1L?'; Periksa lagi TIDAK menyimpan dan mengembalikan fokus ke isian", async () => {
  await isi("th4", "1000"); await kunci("th4");
  expect(dialog()!.textContent).toContain("Yakin 1.000 1L?");
  expect(dialog()!.textContent).toContain("TH4 Disinfektan");
  expect(s.kunci).toEqual([]);
  expect(document.activeElement).toBe(tombol("Periksa lagi", dialog()!));
  await act(async () => tombol("Periksa lagi", dialog()!).click());
  expect(dialog()).toBeNull(); expect(s.kunci).toEqual([]);
  await new Promise((r) => setTimeout(r, 5));
  expect(document.activeElement).toBe(input("th4"));
});
it("dialog tidak membocorkan angka stok sistem pada layar hitung", async () => {
  await isi("th4", "1000"); await kunci("th4");
  expect(dialog()!.textContent).not.toMatch(/Sistem\s*1\b/);
  expect(dialog()!.textContent).toContain("stok sistem");
});
it("Ya, jumlah ini benar -> dikunci sekali dengan angka itu", async () => {
  await isi("th4", "1000"); await kunci("th4");
  await act(async () => tombol("Ya, jumlah ini benar", dialog()!).click());
  expect(dialog()).toBeNull(); expect(s.kunci).toEqual([["th4", 1000]]);
  expect(barisTabel("th4").cells[4].textContent).toBe("10001L");
});
it("Esc membatalkan seperti Periksa lagi", async () => {
  await isi("th4", "1000"); await kunci("th4"); await tekan("Escape");
  expect(dialog()).toBeNull(); expect(s.kunci).toEqual([]);
});
it("Tab berputar di antara dua tombol dialog (papan ketik)", async () => {
  await isi("th4", "1000"); await kunci("th4");
  await tekan("Tab"); expect(document.activeElement).toBe(tombol("Ya, jumlah ini benar", dialog()!));
  await tekan("Tab"); expect(document.activeElement).toBe(tombol("Periksa lagi", dialog()!));
});
it("batas 10x: 11 vs sistem 1 ditandai, tepat 10 tidak", async () => {
  s.sistem.pk = 1;
  await isi("pk", "10"); await kunci("pk");
  expect(dialog()).toBeNull(); expect(s.kunci).toEqual([["pk", 10]]);
  await isi("th4", "11"); await kunci("th4");
  expect(dialog()!.textContent).toContain("Yakin 11 1L?");
});
it("batas >= 1000 vs sistem < 100: 3000 vs sistem 0 dan 1000 vs sistem 99 ditandai", async () => {
  await isi("sh", "3000"); await kunci("sh");
  expect(dialog()!.textContent).toContain("Yakin 3.000 ML?");
  await tekan("Escape");
  s.sistem.pk = 99; await isi("pk", "1000"); await kunci("pk");
  expect(dialog()!.textContent).toContain("Yakin 1.000 pcs?");
});
it("999 vs sistem 0 tidak ditandai; 1000 vs sistem 100 tidak ditandai (sistem tidak kecil)", async () => {
  await isi("sh", "999"); await kunci("sh");
  expect(dialog()).toBeNull(); expect(s.kunci).toEqual([["sh", 999]]);
  s.sistem.pk = 100; await isi("pk", "1000"); await kunci("pk");
  expect(dialog()).toBeNull(); expect(s.kunci.at(-1)).toEqual(["pk", 1000]);
});
it("hitungan normal tidak memunculkan dialog dan langsung terkunci", async () => {
  await isi("pk", "38"); await kunci("pk"); await isi("th4", "1"); await kunci("th4"); await isi("sh", "0"); await kunci("sh");
  expect(dialog()).toBeNull();
  expect(s.kunci).toEqual([["pk", 38], ["th4", 1], ["sh", 0]]);
});
it("galat pemeriksaan server menahan penguncian (tidak menebak lolos)", async () => {
  s.cekGagal = true; await isi("th4", "1000"); await kunci("th4");
  expect(s.kunci).toEqual([]); expect(dialog()).toBeNull(); expect(host.textContent).toContain("Pemeriksaan jumlah belum dapat dipastikan");
});

// ---------- 4. Simpan semua ----------
it("Simpan semua dengan nilai normal langsung menyimpan, tanpa dialog", async () => {
  await isi("pk", "38"); await isi("th4", "1"); await simpan();
  expect(dialog()).toBeNull(); expect(s.simpan).toEqual([JSON.stringify({ th4: 1, pk: 38 })]);
});
it("beberapa barang janggal -> SATU dialog memuat semuanya (hanya yang janggal); Ya menyimpan sekali", async () => {
  await isi("th4", "1000"); await isi("sh", "3000"); await isi("pk", "38"); await simpan();
  const d = dialog()!;
  expect([...d.querySelectorAll("[data-butir-janggal]")].map((x) => x.getAttribute("data-butir-janggal"))).toEqual(["th4", "sh"]);
  expect(d.textContent).toContain("Yakin dengan 2 jumlah ini?");
  expect(s.simpan).toEqual([]);
  await act(async () => tombol("Ya, semua benar", d).click());
  expect(dialog()).toBeNull(); expect(s.simpan).toHaveLength(1);
  expect(JSON.parse(s.simpan[0])).toEqual({ th4: 1000, sh: 3000, pk: 38 });
});
it("sesudah satu konfirmasi dan simpan, angka janggal berikutnya tetap ditanya lagi (izin sekali pakai)", async () => {
  await isi("th4", "1000"); await simpan(); await act(async () => tombol("Ya, jumlah ini benar", dialog()!).click());
  expect(s.simpan).toHaveLength(1);
  await isi("sh", "3000"); await simpan();
  expect(dialog()!.textContent).toContain("Yakin 3.000 ML?");
  expect(s.simpan).toHaveLength(1);
});
it("Batal pada Simpan semua tidak menyimpan; setelah diperbaiki, simpan lolos tanpa dialog", async () => {
  await isi("th4", "1000"); await simpan(); await tekan("Escape");
  expect(s.simpan).toEqual([]);
  await isi("th4", "1"); await simpan();
  expect(dialog()).toBeNull(); expect(s.simpan).toHaveLength(1); expect(JSON.parse(s.simpan[0])).toEqual({ th4: 1 });
});
it("barang yang sudah dikonfirmasi di layar ini tidak ditanya lagi saat Simpan semua", async () => {
  await isi("th4", "1000"); await kunci("th4"); await act(async () => tombol("Ya, jumlah ini benar", dialog()!).click());
  s.cek = []; await simpan();
  expect(dialog()).toBeNull(); expect(s.cek).toEqual([]); expect(s.simpan).toHaveLength(1);
});
it("hitungan terkunci dari sesi lama (sebelum fitur ini) ikut diperiksa saat Simpan semua", async () => {
  await render({ th4: 1000 });
  await simpan();
  expect(dialog()!.textContent).toContain("Yakin 1.000 1L?");
  expect(s.simpan).toEqual([]);
});
it("galat pemeriksaan server menahan Simpan semua", async () => {
  s.cekGagal = true; await isi("pk", "38"); await simpan();
  expect(s.simpan).toEqual([]); expect(host.textContent).toContain("Pemeriksaan jumlah belum dapat dipastikan");
});
it("klik ganda Simpan semua saat pemeriksaan berjalan tidak menggandakan penyimpanan", async () => {
  await isi("pk", "38"); s.tahan = () => {};
  await simpan(); await simpan();
  expect(s.cek).toHaveLength(1);
  await act(async () => { (s.tahan as unknown as () => void)(); });
  expect(s.simpan).toHaveLength(1);
});
it("angka yang diubah saat pemeriksaan berjalan tidak lolos tanpa diperiksa ulang", async () => {
  await isi("pk", "38"); s.tahan = () => {};
  await simpan();
  await isi("pk", "4000");
  await act(async () => { (s.tahan as unknown as () => void)(); });
  expect(s.simpan).toEqual([]); expect(host.textContent).toContain("Isian berubah saat diperiksa");
});
it("Simpan semua kosong tetap nonaktif (alur lama tidak berubah)", () => {
  expect(host.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(true);
});
