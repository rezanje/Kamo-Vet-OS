// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HasilUbahDokter } from "@/lib/ubah-dokter-pj";

const state = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  reply: null as unknown,
  refresh: vi.fn(),
  throwNext: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh, push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/ubah-dokter-pj-actions", () => ({
  ubahDokterPJ: async (input: Record<string, unknown>) => {
    state.calls.push(input);
    if (state.throwNext) { state.throwNext = false; throw new Error("jaringan putus"); }
    return state.reply;
  },
}));

import { UbahDokterPJ } from "@/components/UbahDokterPJ";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DOKTER = [{ id: "d-aini", nama: "DRH LUTHFIAH RUSYDA AINI", jabatan: "Dokter" }, { id: "d-budi", nama: "Dokter Budi", jabatan: "Dokter" }];
const BERHASIL: HasilUbahDokter = {
  ok: true, pesan: "Dokter PJ diubah dari DRH. ILHAM ke DRH LUTHFIAH RUSYDA AINI. 3 baris yang belum ditagih ikut pindah.", idempotent: false, dokterLamaNama: "DRH. ILHAM",
  dokterBaruNama: "DRH LUTHFIAH RUSYDA AINI", barisDiganti: 3, barisTetapTertagih: 0, barisTetapRacikan: 0, barisTetapLain: 0, barisTetapTakValid: 0,
  tagihanBelumLunasIkut: 0, tagihanLunasTakBerubah: 0, tagihanLunasDigeser: 0,
};

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  state.calls = []; state.reply = BERHASIL; state.refresh.mockClear(); state.throwNext = false;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("crypto", { randomUUID: (() => { let n = 0; return () => `uuid-uji-${++n}`; })() });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const render = (props: Partial<Parameters<typeof UbahDokterPJ>[0]> = {}) =>
  act(() => { root.render(<UbahDokterPJ visitId="visit-1" dokterSekarang="DRH. ILHAM" dokter={DOKTER} {...props} />); });
