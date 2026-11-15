// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a> }));
import { FollowUpPelanggan, type CatatFn } from "../FollowUpPelanggan";
import { FILTER_AWAL, type BarisFollowUp, type FilterFollowUp, type HasilDaftar } from "@/lib/marketing-followup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); nav.refresh.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const baris = (o: Partial<BarisFollowUp> = {}): BarisFollowUp => ({
  customer_id: "c1", pet_id: null, nama: "Budi Santoso", hp: "0812-3456-7890", wa: "6281234567890", hewan: ["Mochi"], hewan_total: 1, cabang_id: "b1", cabang: "Kamo Pets Clinic Ciawi",
  terakhir: "2026-08-01T03:00:00Z", jenis_terakhir: "Klinik", total_belanja: 250000, kunjungan: 3, hari: 106, sumber: null, jadwal: null, groomer: null, item: null, dihubungi: null, ...o,
});
const data = (o: Partial<HasilDaftar> = {}): HasilDaftar => ({
  tab: "lama", hari_ini: "2026-11-15", periode: 90, interval: 30, depan: 0, cooldown: 14, status: "belum", total: 2, ditampilkan: 2, belum: 2, sudah: 1,
  bucket: { "60": 5, "90": 2, "180": 1 }, cabang: [{ id: "b1", nama: "Kamo Pets Clinic Ciawi", jumlah: 1 }, { id: null, nama: null, jumlah: 1 }],
  tanpa_nomor: 0, dikecualikan: { kunjungan_belum_selesai: 0, hewan_tiada: 0, disembunyikan: 0 }, riwayat_belanja_mulai: "2026-11-01",
  baris: [baris(), baris({ customer_id: "c2", nama: "Ani", hp: "0813", wa: "6281300000001", cabang_id: null, cabang: null, total_belanja: 0, kunjungan: 12, hari: 400 })], ...o,
});
const filter = (o: Partial<FilterFollowUp> = {}): FilterFollowUp => ({ ...FILTER_AWAL, ...o });
const render = async (d: HasilDaftar, f = filter(), opsi: { unduh?: boolean; catat?: Mock<CatatFn> } = {}) => {
  const catat = opsi.catat ?? vi.fn<CatatFn>(async () => ({ ok: true, sudahAda: false }));
  await act(async () => root.render(<FollowUpPelanggan data={d} filter={f} bolehUnduh={opsi.unduh ?? true} catat={catat} />));
  return catat;
};
const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...host.querySelectorAll(sel)] as HTMLElement[];
const button = (label: string) => qa("button").find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const pilih = async (el: HTMLSelectElement, v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("change", { bubbles: true })); }); };
const ketik = async (el: HTMLTextAreaElement, v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }); };
const kirimForm = async () => { await act(async () => { (q("[data-dialog-kontak] form") as HTMLFormElement).requestSubmit(); }); };

describe("tab dan saringan", () => {
  it("empat tab bertaut ke saringan yang sama dan menandai tab aktif; label mengikuti permintaan", async () => {
    await render(data());
    const tabs = qa("nav.fu-tabs a");
    expect(tabs.map(a => a.textContent)).toEqual(["Lama tidak balik", "Grooming", "Hari ini", "Pelanggan baru"]);
    expect(tabs[0].getAttribute("aria-current")).toBe("page");
    expect(tabs[1].getAttribute("href")).toBe("/crm/follow-up?tab=grooming");
  });
  it("saringan: cabang (dengan jumlah, termasuk tanpa cabang), periode 60/90/180, status, cari; GET ke halaman yang sama", async () => {
    await render(data());
    const form = q("form[data-saringan]") as HTMLFormElement;
    expect(form.method).toBe("get");
    expect(form.getAttribute("action")).toBe("/crm/follow-up");
    expect(qa("#fu-cabang option").map(o => o.textContent)).toEqual(["Semua cabang", "Kamo Pets Clinic Ciawi (1)", "Tanpa cabang (riwayat impor) (1)"]);
    expect(qa("#fu-hari option").map(o => o.getAttribute("value"))).toEqual(["60", "90", "180"]);
    expect(qa("#fu-hari option").map(o => o.textContent)).toEqual(["60 hari lalu (5)", "90 hari lalu (2)", "180 hari lalu (1)"]);
    expect(qa("#fu-status option").map(o => o.textContent)).toEqual(["Belum dihubungi", "Sudah dihubungi", "Semua"]);
    expect(q("#fu-cari")).toBeTruthy();
    expect(q("#fu-interval")).toBeNull();
    expect((q('input[name="tab"]') as HTMLInputElement).value).toBe("lama");
  });
  it("tab Grooming menampilkan jarak 21/30/45 dan jadwal ke depan, bukan periode", async () => {
    await render(data({ tab: "grooming" }), filter({ tab: "grooming" }));
    expect(qa("#fu-interval option").map(o => o.getAttribute("value"))).toEqual(["21", "30", "45"]);
    expect(q("#fu-depan")).toBeTruthy(); expect(q("#fu-hari")).toBeNull();
  });
  it("tab Hari ini punya tautan ke daftar Follow up klinik; Grooming ke Jadwal Anabul (tidak menggandakan halaman lama)", async () => {
    await render(data({ tab: "hari_ini" }), filter({ tab: "hari_ini" }));
    expect(qa("a").some(a => a.getAttribute("href") === "/klinik/follow-up")).toBe(true);
    await render(data({ tab: "grooming" }), filter({ tab: "grooming" }));
    expect(qa("a").some(a => a.getAttribute("href") === "/laporan/jadwal-anabul")).toBe(true);
  });
});

