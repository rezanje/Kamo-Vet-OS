// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const st = vi.hoisted(() => ({ uploads: [] as { path: string; type: string; opts: unknown }[], removed: [] as string[][], uploadError: null as null | { message: string }, saved: [] as FormData[], saveResult: { ok: true, message: "Identitas cabang tersimpan." } as { ok: boolean; message: string } }));
vi.mock("next/link", () => ({ default: ({ children, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: (b: string) => ({
  upload: async (path: string, f: File, opts: unknown) => { st.uploads.push({ path: `${b}:${path}`, type: f.type, opts }); return { error: st.uploadError }; },
  remove: async (p: string[]) => { st.removed.push(p); return { error: null }; },
}) } }) }));
vi.mock("@/app/(app)/pengaturan/cabang/actions", () => ({ simpanIdentitasCabang: async (_p: unknown, fd: FormData) => { st.saved.push(fd); return st.saveResult; } }));
Object.assign(URL, { createObjectURL: () => "blob:pratinjau", revokeObjectURL: () => undefined });

import { IdentitasCabangForm } from "../IdentitasCabangForm";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  st.uploads = []; st.removed = []; st.uploadError = null; st.saved = []; st.saveResult = { ok: true, message: "Identitas cabang tersimpan." }; });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const branch = { id: ID, code: "VET_CMGG", name: "Kamo Pets Clinic Cimanggu", alamat: null as string | null, telepon: null as string | null, logoUrl: null as string | null };
const render = async (b = branch, bolehKelola = true) => { await act(async () => root.render(<IdentitasCabangForm branch={b} bolehKelola={bolehKelola} />)); };
const setVal = async (el: HTMLInputElement, v: string) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }); };
const pilih = async (f: File) => { const input = container.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(input, "files", { value: [f], configurable: true }); await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); }); };
const hidden = (n: string) => container.querySelector<HTMLInputElement>(`input[name="${n}"]`)!.value;
const kopPratinjau = () => container.querySelector("[data-pratinjau-kop]")!.textContent ?? "";
const berkas = (size: number, type = "image/png", name = "logo.png") => { const f = new File(["x"], name, { type }); Object.defineProperty(f, "size", { value: size }); return f; };