const q = <T extends Element = HTMLElement>(sel: string) => host.ownerDocument.querySelector<T>(sel);
const ketik = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(() => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
const klik = (el: Element | null) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const kirim = async () => { await act(async () => { q("[data-testid=ubah-dokter-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
const buka = () => klik(q("[data-testid=ubah-dokter-buka]"));

describe("UbahDokterPJ", () => {
  it("tombol tampil; dialog tertutup sampai ditekan; tanpa dokter pilihan tidak ada tombol", () => {
    render();
    expect(q("[data-testid=ubah-dokter-buka]")?.textContent).toContain("Ubah dokter");
    expect(q("[role=dialog]")).toBeNull();
    act(() => root.render(<UbahDokterPJ visitId="v" dokterSekarang={null} dokter={[]} />));
    expect(q("[data-testid=ubah-dokter-buka]")).toBeNull();
  });

  it("dialog memuat dokter sekarang, hanya dokter yang diberikan, centang ikut baris default AKTIF, dan Simpan nonaktif sampai dokter + alasan sah", () => {
    render(); buka();
    const dialog = q("[role=dialog]")!;
    expect(dialog.textContent).toContain("DRH. ILHAM");
    const opsi = [...dialog.querySelectorAll("select option")].map((o) => o.textContent);
    expect(opsi).toEqual(["— Pilih dokter —", "DRH LUTHFIAH RUSYDA AINI", "Dokter Budi"]);
    expect((q("[data-testid=ubah-dokter-ikut]") as HTMLInputElement).checked).toBe(true);
    const simpan = q<HTMLButtonElement>("[data-testid=ubah-dokter-simpan]")!;
    expect(simpan.disabled).toBe(true);
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    expect(simpan.disabled).toBe(true);
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "abcd");
    expect(simpan.disabled).toBe(true);
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "abcde");
    expect(simpan.disabled).toBe(false);
  });

  it("kontrol cukup besar untuk jari: tombol, pilihan, centang dan Simpan setinggi >= 44px / 24px", () => {
    render(); buka();
    expect(q<HTMLElement>("[data-testid=ubah-dokter-buka]")!.style.minHeight).toBe("44px");
    expect(q<HTMLElement>("#ubah-dokter-pilih")!.style.minHeight).toBe("44px");
    expect(q<HTMLElement>("[data-testid=ubah-dokter-simpan]")!.style.minHeight).toBe("44px");
    expect(q<HTMLElement>("[data-testid=ubah-dokter-ikut]")!.style.height).toBe("24px");
  });

  it("Simpan: mengirim kunjungan, dokter, alasan, centang dan kunci; menampilkan hasil, menyegarkan layar, dan mengunci form", async () => {
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "Dokter PJ dan pemberi obat dr. Aini");
    await kirim();
    expect(state.calls).toEqual([{ visitId: "visit-1", doctorId: "d-aini", reason: "Dokter PJ dan pemberi obat dr. Aini", requestKey: "uuid-uji-1", ikutBaris: true, konfirmasiFinal: false }]);
    expect(q("[data-testid=ubah-dokter-hasil]")?.textContent).toContain("3 baris yang belum ditagih ikut pindah");
    expect(q("[data-testid=ubah-dokter-hasil]")?.getAttribute("role")).toBe("status");
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(q("[data-testid=ubah-dokter-simpan]")).toBeNull();
    expect(q("[role=dialog]")?.textContent).toContain("Tutup");
  });

  it("centang dimatikan dikirim sebagai ikutBaris=false", async () => {
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-budi");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    klik(q("[data-testid=ubah-dokter-ikut]"));
    await kirim();
    expect(state.calls[0]).toMatchObject({ doctorId: "d-budi", ikutBaris: false });
  });

  it("penolakan ditampilkan sebagai kalimat (role=alert), layar tidak disegarkan, dan percobaan ulang memakai KUNCI YANG SAMA", async () => {
    state.reply = { ok: false, kode: "CABANG", pesan: "Kunjungan ini di cabang yang tidak dapat Anda akses." } satisfies HasilUbahDokter;
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    await kirim();
    expect(q("[data-testid=ubah-dokter-hasil]")?.textContent).toContain("cabang yang tidak dapat Anda akses");
    expect(q("[data-testid=ubah-dokter-hasil]")?.getAttribute("role")).toBe("alert");
    expect(state.refresh).not.toHaveBeenCalled();
    await kirim();
    expect(state.calls.map((c) => c.requestKey)).toEqual(["uuid-uji-1", "uuid-uji-1"]);
  });

  it("aksi yang melempar (jaringan putus) tetap menampilkan kalimat deterministik, bukan galat umum", async () => {
    state.throwNext = true;
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    await kirim();
    expect(q("[data-testid=ubah-dokter-hasil]")?.textContent).toContain("belum terkonfirmasi");
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("tagihan lunas berbasis dokter kunjungan: kotak konfirmasi Owner muncul HANYA bila database memintanya; Simpan menunggu centang", async () => {
    state.reply = { ok: false, kode: "FINAL", perluKonfirmasi: true, pesan: "Tagihan lunas kunjungan ini mengikuti dokter kunjungan; komisi bulan pelunasan akan berpindah. Centang konfirmasi Owner untuk melanjutkan" } satisfies HasilUbahDokter;
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    expect(q("[data-testid=ubah-dokter-konfirmasi]")).toBeNull();
    await kirim();
    expect(q("[data-testid=ubah-dokter-konfirmasi]")).not.toBeNull();
    expect(q<HTMLButtonElement>("[data-testid=ubah-dokter-simpan]")!.disabled).toBe(true);
    klik(q("[data-testid=ubah-dokter-konfirmasi]"));
    expect(q<HTMLButtonElement>("[data-testid=ubah-dokter-simpan]")!.disabled).toBe(false);
    state.reply = BERHASIL;
    await kirim();
    expect(state.calls.at(-1)).toMatchObject({ konfirmasiFinal: true, requestKey: "uuid-uji-1" });
  });

  it("peran lain (database menjawab 'hanya Owner'): tidak ada kotak konfirmasi, pesan tampil apa adanya", async () => {
    state.reply = { ok: false, kode: "FINAL", pesan: "Tagihan kunjungan ini sudah lunas dan komisinya mengikuti dokter kunjungan; hanya Owner yang dapat mengubah dokternya" } satisfies HasilUbahDokter;
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    await kirim();
    expect(q("[data-testid=ubah-dokter-konfirmasi]")).toBeNull();
    expect(q("[data-testid=ubah-dokter-hasil]")?.textContent).toContain("hanya Owner");
  });

  it("dialog dibuka ulang = kunci baru dan isian bersih; Escape menutup", async () => {
    render(); buka();
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-aini");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan cukup panjang");
    await kirim();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(q("[role=dialog]")).toBeNull();
    buka();
    expect((q("#ubah-dokter-alasan") as HTMLTextAreaElement).value).toBe("");
    ketik(q<HTMLSelectElement>("#ubah-dokter-pilih")!, "d-budi");
    ketik(q<HTMLTextAreaElement>("#ubah-dokter-alasan")!, "alasan lain yang cukup");
    await kirim();
    expect(state.calls.map((c) => c.requestKey)).toEqual(["uuid-uji-1", "uuid-uji-2"]);
  });
});
