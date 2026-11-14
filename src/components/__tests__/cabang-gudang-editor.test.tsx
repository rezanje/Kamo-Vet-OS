// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/perusahaan/cabang/actions", () => ({ ubahCabang: vi.fn(), aturStatusCabang: vi.fn() }));
vi.mock("@/app/(app)/perusahaan/gudang/actions", () => ({ ubahGudang: vi.fn(), aturStatusGudang: vi.fn(), hapusGudang: vi.fn() }));
import { CabangEditor, GudangEditor } from "../CabangGudangEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (label: string) => { await act(async () => button(label)!.click()); };
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const field = (name: string) => host.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | null;

const cabang = { id: "b1", code: "LENGKONG", name: "Hpy Pet Clinic Lengkong", type: "KLINIK", is_active: true };
const gudang = { id: "w1", code: "VET_LENGKONG", name: "VET LENGKONG", type: "VET", is_active: true };

it("cabang: tombol Ubah dan Nonaktifkan ada; form Ubah berisi nama yang bisa diganti, jenis hanya terbaca", async () => {
  await render(<CabangEditor branch={cabang} kodeTerkunci={false} namaLain={["Kamo Pets Clinic Ciawi"]} />);
  expect(button("Nonaktifkan")).toBeTruthy();
  await click("Ubah");
  const nama = field("name") as HTMLInputElement;
  expect(nama.value).toBe("Hpy Pet Clinic Lengkong"); expect(nama.maxLength).toBe(80); expect(nama.required).toBe(true);
  expect(field("type")).toBeNull();
  expect(host.textContent).toContain("Jenis cabang tidak bisa diubah");
  expect((field("id") as HTMLInputElement).value).toBe("b1");
});

it("cabang: kode bisa diubah selama belum dipakai transaksi", async () => {
  await render(<CabangEditor branch={cabang} kodeTerkunci={false} namaLain={[]} />);
  await click("Ubah");
  expect((field("code") as HTMLInputElement).value).toBe("LENGKONG");
  expect(host.textContent).toContain("Kode belum dipakai transaksi");
});

it("cabang: kode terkunci (hanya terbaca, tidak ikut terkirim) dengan catatan alasan bila sudah ada transaksi", async () => {
  await render(<CabangEditor branch={cabang} kodeTerkunci namaLain={[]} />);
  await click("Ubah");
  expect(field("code")).toBeNull();
  const terbaca = [...host.querySelectorAll("input")].find(i => i.value === "LENGKONG")!;
  expect(terbaca.readOnly).toBe(true);
  expect(host.textContent).toContain("Kode tidak bisa diubah");
  expect(host.textContent).toContain("dipakai di laporan");
});

it("cabang: nama kembar memunculkan peringatan dan mematikan Simpan; mengembalikan nama lama tidak dianggap kembar", async () => {
  await render(<CabangEditor branch={cabang} kodeTerkunci={false} namaLain={["Kamo Pets Clinic Ciawi"]} />);
  await click("Ubah");
  await type(field("name") as HTMLInputElement, "kamo pets  clinic ciawi");
  expect(host.textContent).toContain("Nama ini sudah dipakai cabang lain");
  expect(button("Simpan")!.disabled).toBe(true);
  await type(field("name") as HTMLInputElement, "Kamo Pets Clinic Lengkong");
  expect(host.textContent).not.toContain("Nama ini sudah dipakai");
  expect(button("Simpan")!.disabled).toBe(false);
});

it("cabang: Nonaktifkan meminta konfirmasi (form id + status 0); cabang nonaktif menawarkan Aktifkan (status 1)", async () => {
  await render(<CabangEditor branch={cabang} kodeTerkunci={false} namaLain={[]} />);
  await click("Nonaktifkan");
  expect(host.textContent).toContain("Nonaktifkan Hpy Pet Clinic Lengkong?");
  expect((field("is_active") as HTMLInputElement).value).toBe("0");
  expect(host.textContent).toContain("shift kasir terbuka");
  await render(<CabangEditor key="mati" branch={{ ...cabang, is_active: false }} kodeTerkunci={false} namaLain={[]} />);
  await click("Aktifkan");
  expect((field("is_active") as HTMLInputElement).value).toBe("1");
  expect(host.textContent).toContain("Nonaktif");
});

it("gudang belum dipakai: kode dan jenis bisa diubah; OWNER bisa membuka konfirmasi hapus dengan alasan wajib", async () => {
  await render(<GudangEditor warehouse={gudang} role="OWNER" dipakai={false} namaLain={["WH VET CIAW"]} />);
  await click("Ubah");
  expect((field("code") as HTMLInputElement).value).toBe("VET_LENGKONG");
  expect((field("type") as unknown as HTMLSelectElement).value).toBe("VET");
  await click("Hapus");
  const alasan = field("reason") as HTMLTextAreaElement;
  expect(alasan.required).toBe(true); expect(alasan.minLength).toBe(5);
  expect(host.textContent).toContain("Hapus gudang VET LENGKONG (VET_LENGKONG)?");
  expect(button("Ya, hapus gudang")!.disabled).toBe(true);
  await type(alasan, "abc");
  expect(button("Ya, hapus gudang")!.disabled).toBe(true);
  await type(alasan, "Salah buat gudang");
  expect(button("Ya, hapus gudang")!.disabled).toBe(false);
  await click("Batal");
  expect(field("reason")).toBeNull();
});

it("gudang sudah dipakai: kode dan jenis hanya terbaca, Hapus nonaktif dengan alasan 'Sudah dipakai, nonaktifkan saja'", async () => {
  await render(<GudangEditor warehouse={gudang} role="OWNER" dipakai namaLain={[]} />);
  expect(button("Hapus")!.disabled).toBe(true);
  expect(host.textContent).toContain("Sudah dipakai, nonaktifkan saja");
  await click("Ubah");
  expect(field("code")).toBeNull(); expect(field("type")).toBeNull();
  expect(host.textContent).toContain("Kode dan jenis tidak bisa diubah");
  await click("Nonaktifkan");
  expect(host.textContent).toContain("Nonaktifkan VET LENGKONG?");
});

it("gudang: ADMIN melihat Hapus nonaktif dengan alasan hanya OWNER; nama kembar dalam cabang ditolak", async () => {
  await render(<GudangEditor warehouse={gudang} role="ADMIN" dipakai={false} namaLain={["WH VET CIAW"]} />);
  expect(button("Hapus")!.disabled).toBe(true);
  expect(host.textContent).toContain("Hanya OWNER yang bisa menghapus gudang");
  await click("Ubah");
  await type(field("name") as HTMLInputElement, "wh vet ciaw");
  expect(host.textContent).toContain("Nama ini sudah dipakai gudang lain di cabang ini");
  expect(button("Simpan")!.disabled).toBe(true);
});