describe("daftar kartu (nyaman di HP)", () => {
  it("satu kartu per pelanggan dalam grid kartu, dikelompokkan per cabang dengan 'Tanpa cabang' paling akhir", async () => {
    await render(data());
    expect(qa("[data-kartu]").length).toBe(2);
    expect(q(".fu-grid")).toBeTruthy();
    expect(qa("section[data-cabang]").map(s => s.getAttribute("data-cabang"))).toEqual(["Kamo Pets Clinic Ciawi", "Tanpa cabang (riwayat impor)"]);
    const kartu = qa("[data-kartu]")[0].textContent!;
    for (const teks of ["Budi Santoso", "0812-3456-7890", "Mochi", "Terakhir datang", "1 Agu 2026", "106 hari lalu", "Total belanja", "Rp 250.000", "Kunjungan", "3×", "Belum dihubungi"]) expect(kartu, teks).toContain(teks);
  });
  it("tombol Buka WhatsApp = tautan wa.me biasa (tab baru, tanpa kirim otomatis), nomor 62 dan pesan di-encode", async () => {
    await render(data());
    const a = qa("a").find(x => x.textContent?.includes("Buka WhatsApp")) as HTMLAnchorElement;
    expect(a.getAttribute("target")).toBe("_blank"); expect(a.getAttribute("rel")).toContain("noopener");
    const url = new URL(a.href);
    expect(url.origin + url.pathname).toBe("https://wa.me/6281234567890");
    expect(url.searchParams.get("text")).toContain("Halo Kak Budi Santoso");
    expect(url.searchParams.get("text")).toContain("Mochi");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(qa("a").filter(x => x.textContent?.includes("Buka WhatsApp")).length).toBe(2);
  });
  it("status sudah dihubungi tampil dengan hasil, hari, siapa, dan catatan", async () => {
    const d = data({ baris: [baris({ dihubungi: { at: "2026-11-12T03:00:00Z", hasil: "Tertarik", catatan: "minta jadwal Sabtu", oleh: "Uji Admin", sudah: true, hari_lalu: 3 } })], total: 1, cabang: [{ id: "b1", nama: "Kamo Pets Clinic Ciawi", jumlah: 1 }] });
    await render(d, filter({ status: "semua" }));
    const teks = q("[data-status-hubung]")!.textContent!;
    for (const t of ["Sudah dihubungi", "Tertarik", "3 hari lalu", "Uji Admin", "minta jadwal Sabtu"]) expect(teks, t).toContain(t);
    expect(q("[data-kartu]")!.getAttribute("data-sudah")).toBe("true");
  });
  it("kosong: pesan sesuai keadaan (saringan, semua sudah, tidak ada)", async () => {
    await render(data({ baris: [], total: 0, belum: 0, sudah: 4, cabang: [] }));
    expect(q("[data-kosong]")!.textContent).toBe("Semua sudah dihubungi. Aman.");
    await render(data({ baris: [], total: 0, belum: 0, sudah: 0, cabang: [] }), filter({ cari: "zzz" }));
    expect(q("[data-kosong]")!.textContent).toContain("cocok dengan saringan");
    await render(data({ baris: [], total: 0, belum: 0, sudah: 0, cabang: [] }));
    expect(q("[data-kosong]")!.textContent).toBe("Tidak ada pelanggan di daftar ini.");
    expect(qa("[data-kartu]").length).toBe(0);
  });
  it("ringkasan: jumlah, tanpa nomor (tidak ditampilkan), dikecualikan; banner riwayat belanja sejak 1 Nov", async () => {
    await render(data({ tanpa_nomor: 3, dikecualikan: { kunjungan_belum_selesai: 2, hewan_tiada: 1, disembunyikan: 8 } }));
    const r = q("[data-ringkas]")!.textContent!;
    expect(r).toContain("2 pelanggan"); expect(r).toContain("2 belum dihubungi"); expect(r).toContain("1 sudah");
    expect(q("[data-tanpa-nomor]")!.textContent).toContain("3 tanpa nomor HP yang sah");
    expect(r).toContain("2 kunjungan belum selesai"); expect(r).toContain("1 hewan sudah tiada");
    expect(q("[data-banner-riwayat]")!.textContent).toContain("Riwayat belanja rinci baru ada sejak 1 Nov 2026; pengingat lebih akurat seiring waktu.");
    await render(data({ tab: "hari_ini" }), filter({ tab: "hari_ini" }));
    expect(q("[data-banner-riwayat]")).toBeNull();
  });
  it("batas tampilan per cabang diberitahukan", async () => {
    await render(data({ total: 300, cabang: [{ id: "b1", nama: "Kamo Pets Clinic Ciawi", jumlah: 300 }, { id: null, nama: null, jumlah: 1 }] }));
    expect(q("section[data-cabang]")!.textContent).toContain("Menampilkan 1 teratas dari 300");
  });
  it("grooming: satu pemilik dengan dua hewan = satu kartu, satu tombol WhatsApp", async () => {
    const d = data({ tab: "grooming", baris: [
      baris({ pet_id: "p1", hewan: ["Mimi"], hari: 10, terakhir: "2026-10-05T03:00:00Z", sumber: "belanja", groomer: "Groomer Satu" }),
      baris({ pet_id: "p2", hewan: ["Kiki"], hari: 3, terakhir: "2026-10-12T03:00:00Z", sumber: "riwayat kunjungan" }),
    ], total: 2, cabang: [{ id: "b1", nama: "Kamo Pets Clinic Ciawi", jumlah: 2 }] });
    await render(d, filter({ tab: "grooming", status: "semua" }));
    expect(qa("[data-kartu]").length).toBe(1);
    const t = q("[data-kartu]")!.textContent!;
    for (const x of ["Mimi", "Kiki", "Groomer Satu", "belanja", "riwayat kunjungan", "terlewat 10 hari", "terlewat 3 hari"]) expect(t, x).toContain(x);
    expect(qa("a").filter(x => x.textContent?.includes("Buka WhatsApp")).length).toBe(1);
  });
  it("hari ini: jadwal per hewan dalam satu kartu pemilik", async () => {
    const d = data({ tab: "hari_ini", baris: [baris({ hari: 2, jadwal: "2026-11-13", item: [
      { jenis: "Vaksin", tanggal: "2026-11-13", catatan: null, hewan: "Bb" }, { jenis: "Kontrol", tanggal: "2026-11-15", catatan: "cek luka", hewan: "Aa" }] })], total: 1,
      cabang: [{ id: "b1", nama: "Kamo Pets Clinic Ciawi", jumlah: 1 }] });
    await render(d, filter({ tab: "hari_ini" }));
    const t = q("[data-kartu]")!.textContent!;
    for (const x of ["Vaksin", "Kontrol", "Aa", "Bb", "cek luka", "terlewat 2 hari"]) expect(t, x).toContain(x);
  });
  it("Unduh Excel hanya muncul untuk yang boleh dan membawa saringan saat ini", async () => {
    await render(data(), filter({ hari: 180, status: "semua", cari: "bud" }), { unduh: true });
    expect(q("a[data-unduh]")!.getAttribute("href")).toBe("/crm/follow-up/unduh?tab=lama&hari=180&status=semua&cari=bud");
    await render(data(), filter(), { unduh: false });
    expect(q("a[data-unduh]")).toBeNull();
  });
  it("nomor tidak sah pada baris: tidak ada tombol WhatsApp, ada keterangan", async () => {
    await render(data({ baris: [baris({ wa: null, hp: "123" })], total: 1, cabang: [{ id: "b1", nama: "X", jumlah: 1 }] }));
    expect(qa("a").some(a => a.textContent?.includes("Buka WhatsApp"))).toBe(false);
    expect(q("[data-kartu]")!.textContent).toContain("Nomor tidak sah");
  });
});

