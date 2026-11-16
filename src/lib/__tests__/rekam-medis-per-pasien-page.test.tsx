import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Daftar Rekam Medis: Per pasien (bawaan) = satu kartu per hewan; Per kunjungan = tampilan lama (tidak berubah).
// Tiruan database: RPC = lingkup cabang aktif (s.visits). Bacaan `visits`/`medical_records` langsung = lingkup SEMUA cabang
// yang boleh dibaca peran (RLS pemanggil, tanpa header cabang): s.visits + s.lain (kunjungan cabang lain), disaring s.akses.
type Row = Record<string, unknown>;
const s = vi.hoisted(() => ({
  visits: [] as Record<string, unknown>[], lain: [] as Record<string, unknown>[], rpc: [] as Record<string, unknown>[], cabang: null as string | null,
  akses: null as string[] | null, // null = semua cabang (OWNER/ADMIN); daftar = hanya cabang itu (+ impor)
  gagalTabel: "", ubah: null as null | ((d: Record<string, unknown>) => unknown),
  dari: [] as { table: string; select: string; filters: [string, string, unknown][] }[],
}));
vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => {
  const terlihat = () => [...s.visits, ...s.lain].filter((v) => v.branch_id == null || s.akses === null || s.akses.includes(v.branch_id as string));
  const keBaris = (v: Row): Row => ({
    id: v.id, pet_id: v.pet_id, created_at: v.created_at, branch_id: v.branch_id, status: "Selesai", poli: "Poli Umum", keluhan: v.keluhan,
    legacy_source_key: v.legacy_source_key, branches: v.branches, archived_at: v.archived_at ?? null,
    medical_records: [{ id: "m-" + v.id }], inpatient_records: v.inpatient_records,
  });
  const dari = (table: string) => {
    const call = { table, select: "", filters: [] as [string, string, unknown][] };
    s.dari.push(call);
    let range: [number, number] | null = null;
    const q = {
      select(kolom: string) { call.select = kolom; return q; },
      in(f: string, v: unknown[]) { call.filters.push([f, "in", v]); return q; },
      is(f: string, v: unknown) { call.filters.push([f, "is", v]); return q; },
      order() { return q; },
      range(a: number, b: number) { range = [a, b]; return q; },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        if (s.gagalTabel === table) return Promise.resolve({ data: null, count: null, error: { message: "detail DB rahasia" } }).then(resolve, reject);
        const cocok = (r: Row) => call.filters.every(([f, op, v]) => (op === "in" ? (v as unknown[]).includes(r[f]) : (r[f] ?? null) === v));
        let rows: Row[];
        if (table === "visits") rows = terlihat().map(keBaris).filter(cocok).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
        else if (table === "medical_records") rows = terlihat().map((v) => ({ visit_id: v.id, id: "m-" + v.id, ...((v.medical_records ?? {}) as Row) })).filter(cocok);
        else rows = [];
        const [a, b] = range ?? [0, rows.length];
        return Promise.resolve({ data: rows.slice(a, b + 1), count: rows.length, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    createClientLintasCabang: async () => ({
      cabangAktif: s.cabang,
      client: {
        from: dari,
        rpc: async (_n: string, a: { p_batas: number; p_offset: number }) => {
          s.rpc.push(a);
          const data = { jumlah: s.visits.length, ringkasan: { riwayat: s.visits.length, hewan: Math.min(3, s.visits.length), impor: Math.min(1, s.visits.length) }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(a.p_offset, a.p_offset + a.p_batas) };
          return { error: null, data: s.ubah ? s.ubah(data) : data };
        },
      },
    }),
  };
});
import MedicalPage from "../../app/(app)/klinik/rekam-medis/page";

const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";
const P3 = "aaaaaaaa-0000-4000-8000-000000000003";
const baris = (id: string, pet_id: string | null, tanggal: string, o: Record<string, unknown> = {}) => ({
  id, pet_id, branch_id: "b", created_at: tanggal, dokter: "drh", keluhan: "keluhan " + id, legacy_source_key: null,
  pets: { name: "choco", species: "Kucing", breed: null }, customers: { name: "tes", phone: "085845455145" }, branches: { code: "VET_CMGG" },
  medical_records: { diagnosis: "dx " + id, anamnesis: "anamnesa " + id }, inpatient_records: [], ...o,
});
const inap = [{ created_at: "2026-10-01T00:00:00Z", discharged_at: "2026-10-03T00:00:00Z", condition_status: "sembuh" }];
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve(sp) }));
const hitung = (html: string, cari: string) => html.split(cari).length - 1;

