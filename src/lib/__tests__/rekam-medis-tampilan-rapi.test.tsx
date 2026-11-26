import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Daftar Rekam Medis, tampilan rapi (keluhan Andri 26 Nov: "terlalu ramai"): pencarian paling atas, ringkasan satu baris,
// pilihan tampilan ringkas, penjelasan panjang pindah ke "Cara membaca daftar". Tidak ada perubahan perilaku/data.
type Row = Record<string, unknown>;
const s = vi.hoisted(() => ({
  visits: [] as Record<string, unknown>[], rpc: [] as Record<string, unknown>[], cabang: null as string | null,
  jawab: null as null | ((a: Record<string, unknown>) => unknown), role: "OWNER",
}));
vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => {
  const keBaris = (v: Row): Row => ({
    id: v.id, pet_id: v.pet_id, created_at: v.created_at, branch_id: v.branch_id, status: "Selesai", poli: "Poli Umum", keluhan: v.keluhan,
    legacy_source_key: v.legacy_source_key, branches: v.branches, archived_at: null, medical_records: [{ id: "m-" + v.id }], inpatient_records: v.inpatient_records,
  });
  const dari = (table: string) => {
    const q = {
      select() { return q; }, in() { return q; }, is() { return q; }, order() { return q; }, range() { return q; },
      eq() { return q; },
      maybeSingle: async () => ({ data: table === "profiles" ? { role: s.role } : null, error: null }),
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        const rows = table === "visits" ? s.visits.map(keBaris) : [];
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
        auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
        rpc: async (_n: string, a: { p_batas: number; p_offset: number }) => {
          s.rpc.push(a);
          if (s.jawab) return s.jawab(a);
          const data = { jumlah: s.visits.length, ringkasan: { riwayat: 8438, hewan: 4996, impor: 7906 }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(a.p_offset, a.p_offset + a.p_batas) };
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
/** Isi blok "Cara membaca daftar" dan halaman TANPA blok itu. */
const bagi = (html: string) => {
  const a = html.indexOf("<details"), b = html.indexOf("</details>") + "</details>".length;
  expect(a).toBeGreaterThan(-1);
  return { info: html.slice(a, b), luar: html.slice(0, a) + html.slice(b) };
};
const idx = (html: string, potong: string | RegExp) => (typeof potong === "string" ? html.indexOf(potong) : html.search(potong));

const KALIMAT = {
  perPasien: "Satu kartu per hewan. Jumlah kunjungan dan kunjungan terakhir dihitung dari semua cabang yang bisa Anda akses (tanpa kunjungan yang diarsipkan)",
  tombolRiwayat: "tombol Riwayat membuka semua kunjungan hewan itu",
  obatPasien: "hanya hewan dengan kunjungan yang cocok yang tampil",
  rawatInap: "Pasien Rawat Inap aktif ada di Status Rawat Inap. Riwayat medisnya tetap tersedia lewat Semua riwayat atau riwayat pasien.",
  impor: "Riwayat hasil impor tidak punya data cabang, jadi ikut tampil di setiap cabang dengan label",
  bantuan: "Contoh: RC Recovery. Beberapa produk dipisah koma",
  batasan: "Isi racikan belum dicari",
};

beforeEach(() => {
  s.rpc = []; s.cabang = null; s.jawab = null; s.role = "OWNER";
  s.visits = [
    baris("v3", P1, "2026-10-31T03:00:00Z", { obat_cocok: [{ nama: "RC Recovery", qty: 3, sumber: "resep" }] }),
    baris("v2", P1, "2026-10-20T03:00:00Z", { obat_cocok: [{ nama: "RC Recovery", qty: 1, sumber: "tagihan" }] }),
    baris("v1", P2, "2026-10-05T03:00:00Z", { pets: { name: "mochi", species: "Anjing", breed: "Poodle" }, obat_cocok: [{ nama: "Obat Racik Kapsul", qty: 1, sumber: "racikan" }] }),
  ];
});

describe("urutan: pencarian dulu, daftar langsung terlihat", () => {
  it.each([["Per pasien", {}, "data-pasien="], ["Per kunjungan", KUNJUNGAN, "<table"]])("%s: judul → pencarian → pilihan tampilan → judul daftar → daftar", async (_n, sp, awalDaftar) => {
    const html = await render(sp);
    const urut = [
      idx(html, "REKAM MEDIS"), idx(html, 'role="search"'), idx(html, 'aria-label="Tampilan daftar rekam medis"'), idx(html, "Tampilkan:"),
      idx(html, "Daftar riwayat"), idx(html, awalDaftar),
    ];
    expect(urut.every((n) => n >= 0)).toBe(true);
    expect([...urut].sort((a, b) => a - b)).toEqual(urut);
  });

  it("formulir cari: dua kotak + tombol Cari, parameter tersembunyi tetap, TANPA kartu angka tinggi di atasnya", async () => {
    const html = await render({ q: "choco", obat: "recovery", tampilan: "semua", kelompok: "kunjungan" });
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toContain('role="search"');
    expect(form).toContain('name="q"');
    expect(form).toContain('name="obat"');
    expect(form).toContain('name="tampilan" value="semua"');
    expect(form).toContain('name="kelompok" value="kunjungan"');
    expect(form).toMatch(/<button[^>]*type="submit"[^>]*>.*Cari<\/button>/);
    // kartu statistik lama (padding 15, ikon 42px, angka 24px) tidak ada lagi
    expect(html).not.toContain("font-size:24px");
    expect(html).not.toContain("width:42px");
    expect(idx(html, "<form")).toBeLessThan(idx(html, "Daftar riwayat"));
  });

  it("ringkasan angka: tiga keping kecil dalam satu baris di kepala halaman, angka tetap benar", async () => {
    const html = await render();
    const kepala = html.slice(0, html.indexOf("<form"));
    for (const [label, nilai] of [["RIWAYAT TERSIMPAN", 8438], ["HEWAN TERCATAT", 4996], ["HASIL IMPORT", 7906]] as const) {
      expect(kepala).toMatch(new RegExp(`${label}</div><div[^>]*>${nilai}</div>`));
    }
    expect((kepala.match(/TERSIMPAN|TERCATAT|HASIL IMPORT/g) ?? []).length).toBe(3);
    expect(kepala).not.toContain('class="card"');
  });

  it("tombol kepala tidak berubah: Perlu dilengkapi + Import (OWNER); staf: hanya 'Baca saja', pencarian tetap ada", async () => {
    let html = await render();
    expect(html).toContain('href="/klinik/rekam-medis/perlu-dilengkapi"');
    expect(html).toContain('href="/klinik/rekam-medis/impor"');
    s.role = "STAFF";
    html = await render();
    expect(html).not.toContain("/klinik/rekam-medis/impor");
    expect(html).toContain("Baca saja");
    expect(html).toContain('role="search"');
  });
});

describe("penjelasan panjang pindah ke 'Cara membaca daftar' (tidak hilang)", () => {
  it("Per pasien + cabang aktif + impor: semua kalimat lama ADA di blok info dan TIDAK di badan halaman", async () => {
    s.cabang = "cab-1";
    const { info, luar } = bagi(await render({ obat: "recovery" }));
    expect(info).toContain("Cara membaca daftar");
    for (const k of Object.values(KALIMAT)) {
      expect(info).toContain(k);
      expect(luar).not.toContain(k);
    }
    expect(info).toContain("Saat mencari obat");
    expect(info).toContain("Buka kunjungan yang cocok");
    expect(info).toContain("<b>Impor</b>");
    expect(info).toContain('id="bantuan-cari-obat"');
  });

  it("blok info tertutup bawaan (tanpa atribut open) dan ada di sebelah judul daftar", async () => {
    const html = await render();
    expect(html).toMatch(/<details class="[^"]*"><summary>/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    const judul = idx(html, "Daftar riwayat");
    expect(idx(html, "<details")).toBeGreaterThan(judul);
    expect(idx(html, "<details") - judul).toBeLessThan(200);
  });

  it("kolom obat menunjuk ke bantuan (aria-describedby) yang ada di halaman", async () => {
    const html = await render();
    expect(html).toContain('aria-describedby="bantuan-cari-obat"');
    expect(html).toContain('id="bantuan-cari-obat"');
  });

  it("syarat tampil sama seperti dulu: Per kunjungan tanpa kalimat 'Satu kartu', Semua riwayat tanpa catatan Rawat Inap, tanpa cabang tanpa catatan impor", async () => {
    s.cabang = null;
    let html = await render({ ...KUNJUNGAN, tampilan: "semua" });
    expect(html).not.toContain(KALIMAT.perPasien);
    expect(html).not.toContain(KALIMAT.rawatInap);
    expect(html).not.toContain(KALIMAT.impor);
    expect(html).toContain(KALIMAT.bantuan); // bantuan cari obat selalu ada
    html = await render({ ...KUNJUNGAN });
    expect(html).toContain(KALIMAT.rawatInap); // rawat-jalan (bawaan)
    expect(html).not.toContain(KALIMAT.perPasien);
    s.cabang = "cab-1";
    html = await render({ ...KUNJUNGAN });
    expect(html).toContain(KALIMAT.impor);
    html = await render({}); // Per pasien tanpa filter obat: tanpa kalimat tambahan obat
    expect(html).toContain(KALIMAT.perPasien);
    expect(html).not.toContain(KALIMAT.obatPasien);
  });

  it("keterangan hasil: satu baris kecil tepat di atas daftar, kata-kata lama; tanpa pencarian tidak ada baris", async () => {
    let html = await render({ obat: "RC" });
    expect(html).toContain('role="status"');
    const hasil = idx(html, "2 pasien ditemukan (3 kunjungan) dengan obat/produk “RC”.");
    expect(hasil).toBeGreaterThan(idx(html, "Daftar riwayat"));
    expect(hasil).toBeLessThan(idx(html, "data-pasien="));
    html = await render({ ...KUNJUNGAN, q: "choco" });
    expect(html).toContain("3 riwayat ditemukan.");
    expect(idx(html, "3 riwayat ditemukan.")).toBeLessThan(idx(html, "<table"));
    html = await render();
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("ditemukan");
  });
});

describe("pilihan 'Tampilkan' (selain Rawat Inap aktif / semua riwayat / Rawat Inap aktif)", () => {
  const tautan = (html: string) => {
    const nav = html.slice(html.indexOf('aria-labelledby="tampilkan-riwayat"'));
    return [...nav.slice(0, nav.indexOf("</nav>")).matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => ({ href: m[1].replaceAll("&amp;", "&"), teks: m[2].replace(/<[^>]+>/g, "").trim(), cur: /aria-current="page"/.test(m[0]) }));
  };

  it("tiga pilihan, parameter PERSIS seperti tiga tautan lama; q, kelompok, obat terbawa", async () => {
    const t = tautan(await render({ q: "choco", obat: "RC Recovery", kelompok: "kunjungan" }));
    expect(t.map((x) => x.teks)).toEqual(["Selain Rawat Inap aktif", "Semua riwayat", "Rawat Inap aktif"]);
    expect(t[0].href).toBe("/klinik/rekam-medis?q=choco&tampilan=rawat-jalan&kelompok=kunjungan&obat=RC+Recovery");
    expect(t[1].href).toBe("/klinik/rekam-medis?q=choco&tampilan=semua&kelompok=kunjungan&obat=RC+Recovery");
    expect(t[2].href).toBe("/klinik/rawat-inap");
  });

  it("tanpa obat: parameter obat tidak muncul; kelompok pasien bawaan", async () => {
    const t = tautan(await render());
    expect(t[0].href).toBe("/klinik/rekam-medis?q=&tampilan=rawat-jalan&kelompok=pasien");
    expect(t[1].href).toBe("/klinik/rekam-medis?q=&tampilan=semua&kelompok=pasien");
  });

  it("pilihan aktif ditandai aria-current: rawat-jalan bawaan, semua bila diminta (atau ?pet=); Rawat Inap aktif tidak pernah", async () => {
    let t = tautan(await render());
    expect(t.map((x) => x.cur)).toEqual([true, false, false]);
    t = tautan(await render({ tampilan: "semua" }));
    expect(t.map((x) => x.cur)).toEqual([false, true, false]);
    t = tautan(await render({ pet: P1 }));
    expect(t.map((x) => x.cur)).toEqual([false, true, false]);
  });

  it("tiga tautan teks lama sudah tidak ada", async () => {
    const html = await render();
    expect(html).not.toContain("Daftar rekam medis · selain Rawat Inap aktif");
    expect(html).not.toContain("Semua riwayat (termasuk Rawat Inap)");
    expect(html).not.toContain("Pasien Rawat Inap aktif</a>");
  });

  it("Per pasien | Per kunjungan: segmented, parameter lama; hilang di riwayat satu hewan (?pet=)", async () => {
    const html = await render({ q: "x", obat: "recovery" });
    const nav = html.slice(html.indexOf('aria-label="Tampilan daftar rekam medis"'));
    const dua = [...nav.slice(0, nav.indexOf("</nav>")).matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    expect(dua).toEqual([
      "/klinik/rekam-medis?q=x&tampilan=rawat-jalan&kelompok=pasien&obat=recovery",
      "/klinik/rekam-medis?q=x&tampilan=rawat-jalan&kelompok=kunjungan&obat=recovery",
    ]);
    expect(await render({ pet: P1 })).not.toContain("Tampilan daftar rekam medis");
  });
});

describe("tombol hapus pencarian muncul hanya bila ada filter", () => {
  it("tanpa filter: hanya Cari", async () => {
    const html = await render();
    expect(html).not.toContain("Hapus filter obat");
    expect(html).not.toContain("Hapus pencarian");
    expect(html).not.toContain("Lihat semua riwayat");
  });
  it("q: 'Hapus pencarian' dengan tautan lama (tampilan=semua); obat: 'Hapus filter obat' mempertahankan q dan ?pet=", async () => {
    const html = await render({ q: "choco", obat: "recovery", pet: P1 });
    const hrefs = [...html.matchAll(/href="([^"]+)"[^>]*>(?:<i[^>]*><\/i> )?(Hapus pencarian|Hapus filter obat)</g)].map((m) => [m[2], m[1].replaceAll("&amp;", "&")]);
    expect(hrefs).toEqual([
      ["Hapus pencarian", "/klinik/rekam-medis?tampilan=semua&kelompok=kunjungan"],
      ["Hapus filter obat", `/klinik/rekam-medis?q=choco&tampilan=semua&kelompok=kunjungan&pet=${P1}`],
    ]);
  });
  it("hanya ?pet= (tanpa q): tautan keluar bernama 'Lihat semua riwayat'", async () => {
    expect(await render({ pet: P1 })).toContain("Lihat semua riwayat");
  });
});

describe("peringatan dan pesan kosong hanya bila relevan", () => {
  const PESAN = "Could not find the function public.daftar_rekam_medis_halaman(p_batas, p_cabang, p_cari, p_obat, p_offset, p_pet, p_tampilan) in the schema cache";
  const lama = (a: Record<string, unknown>) => {
    if ("p_obat" in a) return { data: null, error: { code: "PGRST202", message: PESAN } };
    return { error: null, data: { jumlah: 3, ringkasan: { riwayat: 500, hewan: 40, impor: 7 }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(0, Math.min(3, a.p_batas as number)) } };
  };
  it("fungsi database belum ada: satu peringatan terlihat (di badan, bukan di info), tanpa baris, tanpa baris keterangan hasil ganda", async () => {
    s.jawab = lama;
    const html = await render({ ...KUNJUNGAN, obat: "RC" });
    const { info, luar } = bagi(html);
    expect(luar).toContain('role="alert"');
    expect(luar).toContain("Pencarian obat belum tersedia (pembaruan database belum terpasang)");
    expect(info).not.toContain("Pencarian obat belum tersedia");
    expect(html.split("Pencarian obat belum tersedia").length - 1).toBe(1);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("ditemukan"); // tidak ada baris hasil menyesatkan di samping peringatan
    expect(idx(html, 'role="alert"')).toBeGreaterThan(idx(html, "Daftar riwayat"));
  });
  it("tanpa masalah: tidak ada peringatan sama sekali", async () => {
    const html = await render({ obat: "recovery" });
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("p2ban");
  });
  it("kosong: pesan kosong tetap terlihat di badan; bukan di blok info", async () => {
    s.visits = [];
    let html = await render({ q: "zzzz" });
    expect(bagi(html).luar).toContain("Belum ada rekam medis yang cocok.");
    html = await render({ ...KUNJUNGAN, obat: "zzzz" });
    expect(bagi(html).luar).toContain("Tidak ada rekam medis dengan obat/produk “zzzz”");
    expect(html).toContain("Periksa ejaan");
  });
  it("jendela 400 kunjungan terlampaui: catatan kuning tetap tampil di atas daftar", async () => {
    s.visits = Array.from({ length: 450 }, (_, i) => baris(`w${String(i).padStart(3, "0")}`, i % 2 ? P1 : P2, new Date(Date.UTC(2026, 10, 1) - i * 3600_000).toISOString()));
    const { luar } = bagi(await render());
    expect(luar).toContain("Menampilkan 2 pasien dari 400 kunjungan terbaru (ada 450 kunjungan yang cocok)");
  });
  it("galat pemuatan: pesan galat saja (bukan formulir setengah jadi)", async () => {
    s.jawab = () => ({ data: null, error: { code: "57014", message: "statement timeout" } });
    const html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Daftar riwayat");
  });
});

describe("baris Per pasien: ringkas, semua data dan tombol tetap ada", () => {
  it("satu baris per hewan: nama, jenis, jumlah kunjungan, pemilik, telepon, terakhir (tanggal, cabang, status), keluhan, diagnosa, Riwayat + Buka terakhir", async () => {
    const html = await render();
    const li = html.slice(html.indexOf("data-pasien="), html.indexOf("</li>"));
    for (const k of ["choco", "Kucing", "2 kunjungan", "tes", "085845455145", "Terakhir:", "31 Okt 2026", "VET_CMGG", "Keluhan: anamnesa v3", "Diagnosa: dx v3", "Riwayat</a>", "Buka terakhir"]) {
      expect(li).toContain(k);
    }
    // tombol di kanan: setelah teks ringkasan
    expect(li.indexOf("Buka terakhir")).toBeGreaterThan(li.indexOf("Diagnosa: dx v3"));
    expect(li.indexOf("Riwayat</a>")).toBeGreaterThan(li.indexOf("Diagnosa: dx v3"));
    // satu keterangan, tidak berulang: pemilik/telepon hanya sekali per baris
    expect(li.split("085845455145").length - 1).toBe(1);
  });
  it("'Diberikan: …' tetap ada, tanpa lencana berwarna (teks kecil lembut)", async () => {
    const html = await render({ obat: "recovery" });
    expect(html).toContain("Diberikan: RC Recovery ×3");
    expect(html).toContain("Diberikan: RC Recovery ×1 (ditagihkan kasir)");
    expect(html).not.toMatch(/class="bge[^"]*"[^>]*>Diberikan:/);
  });
  it("lencana Impor, 'Perlu dilengkapi' dan keping hewan kembar tidak hilang", async () => {
    s.visits = [
      baris("a", P1, "2026-10-31T03:00:00Z"),
      baris("b", P1, "2026-10-10T03:00:00Z", { legacy_source_key: "impor::1", branch_id: null, branches: null }),
      baris("c", "aaaaaaaa-0000-4000-8000-000000000009", "2026-09-01T03:00:00Z"),
    ];
    const html = await render();
    expect(html).toContain("1 impor");
    expect(html).toContain("Ada data hewan kembar");
    expect(html).toContain("Perlu dilengkapi");
    const kunj = await render(KUNJUNGAN);
    expect(kunj).toContain(">Impor</span>");
    expect(kunj).toContain("Riwayat impor (semua cabang)");
  });
});

describe("Per kunjungan dan ponsel", () => {
  it("setiap sel tabel membawa data-label untuk kotak ponsel; kolom obat hanya dengan filter", async () => {
    let html = await render(KUNJUNGAN);
    const tabel = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    for (const label of ["Tanggal", "Pasien", "Pemilik", "Status pasien", "Ringkasan kunjungan", "Diagnosa"]) {
      expect(tabel.split(`data-label="${label}"`).length - 1).toBe(3);
    }
    expect(tabel).not.toContain("Obat / produk diberikan");
    html = await render({ ...KUNJUNGAN, obat: "recovery" });
    expect(html.split('data-label="Obat / produk diberikan"').length - 1).toBe(3);
    expect(html).toContain("<th>Obat / produk diberikan</th>");
  });

  const css = readFileSync(join(__dirname, "../../app/(app)/klinik/rekam-medis/RekamMedisDaftar.module.css"), "utf8");
  const ponsel = css.slice(css.indexOf("@media (max-width: 640px)"));
  it("CSS ponsel (<=640px): pencarian bertumpuk, baris bertumpuk, tabel jadi kotak (tanpa geser mendatar)", () => {
    expect(ponsel).toMatch(/\.kolom \{ flex: 1 1 100%/);
    expect(ponsel).toMatch(/\.baris \{ flex-direction: column/);
    expect(ponsel).toMatch(/\.tabelKunjungan \{ min-width: 0 !important/);
    expect(ponsel).toMatch(/\.tabelKunjungan thead \{ display: none/);
    expect(ponsel).toMatch(/\.tabelKunjungan td\[data-label\]::before \{ content: attr\(data-label\)/);
    expect(ponsel).toMatch(/\.barisAksi a \{[^}]*min-height: 40px/);
  });
  it("CSS desktop: pencarian satu baris (flex-wrap), tanpa nilai tetap lebar kotak 240px", () => {
    expect(css).toMatch(/\.cari \{ display: flex;[^}]*flex-wrap: wrap/);
    expect(css).not.toContain("240px");
    expect(css).not.toContain("font-size: 24px");
  });
});
