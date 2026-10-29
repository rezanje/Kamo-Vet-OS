import { beforeEach, describe, expect, it, vi } from "vitest";

// Kasir (tambahCustomerKasir) dan CRM (simpanPelanggan) menambah pelanggan lewat SATU RPC atomik
// yang memegang kunci identitas yang sama dengan impor rekam medis dan registrasi klinik. Tes ini
// menjalankan server action ASLI dengan Supabase/redirect diganti, dan memastikan alur lama tetap:
// validasi sama, isian diteruskan apa adanya, nomor terdaftar ditolak dengan pesan yang sama.
// Perilaku database (08/+62, balapan) diuji di scripts/test-impor-rekam-medis-postgres.py.
const s = vi.hoisted(() => ({
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tabel: [] as string[],
  hasil: { status: "dibuat", customer_id: "pelanggan-baru" } as Record<string, unknown> | null,
  rpcError: "",
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT:${url}`), { url }); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpc.push({ name, args });
      return s.rpcError ? { data: null, error: { message: s.rpcError } } : { data: s.hasil, error: null };
    },
    from(table: string) {
      s.tabel.push(table);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain,
        insert: () => { throw new Error("insert langsung ke customers tidak boleh lagi"); },
        single: async () => ({
          data: { id: "pelanggan-baru", name: "Pelanggan Fiktif", phone: "+62 800-0000-001", points: 0, tier: "New", kategori: null },
          error: null,
        }),
      });
      return q;
    },
  }),
}));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "cabang" }) }));
vi.mock("@/lib/tutup-shift", () => ({ bacaShift: async () => null, tutupShift: async () => null }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));

import { tambahCustomerKasir } from "@/app/kasir/actions";
import { simpanPelanggan } from "@/app/(app)/crm/pelanggan/baru/actions";

function form(isi: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(isi)) data.set(k, v);
  return data;
}

const lengkap = {
  nama: "  Pelanggan Fiktif ", phone: " +62 800-0000-001 ", email: "fiktif@contoh.test", dob: "2000-01-02",
  alamat: " Jl. Fiktif ", pekerjaan: "Pegawai", sumber_info: "Instagram", catatan: "Catatan fiktif",
};

async function redirectDari(jalan: Promise<unknown>) {
  try {
    await jalan;
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  return "tidak redirect";
}

beforeEach(() => {
  s.rpc = [];
  s.tabel = [];
  s.hasil = { status: "dibuat", customer_id: "pelanggan-baru" };
  s.rpcError = "";
});

describe("Kasir: tambahCustomerKasir", () => {
  it("meneruskan isian apa adanya (sudah dirapikan seperti dulu) ke RPC atomik lalu mengembalikan baris pelanggan", async () => {
    const hasil = await tambahCustomerKasir(form(lengkap));
    expect(s.rpc).toEqual([{ name: "pelanggan_baru_atomik", args: {
      p_name: "Pelanggan Fiktif", p_phone: "+62 800-0000-001", p_email: "fiktif@contoh.test", p_dob: "2000-01-02",
      p_address: "Jl. Fiktif", p_pekerjaan: "Pegawai", p_sumber_info: "Instagram", p_catatan: "Catatan fiktif",
    } }]);
    expect(hasil).toEqual({ ok: true, customer: {
      id: "pelanggan-baru", name: "Pelanggan Fiktif", phone: "+62 800-0000-001", points: 0, tier: "New", kategori: null, trx: 0, belanja: 0,
    } });
  });

  it("isian opsional kosong tetap null seperti dulu", async () => {
    await tambahCustomerKasir(form({ nama: "Pelanggan Fiktif", phone: "0800000001" }));
    expect(s.rpc[0].args).toMatchObject({ p_email: null, p_dob: null, p_address: null, p_pekerjaan: null, p_sumber_info: null, p_catatan: null });
  });

  it("nomor yang sudah terdaftar (termasuk 08 vs +62) ditolak dengan pesan yang sama seperti dulu", async () => {
    s.hasil = { status: "terdaftar" };
    expect(await tambahCustomerKasir(form(lengkap))).toEqual({ ok: false, error: "No HP sudah terdaftar" });
    expect(s.tabel).toEqual([]);
  });

  it("validasi lama tetap di depan: tanpa nama/HP atau HP asal tidak memanggil database", async () => {
    expect(await tambahCustomerKasir(form({ nama: "", phone: "0800000001" }))).toEqual({ ok: false, error: "Nama dan No. HP wajib diisi" });
    expect((await tambahCustomerKasir(form({ nama: "Fiktif", phone: "0" }))).ok).toBe(false);
    expect(s.rpc).toEqual([]);
  });

  it("galat database diteruskan sebagai pesan, tanpa insert langsung", async () => {
    s.rpcError = "new row violates row-level security policy";
    expect(await tambahCustomerKasir(form(lengkap))).toEqual({ ok: false, error: "new row violates row-level security policy" });
  });
});

describe("CRM: simpanPelanggan", () => {
  it("meneruskan isian termasuk NPWP ke RPC atomik lalu kembali ke daftar pelanggan", async () => {
    expect(await redirectDari(simpanPelanggan(form({ ...lengkap, npwp: " 01.234.567.8-901.000 " })))).toBe("/crm/pelanggan?success=cust");
    expect(s.rpc).toEqual([{ name: "pelanggan_baru_atomik", args: {
      p_name: "Pelanggan Fiktif", p_phone: "+62 800-0000-001", p_email: "fiktif@contoh.test", p_dob: "2000-01-02",
      p_address: "Jl. Fiktif", p_pekerjaan: "Pegawai", p_sumber_info: "Instagram", p_catatan: "Catatan fiktif",
      p_npwp: "01.234.567.8-901.000",
    } }]);
    expect(s.tabel).toEqual([]);
  });

  it("nomor yang sudah terdaftar ditolak dengan pesan yang sama seperti dulu", async () => {
    s.hasil = { status: "terdaftar" };
    expect(await redirectDari(simpanPelanggan(form(lengkap)))).toBe(`/crm/pelanggan/baru?error=${encodeURIComponent("No HP sudah terdaftar")}`);
  });

  it("validasi lama tetap di depan dan galat database diteruskan", async () => {
    expect(await redirectDari(simpanPelanggan(form({ nama: "", phone: "" })))).toBe(`/crm/pelanggan/baru?error=${encodeURIComponent("Nama dan No. HP wajib diisi")}`);
    expect(s.rpc).toEqual([]);
    s.rpcError = "Silakan masuk ulang";
    expect(await redirectDari(simpanPelanggan(form(lengkap)))).toBe(`/crm/pelanggan/baru?error=${encodeURIComponent("Silakan masuk ulang")}`);
  });
});
