import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tiruan database dengan RLS: peran/cabang menentukan kunjungan yang terlihat. RPC meniru SQL
// daftar_rekam_medis_halaman (pet, cabang aktif + riwayat impor tanpa cabang); tabel lain hanya mengembalikan
// baris milik kunjungan yang terlihat. Semua panggilan dicatat untuk bukti "tanpa N+1" dan "tanpa harga".
type Row = Record<string, unknown>;
const s = vi.hoisted(() => ({
  role: "OWNER", cabangAktif: null as string | null, tables: {} as Record<string, Row[]>, failTable: "", failRpc: false,
  calls: [] as { table: string; select: string; filters: [string, string, unknown][] }[], rpcCalls: [] as { name: string; args: Row }[],
  jumlahOverride: undefined as number | undefined,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));

const visible = () => ((s.tables.visits ?? []) as Row[]).filter((v) => {
  const impor = v.branch_id == null && !!v.legacy_source_key;
  if (impor) return s.role === "OWNER" || s.role === "ADMIN" || s.role === "DOCTOR"; // RLS: STAFF tidak melihat riwayat impor
  if (s.role === "OWNER") return true;
  return v.branch_id === s.cabangAktif; // peran biasa: hanya cabang aktifnya
});
const visibleIds = () => new Set(visible().map((v) => v.id));

vi.mock("@/lib/supabase/server", () => {
  const client = () => ({
    async rpc(name: string, args: Row) {
      s.rpcCalls.push({ name, args });
      if (s.failRpc) return { data: null, error: { message: "private DB detail" } };
      const lingkup = visible().filter((v) => (!args.p_pet || v.pet_id === args.p_pet)
        && (!args.p_cabang || v.branch_id === args.p_cabang || (v.branch_id == null && !!v.legacy_source_key)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
      const offset = args.p_offset as number, batas = args.p_batas as number;
      return { error: null, data: {
        jumlah: s.jumlahOverride ?? lingkup.length,
        ringkasan: { riwayat: lingkup.length, hewan: new Set(lingkup.map((v) => v.pet_id)).size, impor: lingkup.filter((v) => v.legacy_source_key).length },
        batas, offset, baris: lingkup.slice(offset, offset + batas),
      } };
    },
    from(table: string) {
      const call = { table, select: "", filters: [] as [string, string, unknown][] };
      s.calls.push(call);
      let range: [number, number] | null = null, single = false;
      const q = {
        select(fields: string) { call.select = fields; return q; },
        eq(f: string, v: unknown) { call.filters.push([f, "eq", v]); return q; },
        neq(f: string, v: unknown) { call.filters.push([f, "neq", v]); return q; },
        in(f: string, v: unknown[]) { call.filters.push([f, "in", v]); return q; },
        is(f: string, v: unknown) { call.filters.push([f, "is", v]); return q; },
        order() { return q; },
        range(a: number, b: number) { range = [a, b]; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
          if (s.failTable === table) return Promise.resolve({ data: null, count: null, error: { message: "private DB detail" } }).then(resolve, reject);
          let rows = (s.tables[table] ?? []).filter((r) => call.filters.every(([f, op, v]) => op === "in" ? (v as unknown[]).includes(r[f]) : op === "neq" ? r[f] !== v : op === "is" ? (r[f] ?? null) === v : r[f] === v));
          const ids = visibleIds();
          if (table === "visits") rows = rows.filter((r) => ids.has(r.id));
          if (table === "medical_records" || table === "inpatient_records") rows = rows.filter((r) => ids.has(r.visit_id));
          if (table === "prescription_items") { const ok = new Set((s.tables.medical_records ?? []).filter((m) => ids.has(m.visit_id)).map((m) => m.id)); rows = rows.filter((r) => ok.has(r.medical_record_id)); }
          if (single) return Promise.resolve({ data: rows[0] ?? null, error: null }).then(resolve, reject);
          const [a, b] = range ?? [0, rows.length];
          return Promise.resolve({ data: rows.slice(a, b + 1), count: rows.length, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  });
  return { createClient: async () => client(), createClientLintasCabang: async () => ({ client: client(), cabangAktif: s.cabangAktif }) };
});
import Page from "../page";

const PET = "aaaaaaaa-0000-4000-8000-000000000001", PET2 = "aaaaaaaa-0000-4000-8000-000000000002", OTHER = "aaaaaaaa-0000-4000-8000-000000000009";
const BR_A = "bbbbbbbb-0000-4000-8000-00000000000a", BR_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const visit = (id: string, pet: string, created_at: string, extra: Row = {}): Row => ({
  id, pet_id: pet, customer_id: "c1", branch_id: BR_A, created_at, dokter: "drh. Uji", keluhan: `Keluhan ${id}`, legacy_source_key: null, poli: "Poli Umum",
  status: "Selesai", archived_at: null, branches: { code: "VET_CMGG", name: "Cabang A" }, medical_records: [{ diagnosis: `Dx ${id}`, anamnesis: null }], ...extra,
});
const rekam = (id: string, visit_id: string, extra: Row = {}): Row => ({
  id, visit_id, created_at: "2026-10-29T03:00:00Z", diagnosis: `Dx ${visit_id}`, anamnesis: `Anamnesa ${visit_id}`, therapy: "Infus", gejala_klinis: null, hasil_penunjang: null,
  follow_up: null, catatan_resep: null, suhu: 39.4, berat: 2.6, ...extra,
});

const render = async (petId = PET, muat?: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({ petId }), searchParams: Promise.resolve({ muat }) }));

beforeEach(() => {
  s.role = "OWNER"; s.cabangAktif = null; s.calls = []; s.rpcCalls = []; s.failTable = ""; s.failRpc = false; s.jumlahOverride = undefined;
  s.tables = {
    pets: [
      { id: PET, customer_id: "c1", name: "choco", species: "Kucing", breed: "DSH", dob: "2024-08-10", gender: "jantan", weight: 2.6, alergi: null, sterilisasi: null, kondisi_khusus: null, golongan_darah: null, microchip: null, customers: { name: "tes", phone: "0812000" } },
      { id: PET2, customer_id: "c1", name: "Mimi", species: "Kucing" },
      { id: OTHER, customer_id: "c2", name: "Rex", species: "Anjing" },
    ],
    visits: [
      visit("v1", PET, "2026-10-29T03:00:00Z"),
      visit("v2", PET, "2026-10-31T03:00:00Z"),
      visit("v-impor", PET, "2025-05-01T03:00:00Z", { branch_id: null, branches: null, legacy_source_key: "wowo::9" }),
      visit("v-b", PET, "2026-11-05T03:00:00Z", { branch_id: BR_B, branches: { code: "VET_BDG", name: "Cabang B" } }),
      visit("v-lain", OTHER, "2026-11-01T03:00:00Z"),
    ],
    medical_records: [rekam("r1", "v1"), rekam("r2", "v2", { berat: null }), rekam("r-impor", "v-impor"), rekam("r-b", "v-b"), rekam("r-lain", "v-lain")],
    prescription_items: [
      { id: "i1", medical_record_id: "r1", nama_obat: "Amoxicillin", qty: 2, satuan: "tab", aturan_pakai: "2x1", jenis: "obat", harga: 99999 },
      { id: "i2", medical_record_id: "r1", nama_obat: "Konsultasi", qty: 1, satuan: "x", aturan_pakai: null, jenis: "jasa", harga: 88888 },
    ],
    inpatient_records: [{ id: "ri-1", visit_id: "v2", condition_status: "stabil", admitted_at: "2026-10-31T04:00:00Z", discharged_at: null, created_at: "2026-10-31T04:00:00Z" }],
  };
});

describe("halaman Riwayat pasien: akses sama dengan daftar Rekam Medis", () => {
  it("OWNER tanpa cabang aktif melihat semua kunjungan hewan ini (cabang, impor), terbaru dulu, tanpa hewan lain", async () => {
    const html = await render();
    const urutan = [...html.matchAll(/data-visit="([^"]+)"/g)].map((m) => m[1]);
    expect(urutan).toEqual(["v-b", "v2", "v1", "v-impor"]);
    expect(html).not.toContain("v-lain");
    expect(html).toContain("Impor");
    expect(html).toContain("Rawat inap");
    expect(html).toContain("masih dirawat"); // tautan ke rawat inap ada di badan kartu (diuji di riwayat-pasien-view.test)
    expect(html).toContain('href="/klinik/rekam-medis/pasien/' + PET2 + '"'); // hewan lain milik pemilik yang sama
    expect(html).not.toContain(OTHER);
  });

  it("memanggil RPC daftar yang sama: satu hewan, semua tampilan, TANPA filter cabang aktif (RLS yang menentukan), 60 per muatan", async () => {
    s.cabangAktif = BR_A; s.role = "ADMIN";
    await render();
    expect(s.rpcCalls).toEqual([{ name: "daftar_rekam_medis_halaman", args: { p_cabang: null, p_cari: null, p_tampilan: "semua", p_pet: PET, p_batas: 60, p_offset: 0 } }]);
  });

  it("OWNER dengan cabang aktif A melihat kunjungan semua cabang (sama dengan jumlah di kartu daftar); kunjungan cabang B tanpa tombol Buka (detail dibaca per cabang aktif)", async () => {
    s.cabangAktif = BR_A; s.role = "OWNER";
    const html = await render();
    expect([...html.matchAll(/data-visit="([^"]+)"/g)].map((m) => m[1])).toEqual(["v-b", "v2", "v1", "v-impor"]);
    expect(html).toContain("Cabang B");
    expect(html).toContain("4 kunjungan dengan rekam medis");
    expect(html).toContain("hanya bisa dibuka dari cabang itu"); // kartu teratas = v-b (cabang B), terbuka
    expect(html).not.toContain('href="/klinik/rekam-medis/v-b"');
  });

  it("peran cabang A: kunjungan cabang A + impor; cabang B tidak terlihat", async () => {
    s.cabangAktif = BR_A; s.role = "ADMIN";
    const html = await render();
    expect([...html.matchAll(/data-visit="([^"]+)"/g)].map((m) => m[1])).toEqual(["v2", "v1", "v-impor"]);
    expect(html).not.toContain("v-b");
    expect(html).not.toContain("VET_BDG");
  });

  it("STAFF cabang A: tanpa riwayat impor (sama dengan RLS daftar)", async () => {
    s.cabangAktif = BR_A; s.role = "STAFF";
    const html = await render();
    expect([...html.matchAll(/data-visit="([^"]+)"/g)].map((m) => m[1])).toEqual(["v2", "v1"]);
    expect(html).not.toContain("v-impor");
  });

  it("peran tanpa satu pun kunjungan terlihat: 'Belum ada riwayat' (profil hewan tetap), bukan galat", async () => {
    s.cabangAktif = BR_A; s.role = "STAFF";
    s.tables.visits = (s.tables.visits as Row[]).filter((v) => v.branch_id !== BR_A && !v.legacy_source_key);
    const html = await render();
    expect(html).toContain("Belum ada riwayat");
    expect(html).toContain("choco");
  });

  it("hewan yang tidak terlihat/tidak ada: 404; id bukan UUID: 404 tanpa menyentuh database", async () => {
    await expect(render("aaaaaaaa-0000-4000-8000-0000000000ff")).rejects.toThrow("NOT_FOUND");
    s.calls = []; s.rpcCalls = [];
    await expect(render("pasien")).rejects.toThrow("NOT_FOUND");
    expect(s.calls).toEqual([]);
    expect(s.rpcCalls).toEqual([]);
  });
});

describe("halaman Riwayat pasien: kueri", () => {
  it("tanpa N+1: tiap tabel dibaca per kelompok id, bukan per kunjungan; tanpa invoice dan tanpa kolom harga", async () => {
    await render();
    const perTabel = (t: string) => s.calls.filter((c) => c.table === t).length;
    expect(perTabel("visits")).toBe(1);
    expect(perTabel("medical_records")).toBe(1);
    expect(perTabel("inpatient_records")).toBe(1);
    expect(perTabel("prescription_items")).toBe(1);
    expect(perTabel("pets")).toBe(2); // profil + hewan lain
    expect(s.calls.map((c) => c.table).filter((t) => !["visits", "medical_records", "inpatient_records", "prescription_items", "pets"].includes(t))).toEqual([]);
    const semuaSelect = s.calls.map((c) => c.select).join(" | ");
    expect(semuaSelect).not.toMatch(/harga|price|total|invoice|diskon|hpp/i);
    expect(s.calls.find((c) => c.table === "prescription_items")!.filters).toContainEqual(["record_withdrawn_at", "is", null]);
  });

  it("resep dan tindakan tampil, harga tidak pernah masuk HTML", async () => {
    s.cabangAktif = BR_A; s.role = "ADMIN";
    const html = await render(PET, undefined);
    expect(html).toContain("choco");
    expect(html).not.toMatch(/99999|88888|99\.999|88\.888/);
  });

  it("'Muat lebih banyak' bila kunjungan belum semua tampil; muatan 2 memanggil halaman kedua", async () => {
    const lebih = Array.from({ length: 70 }, (_, i) => visit(`vx${i}`, PET, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T0${i % 9}:00:00Z`));
    s.tables.visits = lebih; s.tables.medical_records = lebih.map((v, i) => rekam(`rx${i}`, String(v.id)));
    const awal = await render();
    expect(awal).toContain("Muat lebih banyak (60 dari 70)");
    expect(awal).toContain(`href="/klinik/rekam-medis/pasien/${PET}?muat=2"`);
    s.rpcCalls = [];
    const dua = await render(PET, "2");
    expect(s.rpcCalls.map((c) => c.args.p_offset)).toEqual([0, 60]);
    expect(dua).not.toContain("Muat lebih banyak");
    expect((dua.match(/data-visit=/g) ?? []).length).toBe(70);
  });
});

describe("halaman Riwayat pasien: galat tidak merusak halaman", () => {
  it.each([["pets"], ["visits"], ["medical_records"], ["prescription_items"], ["inpatient_records"]])("sumber %s gagal: peringatan, bukan daftar kosong, tanpa detail database", async (tabel) => {
    s.failTable = tabel;
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Riwayat pasien belum dapat dimuat lengkap");
    expect(html).not.toContain("private DB detail");
    expect(html).not.toContain("Belum ada riwayat");
    expect(html).toContain('href="/klinik/rekam-medis"');
  });

  it("RPC gagal atau jumlah tidak cocok: peringatan", async () => {
    s.failRpc = true;
    expect(await render()).toContain('role="alert"');
    s.failRpc = false; s.jumlahOverride = 99;
    expect(await render()).toContain('role="alert"');
  });
});
