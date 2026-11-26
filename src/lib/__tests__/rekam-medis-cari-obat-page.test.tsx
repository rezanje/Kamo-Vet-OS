import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Daftar Rekam Medis + filter "Obat / produk diberikan" (p_obat): parameter RPC, URL/tautan halaman, keping produk yang cocok,
// pesan kosong/galat, dan jalan mundur ke panggilan lama bila database belum punya p_obat.
type Row = Record<string, unknown>;
type Args = Record<string, unknown> & { p_batas: number; p_offset: number };
const s = vi.hoisted(() => ({
  visits: [] as Record<string, unknown>[], cabang: null as string | null,
  rpc: [] as Record<string, unknown>[],
  /** Penjawab RPC bila diisi (mengembalikan {data, error}); bawaan = daftar s.visits. */
  jawab: null as null | ((a: Record<string, unknown>) => { data: unknown; error: unknown }),
}));
vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => {
  const keBaris = (v: Row): Row => ({
    id: v.id, pet_id: v.pet_id, created_at: v.created_at, branch_id: v.branch_id, status: "Selesai", poli: "Poli Umum", keluhan: v.keluhan,
    legacy_source_key: v.legacy_source_key, branches: v.branches, archived_at: null,
    medical_records: [{ id: "m-" + v.id }], inpatient_records: v.inpatient_records,
  });
  const dari = (table: string) => {
    const f: [string, unknown][] = [];
    const q = {
      select() { return q; }, in(k: string, v: unknown) { f.push([k, v]); return q; }, is() { return q; }, order() { return q; }, range() { return q; },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        const rows = table === "visits" ? s.visits.map(keBaris) : table === "medical_records" ? s.visits.map((v) => ({ visit_id: v.id, id: "m-" + v.id })) : [];
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    createClientLintasCabang: async () => ({
      cabangAktif: s.cabang,
      client: {
        from: dari,
        rpc: async (_n: string, a: Args) => {
          s.rpc.push(a);
          if (s.jawab) return s.jawab(a);
          const data = { jumlah: s.visits.length, ringkasan: { riwayat: 500, hewan: 40, impor: 7 }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(a.p_offset, a.p_offset + a.p_batas) };
          return { error: null, data };
        },
      },
    }),
  };
});
import MedicalPage from "../../app/(app)/klinik/rekam-medis/page";

const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";
const baris = (id: string, pet_id: string | null, tanggal: string, o: Record<string, unknown> = {}) => ({
  id, pet_id, branch_id: "b", created_at: tanggal, dokter: "drh", keluhan: "keluhan " + id, legacy_source_key: null,
  pets: { name: "choco", species: "Kucing", breed: null }, customers: { name: "tes", phone: "085845455145" }, branches: { code: "VET_CMGG" },
  medical_records: { diagnosis: "dx " + id, anamnesis: "anamnesa " + id }, inpatient_records: [], ...o,
});
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve(sp) }));
const KUNJUNGAN = { kelompok: "kunjungan" };

beforeEach(() => {
  s.rpc = []; s.cabang = null; s.jawab = null;
  s.visits = [
    baris("v3", P1, "2026-10-31T03:00:00Z", { obat_cocok: [{ nama: "RC Recovery", qty: 3, sumber: "resep" }] }),
    baris("v2", P1, "2026-10-20T03:00:00Z", { obat_cocok: [{ nama: "Icare Can Recovery", qty: 2, sumber: "resep" }, { nama: "RC Recovery", qty: 1, sumber: "tagihan" }] }),
    baris("v1", P2, "2026-10-05T03:00:00Z", { pets: { name: "mochi", species: "Anjing", breed: null }, obat_cocok: [{ nama: "Obat Racik Kapsul", qty: 1, sumber: "racikan" }] }),
  ];
});

describe("panggilan RPC", () => {
  it("tanpa filter obat: argumen PERSIS seperti sebelumnya (tanpa p_obat), tanpa kolom/keping obat, kotak obat kosong", async () => {
    const html = await render(KUNJUNGAN);
    expect(s.rpc).toHaveLength(1);
    expect(Object.keys(s.rpc[0]).sort()).toEqual(["p_batas", "p_cabang", "p_cari", "p_offset", "p_pet", "p_tampilan"]);
    expect(html).not.toContain("Obat / produk diberikan</th>");
    expect(html).not.toContain("data-obat-cocok");
    expect(html).toContain('name="obat"');
    expect(html).toContain("Cari obat / produk diberikan");
    expect(html).toContain("Contoh: RC Recovery");
    expect(html).not.toContain("Hapus filter obat");
  });

  it("filter obat: p_obat dikirim (dipangkas) bersama p_cari, p_tampilan, cabang aktif", async () => {
    s.cabang = "cab-1";
    await render({ ...KUNJUNGAN, obat: "  RC Recovery ", q: "Choco", tampilan: "semua" });
    expect(s.rpc[0]).toMatchObject({ p_obat: "RC Recovery", p_cari: "Choco", p_tampilan: "semua", p_cabang: "cab-1", p_pet: null, p_batas: 50, p_offset: 0 });
  });

  it("hanya spasi/koma = tanpa filter (tidak mengirim p_obat)", async () => {
    for (const obat of ["", "   ", ",", " , , "]) {
      s.rpc = [];
      const html = await render({ ...KUNJUNGAN, obat });
      expect(Object.keys(s.rpc[0])).not.toContain("p_obat");
      expect(html).not.toContain("data-obat-cocok");
    }
  });

  it("Per pasien: kedua bacaan jendela (2 x 200) membawa p_obat", async () => {
    await render({ obat: "recovery" });
    expect(s.rpc).toEqual([expect.objectContaining({ p_obat: "recovery", p_batas: 200, p_offset: 0 }), expect.objectContaining({ p_obat: "recovery", p_batas: 200, p_offset: 200 })]);
  });
});