describe("dialog Sudah dihubungi", () => {
  it("tombol membuka dialog dengan hasil + catatan; Simpan tanpa hasil ditolak tanpa memanggil server", async () => {
    const catat = await render(data());
    await act(async () => { button("Sudah dihubungi")!.click(); });
    expect(q("[data-dialog-kontak]")).toBeTruthy();
    expect(qa("#fu-hasil option").map(o => o.textContent)).toEqual(["Pilih hasil…", "Tertarik", "Tidak diangkat", "Nanti", "Tidak berminat", "Nomor salah"]);
    expect(q("#fu-catatan")).toBeTruthy();
    await kirimForm();
    expect(q("[data-galat-dialog]")!.textContent).toBe("Pilih hasil menghubungi.");
    expect(catat).not.toHaveBeenCalled();
  });
  it("catatan lebih dari 500 huruf ditolak; pas 500 diterima", async () => {
    const catat = await render(data());
    await act(async () => { button("Sudah dihubungi")!.click(); });
    await pilih(q("#fu-hasil") as HTMLSelectElement, "Nanti");
    await ketik(q("#fu-catatan") as HTMLTextAreaElement, "x".repeat(501));
    await kirimForm();
    expect(q("[data-galat-dialog]")!.textContent).toBe("Catatan maksimal 500 huruf.");
    expect(catat).not.toHaveBeenCalled();
    await ketik(q("#fu-catatan") as HTMLTextAreaElement, "x".repeat(500));
    await kirimForm();
    expect(catat).toHaveBeenCalledTimes(1);
  });
  it("simpan sah: server dipanggil dengan pelanggan, jenis, cabang, hasil, catatan dan kunci; dialog menutup dan daftar dimuat ulang", async () => {
    const catat = await render(data());
    await act(async () => { button("Sudah dihubungi")!.click(); });
    await pilih(q("#fu-hasil") as HTMLSelectElement, "Tertarik");
    await ketik(q("#fu-catatan") as HTMLTextAreaElement, "minta jadwal Sabtu");
    await kirimForm();
    expect(catat).toHaveBeenCalledTimes(1);
    const arg = catat.mock.calls[0][0];
    expect(arg).toMatchObject({ customerId: "c1", petId: null, tab: "lama", cabangId: "b1", hasil: "Tertarik", catatan: "minta jadwal Sabtu" });
    expect(arg.kunci).toMatch(/^[0-9a-f-]{36}$/);
    expect(q("[data-dialog-kontak]")).toBeNull();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
  it("galat dari server ditampilkan di dialog dan dialog tetap terbuka (tanpa refresh)", async () => {
    const catat = vi.fn<CatatFn>(async () => ({ ok: false, pesan: "Cabang ini tidak boleh Anda akses." }));
    await render(data(), filter(), { catat });
    await act(async () => { button("Sudah dihubungi")!.click(); });
    await pilih(q("#fu-hasil") as HTMLSelectElement, "Nanti");
    await kirimForm();
    expect(q("[data-galat-dialog]")!.textContent).toBe("Cabang ini tidak boleh Anda akses.");
    expect(q("[data-dialog-kontak]")).toBeTruthy(); expect(nav.refresh).not.toHaveBeenCalled();
  });
  it("kartu dengan dua hewan mencatat satu per hewan dengan kunci berbeda; Batal menutup tanpa menyimpan", async () => {
    const d = data({ tab: "grooming", baris: [baris({ pet_id: "p1", hewan: ["Mimi"], hari: 10 }), baris({ pet_id: "p2", hewan: ["Kiki"], hari: 3 })], total: 2, cabang: [{ id: "b1", nama: "X", jumlah: 2 }] });
    const catat = await render(d, filter({ tab: "grooming" }));
    await act(async () => { button("Sudah dihubungi")!.click(); });
    await act(async () => { button("Batal")!.click(); });
    expect(q("[data-dialog-kontak]")).toBeNull(); expect(catat).not.toHaveBeenCalled();
    await act(async () => { button("Sudah dihubungi")!.click(); });
    await pilih(q("#fu-hasil") as HTMLSelectElement, "Tidak diangkat");
    await kirimForm();
    expect(catat).toHaveBeenCalledTimes(2);
    const [a, b] = catat.mock.calls.map(c => c[0]);
    expect([a.petId, b.petId]).toEqual(["p1", "p2"]); expect(a.kunci).not.toBe(b.kunci); expect(a.tab).toBe("grooming");
  });
});