beforeEach(() => {
  s.rpc = []; s.cabang = null; s.ubah = null; s.lain = []; s.akses = null; s.gagalTabel = ""; s.dari = [];
  s.visits = [
    baris("v5", P1, "2026-10-31T03:00:00Z", { inpatient_records: inap }),
    baris("v4", P1, "2026-10-20T03:00:00Z", { inpatient_records: inap }),
    baris("v3", P1, "2026-10-10T03:00:00Z", { legacy_source_key: "impor::1", branch_id: null, branches: null }),
    baris("v2", P2, "2026-10-05T03:00:00Z", { pets: { name: "mochi", species: "Anjing", breed: "Poodle" } }),
    baris("v1", P3, "2026-09-01T03:00:00Z"), // choco lain (id beda, pemilik/nama/jenis sama)
    baris("v0", null, "2026-08-01T03:00:00Z", { pets: null }),
  ];
});

describe("Per pasien (bawaan)", () => {
  it("tanpa parameter: satu kartu per hewan, toggle Per pasien aktif, tanpa tabel", async () => {
    const html = await render();
    expect(hitung(html, "data-pasien=")).toBe(3); // P1, P2, P3 (v0 tanpa pet_id tidak punya data-pasien)
    expect(hitung(html, "<li ")).toBe(4);
    expect(html).not.toContain("<table");
    expect(html).toMatch(/aria-current="page"[^>]*>Per pasien</);
    expect(html).not.toMatch(/aria-current="page"[^>]*>Per kunjungan</);
    expect(html).toContain("3 kunjungan"); // choco P1
    expect(html).toContain("tanpa kunjungan yang diarsipkan");
    expect(html).toContain("2 rawat inap");
    expect(html).toContain("1 impor");
  });

  it("membaca jendela 2 x 200 lewat RPC yang sama dengan filter daftar (tanpa migrasi)", async () => {
    await render({ q: "Choco", tampilan: "semua" });
    expect(s.rpc).toEqual([
      expect.objectContaining({ p_batas: 200, p_offset: 0 }), expect.objectContaining({ p_batas: 200, p_offset: 200 }),
    ]);
  });

  it("tombol Riwayat (ke halaman pasien) dan Buka terakhir (kunjungan terbaru) per hewan; nama hewan jadi tautan", async () => {
    const html = await render();
    expect(hitung(html, `href="/klinik/rekam-medis/pasien/${P1}"`)).toBe(2); // nama + Riwayat
    expect(html).toContain('href="/klinik/rekam-medis/v5"'); // terakhir P1
    expect(html).not.toContain('href="/klinik/rekam-medis/v4"');
    expect(html).not.toContain('href="/klinik/rekam-medis/v3"');
    expect(html).toContain('href="/klinik/rekam-medis/v2"');
    expect(html).toContain('href="/klinik/rekam-medis/v0"');
    expect(hitung(html, "Buka terakhir")).toBe(4);
    expect(hitung(html, "ti-history")).toBe(3); // v0 tanpa pet_id: tanpa Riwayat
    expect(html).toContain("Keluhan: anamnesa v5");
    expect(html).toContain("Diagnosa: dx v5");
    expect(html).toContain("VET_CMGG");
  });

  it("penanda data hewan kembar hanya pada dua id yang serupa, data tidak digabung", async () => {
    const html = await render();
    expect(hitung(html, "Ada data hewan kembar")).toBe(2);
    expect(hitung(html, "choco</a>")).toBe(2);
  });

  it("urut: kunjungan terakhir terbaru dulu", async () => {
    const html = await render();
    const urut = ["v5", "v2", "v1", "v0"].map((id) => html.indexOf(`/klinik/rekam-medis/${id}"`));
    expect(urut.every((n) => n > 0)).toBe(true);
    expect([...urut].sort((a, b) => a - b)).toEqual(urut);
  });

  it("toggle: tautan menjaga q + tampilan; formulir cari membawa kelompok; Per kunjungan terjangkau", async () => {
    const html = await render({ q: "Choco", tampilan: "semua" });
    expect(html).toMatch(/href="\/klinik\/rekam-medis\?q=Choco(?:&amp;|&)tampilan=semua(?:&amp;|&)kelompok=kunjungan"/);
    expect(html).toMatch(/href="\/klinik\/rekam-medis\?q=Choco(?:&amp;|&)tampilan=semua(?:&amp;|&)kelompok=pasien"/);
    expect(html).toContain('name="kelompok" value="pasien"');
    expect(html).toContain("4 pasien ditemukan (6 kunjungan).");
  });

  it("jendela habis: catatan 'Menampilkan N pasien dari 400 kunjungan terbaru'; tanda + hanya dari batas 200 per hewan", async () => {
    s.visits = Array.from({ length: 450 }, (_, i) => baris(`w${String(i).padStart(3, "0")}`, i % 2 ? P1 : P2, new Date(Date.UTC(2026, 10, 1) - i * 3600_000).toISOString()));
    const html = await render();
    expect(html).toContain("Menampilkan 2 pasien dari 400 kunjungan terbaru (ada 450 kunjungan yang cocok)");
    expect(html).toContain("persempit pencarian");
    expect(html).toContain("200+ kunjungan");
    expect(html).not.toContain("w400"); // di luar jendela
    expect(html).toMatch(/RIWAYAT TERSIMPAN<\/div><div[^>]*>450</);
  });

  it("jendela tidak habis: tanpa catatan dan tanpa tanda +", async () => {
    const html = await render();
    expect(html).not.toContain("kunjungan terbaru");
    expect(html).not.toContain("+ kunjungan");
  });

  it("paginasi per kelompok (20 pasien per halaman), parameter kelompok ikut", async () => {
    s.visits = Array.from({ length: 45 }, (_, i) => baris(`x${i}`, `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`, new Date(Date.UTC(2026, 10, 1) - i * 3600_000).toISOString(), { pets: { name: `hewan${i}`, species: "Kucing", breed: null } }));
    const hal1 = await render();
    expect(hitung(hal1, "data-pasien=")).toBe(20);
    expect(hal1).toContain("Menampilkan 1–20 dari 45");
    expect(hal1).toMatch(/hal=2/);
    expect(hal1).toMatch(/kelompok=pasien(?:&amp;|&)hal=2/);
    const hal3 = await render({ hal: "3" });
    expect(hitung(hal3, "data-pasien=")).toBe(5);
    expect(hal3).toContain("hewan44");
    const luar = await render({ hal: "99" });
    expect(hitung(luar, "data-pasien=")).toBe(20); // di luar jangkauan -> halaman 1
  });

  it("kosong: pesan kosong, tanpa kartu", async () => {
    s.visits = [];
    const html = await render({ q: "tidak ada" });
    expect(html).toContain("Belum ada rekam medis yang cocok.");
    expect(html).not.toContain("<li ");
  });

  it("gagal tertutup bila dua bacaan jendela tidak konsisten", async () => {
    let n = 0;
    s.ubah = (d) => (n++ === 1 ? { ...d, jumlah: 6, ringkasan: { riwayat: 6, hewan: 3, impor: 1 } } : d);
    s.visits = s.visits.slice(0, 5);
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("data-pasien=");
  });

  it("gagal tertutup bila hasil RPC salah bentuk (bukan daftar kosong)", async () => {
    s.ubah = () => [];
    const html = await render();
    expect(html).toContain("Rekam medis belum dapat dimuat lengkap");
    expect(html).not.toContain("Belum ada rekam medis");
  });

  it("cabang aktif dikirim ke RPC; riwayat impor tanpa cabang berlabel", async () => {
    s.cabang = "branch-a";
    s.visits = [baris("vi", P1, "2026-10-10T03:00:00Z", { legacy_source_key: "impor::1", branch_id: null, branches: null })];
    const html = await render();
    expect(s.rpc[0]).toMatchObject({ p_cabang: "branch-a" });
    expect(html).toContain("Riwayat impor (semua cabang)");
  });
});

