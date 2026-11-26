import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KopCabang } from "@/components/KopCabang";
import { RekamMedisKop } from "@/components/RekamMedisKop";
import { bacaIdentitasKop } from "@/lib/cabang-identitas-server";
import type { SupabaseClient } from "@supabase/supabase-js";

const BR = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const LOGO = `cabang-logo/${BR}/1700000000000-ab12cd34.png`;
const html = (p: React.ComponentProps<typeof KopCabang>) => renderToStaticMarkup(<KopCabang {...p} />);

describe("KopCabang (kop bersama invoice dan dokumen klinik)", () => {
  it("lengkap: logo, nama, 'alamat · Telp. telepon'", () => {
    const h = html({ nama: "Cabang A", alamat: "Jl. A 1", telepon: "0251 1", logoUrl: "https://x.test/l.png" });
    expect(h).toContain('src="https://x.test/l.png"'); expect(h).toContain("Cabang A"); expect(h).toContain("Jl. A 1 · Telp. 0251 1");
    expect(h).not.toContain("data-kop-logo-bawaan");
  });
  it("tanpa logo: logo cakar; tanpa alamat/telepon dan tanpa tagline: baris kontak tidak ada sama sekali", () => {
    const h = html({ nama: "Cabang A", alamat: " ", telepon: null });
    expect(h).toContain("data-kop-logo-bawaan"); expect(h).not.toContain("data-kop-kontak"); expect(h).not.toContain("data-kop-tagline");
  });
  it("tagline hanya muncul bila diberikan dan kontak kosong", () => {
    expect(html({ nama: "A", tagline: "T-LINE" })).toContain("T-LINE");
    expect(html({ nama: "A", alamat: "Jl. A", tagline: "T-LINE" })).not.toContain("T-LINE");
  });
  it("ukuran dan warna nama dapat diatur pemanggil; logo selalu 46x46", () => {
    const h = html({ nama: "A", ukuranNama: 20, warnaNama: "#141413", logoUrl: "https://x.test/l.png" });
    expect(h).toContain("font-size:20px"); expect(h).toContain("color:#141413"); expect(h).toContain("width:46px;height:46px");
  });
  it("ukuran baris kontak: bawaan 8.5px (sama dengan rekam medis), dapat diperbesar oleh invoice", () => {
    expect(html({ nama: "A", alamat: "Jl. A" })).toContain("font-size:8.5px");
    expect(html({ nama: "A", alamat: "Jl. A", ukuranKontak: 10 })).toContain("font-size:10px");
  });
  it("RekamMedisKop tetap memakai cadangan nama + tagline yang sama seperti sebelumnya", () => {
    const h = renderToStaticMarkup(<RekamMedisKop nama="  " />);
    expect(h).toContain("KAMO PET CARE"); expect(h).toContain("WE CARE, THEY DESERVE"); expect(h).toContain("font-size:16px");
  });
});

type Hasil = { data: unknown; error?: unknown };
function fake(opts: { branches?: Hasil | "throw"; sign?: Hasil | "throw" }) {
  const calls = { eq: [] as string[], signed: [] as string[] };
  const client = {
    from: () => ({ select: () => ({ eq: (c: string, v: string) => { calls.eq.push(`${c}=${v}`); return { maybeSingle: async () => { if (opts.branches === "throw") throw new Error("boom"); return opts.branches ?? { data: null }; } }; } }) }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => { calls.signed.push(p); if (opts.sign === "throw") throw new Error("boom"); return opts.sign ?? { data: { signedUrl: "https://s.test/x" } }; } }) },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("bacaIdentitasKop (satu aturan untuk semua dokumen klinik)", () => {
  it("tanpa branchId: tidak membaca apa pun", async () => {
    const f = fake({}); const spy = vi.spyOn(f.client, "from");
    for (const id of [null, undefined, ""]) expect(await bacaIdentitasKop(f.client, id)).toEqual({ alamat: null, telepon: null, logoUrl: null });
    expect(spy).not.toHaveBeenCalled();
  });
  it("lengkap: alamat, telepon, tautan logo bertanda tangan 1 jam dari cabang yang diminta", async () => {
    const f = fake({ branches: { data: { alamat: "Jl. A 1", telepon: "0251 1", logo_path: LOGO } } });
    expect(await bacaIdentitasKop(f.client, BR)).toEqual({ alamat: "Jl. A 1", telepon: "0251 1", logoUrl: "https://s.test/x" });
    expect(f.calls.eq).toEqual([`id=${BR}`]); expect(f.calls.signed).toEqual([LOGO]);
  });
  it("jalur logo cabang lain atau tidak sah tidak ditandatangani", async () => {
    for (const logo_path of ["cabang-logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.png", "komplain/1-x.png", `cabang-logo/${BR}/../x.png`, `cabang-logo/${BR}/x.exe`]) {
      const f = fake({ branches: { data: { alamat: "Jl. A 1", telepon: null, logo_path } } });
      expect((await bacaIdentitasKop(f.client, BR)).logoUrl).toBeNull(); expect(f.calls.signed).toEqual([]);
    }
  });
  it("gagal tautan logo (galat/lempar/tanpa url): logo kosong, alamat dan telepon tetap", async () => {
    for (const sign of ["throw", { data: null, error: { message: "x" } }, { data: { signedUrl: "" } }] as const) {
      const f = fake({ branches: { data: { alamat: "Jl. A 1", telepon: "0251 1", logo_path: LOGO } }, sign });
      expect(await bacaIdentitasKop(f.client, BR)).toEqual({ alamat: "Jl. A 1", telepon: "0251 1", logoUrl: null });
    }
  });
  it("gagal baca atau bentuk data aneh: semuanya kosong, tidak pernah melempar", async () => {
    for (const branches of ["throw", { data: null, error: { message: "x" } }, { data: [] }, { data: "teks" }, { data: { alamat: 5, telepon: {}, logo_path: 7 } }] as const) {
      expect(await bacaIdentitasKop(fake({ branches }).client, BR)).toEqual({ alamat: null, telepon: null, logoUrl: null });
    }
    expect(await bacaIdentitasKop({} as unknown as SupabaseClient, BR)).toEqual({ alamat: null, telepon: null, logoUrl: null });
  });
});