describe("tampilan Per kunjungan dengan filter obat", () => {
  it("kolom 'Obat / produk diberikan' + keping 'Diberikan: Nama ×qty' (sumber racikan/tagihan diberi keterangan)", async () => {
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).toContain("<th>Obat / produk diberikan</th>");
    expect(html).toContain("Diberikan: RC Recovery ×3");
    expect(html).toContain("Diberikan: Icare Can Recovery ×2");
    expect(html).toContain("Diberikan: RC Recovery ×1 (ditagihkan kasir)");
    expect(html).toContain("Diberikan: Obat Racik Kapsul ×1 (racikan)");
    expect(html).toContain('value="recovery"'); // kotak obat mempertahankan teks
    expect(html).toContain("3 riwayat ditemukan dengan obat/produk “recovery”");
  });

  it("baris tanpa keping (RPC lama/tak lengkap) menampilkan tanda hubung, tidak error", async () => {
    s.visits = [baris("v9", P1, "2026-10-31T03:00:00Z")];
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).toMatch(/data-obat-cocok[^>]*>—<\/td>/);
  });

  it("keping salah bentuk dibuang tanpa merusak halaman", async () => {
    s.visits = [baris("v9", P1, "2026-10-31T03:00:00Z", { obat_cocok: [{ nama: 5 }, "x", null] })];
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).toContain("v9");
    expect(html).not.toContain("Diberikan:");
  });

  it("URL: obat ikut di tautan Per pasien/Per kunjungan, selain-Rawat-Inap/Semua riwayat, paginasi; tombol hapus filter obat tanpa obat", async () => {
    s.visits = Array.from({ length: 120 }, (_, i) => baris("w" + String(i).padStart(3, "0"), P1, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T0${i % 10}:00:00Z`, { obat_cocok: [{ nama: "RC Recovery", qty: 1, sumber: "resep" }] }));
    const html = await render({ ...KUNJUNGAN, obat: "RC Recovery", q: "choco", tampilan: "semua", hal: "2" });
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    const dengan = hrefs.filter((h) => h.startsWith("/klinik/rekam-medis?"));
    expect(dengan.length).toBeGreaterThan(6);
    const hapus = dengan.filter((h) => !h.includes("obat="));
    // Satu-satunya tautan daftar tanpa obat: "Hapus filter obat" (dan "Semua riwayat" yang mereset pencarian).
    expect(hapus.length).toBe(2);
    expect(hapus.some((h) => h.includes("q=choco") && h.includes("tampilan=semua") && h.includes("kelompok=kunjungan"))).toBe(true);
    for (const h of dengan.filter((x) => x.includes("hal="))) expect(h).toContain("obat=RC+Recovery");
    expect(dengan.filter((h) => h.includes("kelompok=pasien") || h.includes("kelompok=kunjungan")).filter((h) => h.includes("obat=RC+Recovery")).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("Hapus filter obat");
    expect(s.rpc.at(-1)).toMatchObject({ p_obat: "RC Recovery", p_offset: 50 });
  });

  it("tidak ada hasil: pesan jelas dengan teks yang dicari", async () => {
    s.visits = [];
    const html = await render({ ...KUNJUNGAN, obat: "zzzz" });
    expect(html).toContain("Tidak ada rekam medis dengan obat/produk “zzzz”");
    expect(html).toContain("Periksa ejaan");
    expect(html).not.toContain("<table");
  });

  it("tanpa filter dan kosong: pesan lama tidak berubah", async () => {
    s.visits = [];
    const html = await render(KUNJUNGAN);
    expect(html).toContain("Belum ada rekam medis yang cocok.");
    expect(html).not.toContain("Tidak ada rekam medis dengan obat");
  });

  it("?pet= (riwayat satu hewan) + obat: tetap per kunjungan dan p_obat ikut", async () => {
    await render({ pet: P1, obat: "recovery" });
    expect(s.rpc[0]).toMatchObject({ p_pet: P1, p_obat: "recovery" });
  });
});

describe("tampilan Per pasien dengan filter obat", () => {
  it("kartu per hewan menjumlahkan keping dari kunjungan yang cocok + tombol 'Buka kunjungan yang cocok'", async () => {
    const html = await render({ obat: "recovery" });
    expect(html).toContain("Diberikan: RC Recovery ×3");   // P1: v3 resep 3
    expect(html).toContain("Diberikan: RC Recovery ×1 (ditagihkan kasir)");
    expect(html).toContain("Diberikan: Icare Can Recovery ×2");
    expect(html).toContain("Diberikan: Obat Racik Kapsul ×1 (racikan)");
    expect(html).toContain("Buka kunjungan yang cocok");
    expect(html).toContain("2 pasien ditemukan (3 kunjungan) dengan obat/produk “recovery”");
    expect(html).toContain("hanya hewan dengan kunjungan yang cocok yang tampil");
  });

  it("tanpa filter obat: kartu tanpa keping dan tombol lama", async () => {
    const html = await render();
    expect(html).not.toContain("Diberikan:");
    expect(html).toContain("Buka terakhir");
    expect(html).not.toContain("Buka kunjungan yang cocok");
  });

  it("per pasien: tidak ada hasil -> pesan kosong obat", async () => {
    s.visits = [];
    const html = await render({ obat: "zzzz" });
    expect(html).toContain("Tidak ada rekam medis dengan obat/produk “zzzz”");
  });
});

describe("masukan tidak sah ditolak sebelum database", () => {
  it.each([
    ["r", "minimal 2 huruf"],
    ["rc recovery, a", "minimal 2 huruf"],
    ["x".repeat(101), "terlalu panjang"],
    ["aa,bb,cc,dd,ee,ff", "Maksimal 5"],
  ])("obat=%j -> galat ramah, RPC tidak dipanggil", async (obat, potongan) => {
    const html = await render({ ...KUNJUNGAN, obat });
    expect(html).toContain('role="alert"');
    expect(html).toContain(potongan);
    expect(s.rpc).toEqual([]);
    expect(html).not.toContain("<table");
  });
});

describe("jalan mundur bila database belum punya p_obat (aplikasi terpasang lebih dulu)", () => {
  const PESAN = "Could not find the function public.daftar_rekam_medis_halaman(p_batas, p_cabang, p_cari, p_obat, p_offset, p_pet, p_tampilan) in the schema cache";
  const lama = (a: Record<string, unknown>) => {
    if ("p_obat" in a) return { data: null, error: { code: "PGRST202", message: PESAN } };
    return { error: null, data: { jumlah: 3, ringkasan: { riwayat: 500, hewan: 40, impor: 7 }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(0, Math.min(3, a.p_batas as number)) } };
  };

  it("pencarian obat: panggilan lama (tanpa p_obat, batas 1) untuk ringkasan; daftar TIDAK disaring dikosongkan + peringatan", async () => {
    s.jawab = lama;
    const html = await render({ ...KUNJUNGAN, obat: "RC Recovery" });
    expect(s.rpc[0]).toMatchObject({ p_obat: "RC Recovery" });
    expect(s.rpc[1]).not.toHaveProperty("p_obat");
    expect(s.rpc[1]).toMatchObject({ p_batas: 1, p_offset: 0 });
    expect(html).toContain("Pencarian obat belum tersedia");
    expect(html).toContain("sengaja dikosongkan");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Belum ada rekam medis yang cocok");
    expect(html).toContain("RIWAYAT TERSIMPAN");
    expect(html).toContain(">500<");
  });

  it("tanpa filter obat database lama tetap normal (panggilan 6 argumen)", async () => {
    s.jawab = lama;
    const html = await render(KUNJUNGAN);
    expect(s.rpc).toHaveLength(1);
    expect(s.rpc[0]).not.toHaveProperty("p_obat");
    expect(html).toContain("<table");
    expect(html).not.toContain("Pencarian obat belum tersedia");
  });

  it("Per pasien + database lama: peringatan, tanpa kartu, tidak error", async () => {
    s.jawab = lama;
    const html = await render({ obat: "recovery" });
    expect(html).toContain("Pencarian obat belum tersedia");
    expect(html).not.toContain("data-pasien=");
  });

  it("galat lain (mis. 57014 batas waktu) pada pencarian obat = gagal tertutup, TANPA jalan mundur", async () => {
    s.jawab = () => ({ data: null, error: { code: "57014", message: "statement timeout" } });
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(s.rpc).toHaveLength(1);
  });

  it("PGRST202 untuk fungsi LAIN tidak dianggap 'p_obat belum ada'", async () => {
    s.jawab = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.fungsi_lain" } });
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).not.toContain("Pencarian obat belum tersedia");
    expect(s.rpc).toHaveLength(1);
  });
});

describe("hak akses tidak berubah", () => {
  it("tombol Perlu dilengkapi/Import tetap ada untuk bukan-STAFF (tampilan saja; hak ubah dijaga database)", async () => {
    const html = await render(KUNJUNGAN);
    expect(html).toContain("Perlu dilengkapi");
    expect(html).toContain("Import rekam medis");
  });
});