describe("Per kunjungan (tampilan lama)", () => {
  it("kelompok=kunjungan: satu halaman 50 baris lewat RPC, tabel per kunjungan, toggle Per kunjungan aktif", async () => {
    const html = await render({ kelompok: "kunjungan" });
    expect(s.rpc).toEqual([expect.objectContaining({ p_batas: 50, p_offset: 0 })]);
    expect(html).toContain("<table");
    expect(hitung(html, "<tr>") - 1).toBe(6); // 6 kunjungan, bukan 4 hewan
    expect(html).toMatch(/aria-current="page"[^>]*>Per kunjungan</);
    expect(html).not.toContain("Buka terakhir");
    for (const id of ["v5", "v4", "v3", "v2", "v1", "v0"]) expect(html).toContain(`href="/klinik/rekam-medis/${id}"`);
  });

  it("regresi: markup tabel Per kunjungan identik dengan daftar sebelum fitur Per pasien (snapshot dari main c3214e7c)", async () => {
    s.cabang = "branch-a";
    const html = await render({ kelompok: "kunjungan", tampilan: "semua" });
    const tabel = html.slice(html.indexOf("<table"), html.indexOf("</table>") + "</table>".length);
    expect(tabel.length).toBeGreaterThan(500);
    expect(tabel).toMatchSnapshot();
  });

  it("?pet= selalu per kunjungan (riwayat satu hewan) dan tanpa toggle", async () => {
    s.visits = s.visits.slice(0, 3);
    const html = await render({ pet: P1 });
    expect(html).toContain("<table");
    expect(html).not.toContain("Tampilan daftar rekam medis");
    expect(s.rpc).toEqual([expect.objectContaining({ p_pet: P1, p_batas: 50 })]);
  });

  it("nilai kelompok tak dikenal jatuh ke Per pasien", async () => {
    const html = await render({ kelompok: "ngawur" });
    expect(html).not.toContain("<table");
    expect(html).toContain("data-pasien=");
  });
});