describe("IdentitasCabangForm", () => {
  it("menampilkan nama cabang (tanpa kolom nama ganda), tautan ubah nama, alamat, telepon, logo dan pratinjau kop", async () => {
    await render({ ...branch, alamat: "Jl. Raya 1", telepon: "0251 8888", logoUrl: "https://x.test/l.png" });
    expect(container.textContent).toContain("Kamo Pets Clinic Cimanggu");
    expect(container.querySelector('input[name="name"]')).toBeNull();
    expect(container.querySelector('a[href="/perusahaan/cabang"]')?.textContent).toMatch(/Ubah nama cabang/);
    expect(container.querySelector<HTMLInputElement>('input[name="alamat"]')!.value).toBe("Jl. Raya 1");
    expect(container.querySelector<HTMLInputElement>('input[name="telepon"]')!.value).toBe("0251 8888");
    expect(kopPratinjau()).toContain("Jl. Raya 1 · Telp. 0251 8888");
    expect(container.querySelector("[data-pratinjau-kop] img")?.getAttribute("src")).toBe("https://x.test/l.png");
    expect(hidden("logo_aksi")).toBe("tetap");
  });
  it("pratinjau kop ikut berubah saat mengetik; tanpa isian memakai tagline lama", async () => {
    await render();
    expect(kopPratinjau()).toContain("WE CARE, THEY DESERVE");
    await setVal(container.querySelector<HTMLInputElement>('input[name="alamat"]')!, "Jl. Baru 9");
    expect(kopPratinjau()).toContain("Jl. Baru 9"); expect(kopPratinjau()).not.toContain("WE CARE");
  });
  it("validasi: alamat 2 karakter dan telepon berhuruf menampilkan pesan dan mematikan tombol Simpan", async () => {
    await render();
    const simpan = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Simpan"))!;
    expect(simpan().disabled).toBe(false);
    await setVal(container.querySelector<HTMLInputElement>('input[name="alamat"]')!, "ab");
    expect(container.textContent).toMatch(/Alamat cabang 3 sampai 200/); expect(simpan().disabled).toBe(true);
    await setVal(container.querySelector<HTMLInputElement>('input[name="alamat"]')!, "Jl. Raya 1");
    expect(simpan().disabled).toBe(false);
    await setVal(container.querySelector<HTMLInputElement>('input[name="telepon"]')!, "telp 1");
    expect(container.textContent).toMatch(/Telepon cabang 3 sampai 30/); expect(simpan().disabled).toBe(true);
  });
  it("logo > 1 MB, GIF, atau PDF ditolak di browser tanpa unggah", async () => {
    await render();
    await pilih(berkas(1024 * 1024 + 1)); expect(container.textContent).toMatch(/maksimal 1 MB/);
    await pilih(berkas(100, "image/gif", "a.gif")); expect(container.textContent).toMatch(/PNG, JPG, atau WEBP/);
    await pilih(berkas(100, "application/pdf", "a.pdf")); expect(container.textContent).toMatch(/PNG, JPG, atau WEBP/);
    expect(st.uploads).toEqual([]); expect(hidden("logo_aksi")).toBe("tetap");
  });
  it("logo sah: diunggah ke dokumen/cabang-logo/<id>/ tanpa menimpa; form berisi jalur + aksi ganti; pratinjau memakai logo baru", async () => {
    await render();
    await pilih(berkas(5000));
    expect(st.uploads).toHaveLength(1);
    expect(st.uploads[0].path).toMatch(new RegExp(`^dokumen:cabang-logo/${ID}/\\d+-[a-z0-9]+\\.png$`));
    expect(st.uploads[0].opts).toMatchObject({ upsert: false, contentType: "image/png" });
    expect(hidden("logo_aksi")).toBe("ganti"); expect(hidden("logo_path")).toBe(st.uploads[0].path.replace("dokumen:", ""));
    expect(container.querySelector("[data-pratinjau-kop] img")?.getAttribute("src")).toBe("blob:pratinjau");
  });
  it("memilih logo kedua membersihkan unggahan pertama yang belum disimpan; Batal ganti membersihkan dan kembali", async () => {
    await render();
    await pilih(berkas(5000)); const pertama = st.uploads[0].path.replace("dokumen:", "");
    await pilih(berkas(6000, "image/jpeg", "b.jpg"));
    expect(st.removed).toEqual([[pertama]]); expect(hidden("logo_path")).toMatch(/\.jpg$/);
    const kedua = hidden("logo_path");
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Batal ganti")!.click(); });
    expect(st.removed).toEqual([[pertama], [kedua]]); expect(hidden("logo_aksi")).toBe("tetap"); expect(hidden("logo_path")).toBe("");
  });
  it("unggah gagal (bukan Owner/Admin): pesan jelas, tidak ada aksi ganti", async () => {
    st.uploadError = { message: "new row violates row-level security policy" };
    await render(); await pilih(berkas(5000));
    expect(container.textContent).toMatch(/gagal diunggah/); expect(container.textContent).not.toMatch(/row-level/);
    expect(hidden("logo_aksi")).toBe("tetap");
  });
  it("Hapus logo: hanya muncul bila ada logo; menyetel aksi hapus, pratinjau kembali ke logo cakar; Batal hapus mengembalikan", async () => {
    await render();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Hapus logo")).toBe(false);
    await render({ ...branch, logoUrl: "https://x.test/l.png" });
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Hapus logo")!.click(); });
    expect(hidden("logo_aksi")).toBe("hapus"); expect(container.querySelector("[data-pratinjau-kop] img")).toBeNull();
    expect(container.querySelector("[data-kop-logo-bawaan]")).not.toBeNull();
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Batal hapus")!.click(); });
    expect(hidden("logo_aksi")).toBe("tetap"); expect(container.querySelector("[data-pratinjau-kop] img")).not.toBeNull();
  });
  it("simpan memanggil aksi server dengan isian form dan menampilkan hasilnya", async () => {
    await render({ ...branch, alamat: "Jl. Raya 1" });
    await act(async () => { container.querySelector("form")!.requestSubmit(); });
    expect(st.saved).toHaveLength(1);
    expect(st.saved[0].get("id")).toBe(ID); expect(st.saved[0].get("alamat")).toBe("Jl. Raya 1"); expect(st.saved[0].get("logo_aksi")).toBe("tetap");
    expect(container.textContent).toContain("Identitas cabang tersimpan.");
  });
  it("hasil galat dari server tampil sebagai peringatan", async () => {
    st.saveResult = { ok: false, message: "Hanya Owner atau Admin yang boleh mengubah identitas cabang." };
    await render(); await act(async () => { container.querySelector("form")!.requestSubmit(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Hanya Owner atau Admin/);
  });
  it("tanpa hak kelola (staf): isian terkunci, tanpa tombol simpan/unggah/hapus, tanpa tautan ubah nama", async () => {
    await render({ ...branch, logoUrl: "https://x.test/l.png", alamat: "Jl. Raya 1" }, false);
    expect(container.querySelector<HTMLInputElement>('input[name="alamat"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="telepon"]')!.disabled).toBe(true);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect([...container.querySelectorAll("button")]).toHaveLength(0);
    expect(container.querySelector('a[href="/perusahaan/cabang"]')).toBeNull();
  });
});