// ── Jumlah kunjungan + Terakhir dari SEMUA cabang (bukan hanya cabang aktif) ──
const A = "bbbbbbbb-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const tanggal = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 86400_000).toISOString();
/** choco/tes: 7 kunjungan di cabang aktif A (2 rawat inap) dan 6 di cabang B (1 rawat inap) + 1 arsip B; kunjungan terakhir ada di B. */
function pasarChoco() {
  s.cabang = A;
  const a = Array.from({ length: 7 }, (_, i) => baris(`a${i}`, P1, tanggal(i), { branch_id: A, branches: { code: "VET_PDRY" }, inpatient_records: i < 2 ? inap : [] }));
  const b = Array.from({ length: 6 }, (_, i) => baris(`b${i}`, P1, tanggal(10 + i), { branch_id: B, branches: { code: "VET_CMGG" }, inpatient_records: i === 5 ? inap : [], medical_records: { diagnosis: `dx-b${i}`, anamnesis: `anamnesa-b${i}` } }));
  const arsip = baris("b-arsip", P1, tanggal(30), { branch_id: B, branches: { code: "VET_CMGG" }, archived_at: "2026-11-01T00:00:00Z" });
  s.visits = [...a].reverse(); s.lain = [...b, arsip];
}
const adaChip = (html: string, teks: string) => html.includes(teks);

describe("Per pasien: hitungan semua cabang", () => {
  it("choco: cabang aktif 7, semua cabang 13 (arsip tidak dihitung); chip '7 di cabang ini'; Terakhir dari cabang lain", async () => {
    pasarChoco();
    const html = await render({ tampilan: "semua" });
    expect(html).toContain(">13 kunjungan<");
    expect(adaChip(html, ">7 kunjungan<")).toBe(false);
    expect(html).toContain(">7 di cabang ini<");
    expect(html).toContain(">3 rawat inap<"); // 2 di A + 1 di B
    expect(html).toContain("VET_CMGG"); // Terakhir = b5 (cabang B)
    expect(html).toContain("(cabang lain)");
    expect(html).toContain("Keluhan: anamnesa-b5");
    expect(html).toContain("Diagnosa: dx-b5");
    expect(html).toContain("Sudah pulang");
  });

  it("'Buka terakhir' tetap membuka kunjungan terakhir di cabang aktif (detail dibaca per cabang aktif), bukan kunjungan cabang lain", async () => {
    pasarChoco();
    const html = await render({ tampilan: "semua" });
    expect(html).toContain('href="/klinik/rekam-medis/a6"');
    expect(html).not.toContain('href="/klinik/rekam-medis/b5"');
    expect(html).toContain("Buka terakhir di cabang ini");
    expect(html).toContain(`href="/klinik/rekam-medis/pasien/${P1}"`); // Riwayat tidak berubah
  });

  it("Semua cabang (tanpa cabang aktif): tanpa chip 'di cabang ini', jumlah 13, tombol Buka terakhir biasa", async () => {
    pasarChoco(); s.cabang = null; s.visits = [...s.visits, ...s.lain.filter((v) => !v.archived_at)].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    s.lain = [s.lain.find((v) => v.archived_at)!];
    const html = await render({ tampilan: "semua" });
    expect(html).toContain(">13 kunjungan<");
    expect(html).not.toContain("di cabang ini");
    expect(html).not.toContain("(cabang lain)");
    expect(html).toContain('href="/klinik/rekam-medis/b5"');
    expect(html).toContain("</i> Buka terakhir</a>");
  });

  it("jumlah sama di cabang aktif dan semua cabang: tanpa chip", async () => {
    pasarChoco(); s.lain = [];
    const html = await render({ tampilan: "semua" });
    expect(html).toContain(">7 kunjungan<");
    expect(html).not.toContain("di cabang ini");
    expect(html).not.toContain("(cabang lain)");
  });

  it("satu bacaan visits berkumpul untuk hewan di halaman: tanpa filter cabang, arsip dikecualikan, maks 20 hewan, tanpa N+1", async () => {
    s.cabang = A;
    s.visits = Array.from({ length: 45 }, (_, i) => baris(`x${i}`, `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`, new Date(Date.UTC(2026, 10, 1) - i * 3600_000).toISOString(), { branch_id: A, pets: { name: `hewan${i}`, species: "Kucing", breed: null } }));
    await render({ tampilan: "semua" });
    const visitsCalls = s.dari.filter((c) => c.table === "visits");
    expect(visitsCalls).toHaveLength(1); // 20 hewan, < 500 baris: satu halaman bacaan
    const [petFilter] = visitsCalls[0].filters.filter(([f]) => f === "pet_id");
    expect((petFilter[2] as string[]).length).toBe(20);
    expect(visitsCalls[0].filters.some(([f]) => f === "branch_id")).toBe(false);
    expect(visitsCalls[0].filters).toContainEqual(["archived_at", "is", null]);
    expect(visitsCalls[0].select).toContain("medical_records!inner(id)");
    expect(s.dari.filter((c) => c.table !== "visits" && c.table !== "medical_records")).toEqual([]);
    expect(s.dari.length).toBeLessThanOrEqual(2); // visits + (opsional) isi klinis kunjungan terakhir; bukan satu bacaan per hewan
  });

  it("batas per hewan: lebih dari 200 kunjungan ditampilkan '200+'", async () => {
    s.cabang = A;
    s.visits = Array.from({ length: 5 }, (_, i) => baris(`a${i}`, P1, tanggal(300 + i), { branch_id: A }));
    s.lain = Array.from({ length: 260 }, (_, i) => baris(`b${String(i).padStart(3, "0")}`, P1, tanggal(i), { branch_id: B, branches: { code: "VET_CMGG" } }));
    const html = await render({ tampilan: "semua" });
    expect(html).toContain(">200+ kunjungan<");
    expect(html).toContain(">5 di cabang ini<");
  });

  it("tampilan rawat-jalan: kunjungan rawat inap AKTIF di cabang lain ikut disembunyikan seperti daftar, tampilan semua menghitungnya", async () => {
    pasarChoco();
    s.lain[0] = { ...s.lain[0], inpatient_records: [{ created_at: tanggal(10), discharged_at: null, condition_status: "stabil" }] };
    expect(await render({ tampilan: "rawat-jalan" })).toContain(">12 kunjungan<");
    expect(await render({ tampilan: "semua" })).toContain(">13 kunjungan<");
  });

  it("RLS: peran yang hanya punya cabang A tidak melihat cabang B (jumlah 7, tanpa kode cabang B, tanpa chip); peran A+B melihat 13", async () => {
    pasarChoco(); s.akses = [A];
    const sempit = await render({ tampilan: "semua" });
    expect(sempit).toContain(">7 kunjungan<");
    expect(sempit).not.toContain("VET_CMGG");
    expect(sempit).not.toContain("di cabang ini");
    expect(sempit).not.toContain("anamnesa-b");
    expect(s.dari.filter((c) => c.table === "medical_records")).toEqual([]); // tidak ada isi klinis cabang B yang dibaca
    s.akses = [A, B]; s.dari = [];
    const luas = await render({ tampilan: "semua" });
    expect(luas).toContain(">13 kunjungan<");
    expect(luas).toContain(">7 di cabang ini<");
  });

  it("galat bacaan semua cabang: halaman gagal tertutup, tidak diam-diam memakai angka cabang aktif", async () => {
    pasarChoco(); s.gagalTabel = "visits";
    const html = await render({ tampilan: "semua" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(html).not.toContain("data-pasien=");
    expect(html).not.toContain(">7 kunjungan<");
  });

  it("riwayat impor tanpa cabang ikut lingkup 'di cabang ini' dan jumlah semua cabang", async () => {
    pasarChoco();
    s.visits = [...s.visits, baris("imp", P1, tanggal(-5), { branch_id: null, branches: null, legacy_source_key: "impor::1" })];
    const html = await render({ tampilan: "semua" });
    expect(html).toContain(">14 kunjungan<");
    expect(html).toContain(">8 di cabang ini<");
    expect(html).toContain(">1 impor<");
  });

  it("Per kunjungan: tidak membaca semua cabang sama sekali (tidak ada bacaan visits langsung) dan tabel tetap", async () => {
    pasarChoco();
    const html = await render({ kelompok: "kunjungan", tampilan: "semua" });
    expect(s.dari).toEqual([]);
    expect(s.rpc).toEqual([expect.objectContaining({ p_cabang: A, p_batas: 50 })]);
    expect(hitung(html, "<tr>") - 1).toBe(7);
    expect(html).not.toContain("di cabang ini");
    expect(html).not.toContain("13 kunjungan");
  });
});
