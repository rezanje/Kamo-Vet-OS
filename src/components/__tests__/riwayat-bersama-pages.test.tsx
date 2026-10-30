import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// RS-2 (UAT 30 Okt 2026): OWNER, cabang aktif VET_CMGG, CRM → pelanggan → hewan → riwayat menampilkan 0 riwayat
// karena SELECT biasa menyembunyikan riwayat bersama hasil impor. Fixture fiktif berbentuk UAT: dua riwayat
// bersama (15/1 dan 16/1 WIB) + satu kunjungan cabang. "cabang" = header cabang aktif (SELECT biasa tidak melihat
// riwayat bersama); "semua" = Semua cabang sungguhan (SELECT biasa melihatnya untuk OWNER/ADMIN).
const s = vi.hoisted(() => ({
  role: "OWNER", active: true, mode: "cabang" as "cabang" | "semua",
  shared: [] as Record<string, unknown>[], extraNormal: [] as Record<string, unknown>[],
  rpcError: "" as "" | "list" | "detail", profileError: false, petError: false, visitError: false,
  detailOverride: null as null | { data: unknown; error: unknown }, petCustomer: "cust-uji",
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/dokter", () => ({ daftarDokter: async () => [] }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null }));
vi.mock("@/lib/rombongan-server", () => ({ bacaSaudaraKunjungan: async () => [] }));
vi.mock("@/lib/katalog-racikan-server", () => ({ bolehRacikKhusus: async () => false, loadKatalogRacikan: async () => [] }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));

const PET = "pet-uji", CUST = "cust-uji", S1 = "visit-s1", S2 = "visit-s2", A1 = "visit-a1";
const sharedRow = (id: string, tanggal: string, n: number) => ({
  visit_id: id, pet_id: PET, customer_id: CUST, tanggal, dokter: `drh. Uji ${n}`, keluhan: `Keluhan uji ${n}`,
  diagnosis: `UJI DIAGNOSIS ${n} - BUKAN PASIEN NYATA`, anamnesis: `Anamnesis uji ${n}`, gejala_klinis: `Gejala uji ${n}`, terapi: `UJI TERAPI ${n}`,
});
const embedded = { pets: { name: "UJI KUCING SINTETIS", species: "Kucing", breed: null }, customers: { name: "UJI SIM REKMED 291026", phone: "0800000000" } };
const normalOf = (r: Record<string, unknown>) => ({
  id: r.visit_id, pet_id: PET, branch_id: null, created_at: r.tanggal, dokter: r.dokter, keluhan: r.keluhan, legacy_source_key: `wowo-test::${r.visit_id}`,
  ...embedded, branches: null, medical_records: { diagnosis: r.diagnosis, anamnesis: r.anamnesis }, inpatient_records: [],
});
const branchVisit = {
  id: A1, pet_id: PET, branch_id: "branch-a", created_at: "2026-02-01T01:00:00+00:00", dokter: "drh. Cabang", keluhan: "Keluhan cabang",
  legacy_source_key: null, ...embedded, branches: { code: "VET_CMGG" }, medical_records: { diagnosis: "Diagnosis cabang", anamnesis: null },
  inpatient_records: [], poli: "Poli Umum", status: "Selesai",
};

function visibleVisits() {
  const shared = s.mode === "semua" && ["OWNER", "ADMIN"].includes(s.role) ? s.shared.map(normalOf) : [];
  return [branchVisit, ...shared, ...s.extraNormal];
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpcCalls.push({ name, args });
      if (name === "riwayat_bersama_hewan") {
        if (s.rpcError === "list") return { data: null, error: { code: "42501", message: "PRIVATE backend detail" } };
        const all = s.shared.filter(r => r.pet_id === args.p_pet);
        const dari = args.p_dari as number, jumlah = args.p_jumlah as number;
        return { data: all.slice(dari, dari + jumlah), error: null };
      }
      if (name === "detail_riwayat_bersama") {
        if (s.detailOverride) return s.detailOverride;
        if (s.rpcError === "detail") return { data: null, error: { code: "42501", message: "PRIVATE backend detail" } };
        return { data: s.shared.filter(r => r.visit_id === args.p_visit), error: null };
      }
      return { data: false, error: null };
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let range: [number, number] | null = null;
      const source = (): { data: Record<string, unknown>[] | null; error: unknown } => {
        if (table === "profiles") return s.profileError ? { data: null, error: { message: "x" } } : { data: [{ id: "actor", role: s.role, is_active: s.active }], error: null };
        if (table === "pets") return s.petError ? { data: null, error: { message: "x" } } : { data: [{ id: PET, customer_id: s.petCustomer, name: "UJI KUCING SINTETIS", species: "Kucing", breed: null, customers: embedded.customers }], error: null };
        if (table === "visits") return s.visitError ? { data: null, error: { message: "PRIVATE visits failure" } } : { data: visibleVisits(), error: null };
        return { data: [], error: null };
      };
      const result = () => {
        const r = source();
        const rows = r.data?.filter(row => filters.every(([k, v]) => row[k] === v)) ?? null;
        return { rows, error: r.error };
      };
      const query = {
        select: () => query, eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
        in: () => query, is: () => query, or: () => query, order: () => query, limit: () => query,
        range: (a: number, b: number) => { range = [a, b]; return query; },
        maybeSingle: async () => { const r = result(); return { data: r.rows?.[0] ?? null, error: r.error }; },
        then: (resolve: (v: unknown) => unknown) => {
          const r = result();
          const data = r.rows && range ? r.rows.slice(range[0], range[1] + 1) : r.rows;
          return Promise.resolve({ data, count: r.rows ? r.rows.length : null, error: r.error }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
import ListPage from "@/app/(app)/klinik/rekam-medis/page";
import DetailPage from "@/app/(app)/klinik/rekam-medis/[visitId]/page";
import { RekamMedisGagalDimuat, RiwayatBersamaDetail } from "@/app/(app)/klinik/rekam-medis/[visitId]/RiwayatBersamaDetail";

const listHtml = async (search: Record<string, string> = { pet: PET }) => renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve(search) }));
const detail = async (visitId: string) => DetailPage({ params: Promise.resolve({ visitId }), searchParams: Promise.resolve({}) });
const occurrences = (html: string, needle: string) => html.split(needle).length - 1;
const listCalls = () => s.rpcCalls.filter(c => c.name === "riwayat_bersama_hewan");

beforeEach(() => {
  Object.assign(s, { role: "OWNER", active: true, mode: "cabang", extraNormal: [], rpcError: "", profileError: false, petError: false,
    visitError: false, detailOverride: null, petCustomer: CUST, rpcCalls: [] });
  s.shared = [sharedRow(S2, "2026-01-15T17:00:00+00:00", 2), sharedRow(S1, "2026-01-14T17:00:00+00:00", 1)];
});

describe("pet history list (customer → pet → history)", () => {
  it.each(["cabang", "semua"] as const)("OWNER (%s) sees both shared imports + branch visit, each once, with the same shared rows", async mode => {
    s.mode = mode;
    const html = await listHtml();
    expect(html).toContain("15 Jan 2026");
    expect(html).toContain("16 Jan 2026");
    expect(html).toContain("UJI DIAGNOSIS 1 - BUKAN PASIEN NYATA");
    expect(html).toContain("UJI DIAGNOSIS 2 - BUKAN PASIEN NYATA");
    expect(html).toContain("Diagnosis cabang");
    for (const id of [S1, S2, A1]) expect(occurrences(html, `href="/klinik/rekam-medis/${id}"`)).toBe(1);
    expect(occurrences(html, "Riwayat lama · semua cabang")).toBe(2);
    expect(html).not.toContain("Belum ada riwayat medis untuk anabul ini.");
    // Newest first: branch visit (1 Feb), then 16/1, then 15/1.
    expect(html.indexOf(A1)).toBeLessThan(html.indexOf(S2));
    expect(html.indexOf(S2)).toBeLessThan(html.indexOf(S1));
    expect(listCalls().map(c => c.args)).toEqual([{ p_pet: PET, p_dari: 0, p_jumlah: 200 }]);
  });
  it("counts the shared imports in the stats (no more 0 riwayat / 0 hasil import)", async () => {
    const html = await listHtml();
    expect(html).toMatch(/RIWAYAT TERSIMPAN<\/div><div[^>]*>3</);
    expect(html).toMatch(/HASIL IMPORT<\/div><div[^>]*>2</);
  });
  it.each(["ADMIN", "DOCTOR", "STAFF"])("%s is unchanged: no shared reader call", async role => {
    s.role = role;
    const html = await listHtml();
    expect(listCalls()).toHaveLength(0);
    expect(html).not.toContain(`href="/klinik/rekam-medis/${S1}"`);
    expect(html).toContain("Diagnosis cabang");
  });
  it("inactive OWNER is unchanged too", async () => {
    s.active = false;
    await listHtml();
    expect(listCalls()).toHaveLength(0);
  });
  it("does not touch the general list (no pet)", async () => {
    await listHtml({});
    expect(s.rpcCalls).toHaveLength(0);
  });
  it.each([
    ["the reader is refused", () => { s.rpcError = "list"; }],
    ["the profile cannot be read", () => { s.profileError = true; }],
    ["the pet cannot be read", () => { s.petError = true; }],
    ["a reader row belongs to another customer", () => { s.shared = [{ ...s.shared[0], customer_id: "cust-lain" }]; }],
    ["a normal shared row is refused by the reader (inconsistent link)", () => {
      s.mode = "semua"; s.extraNormal = [normalOf(sharedRow("visit-x", "2026-01-20T01:00:00+00:00", 9))];
    }],
  ])("shows a generic failure (never an empty or partial history) when %s", async (_label, setup) => {
    setup();
    const html = await listHtml();
    expect(html).toContain('role="alert"');
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Belum ada riwayat medis");
    expect(html).not.toContain("PRIVATE");
  });
  it("fails explicitly beyond 1000 shared rows instead of truncating", async () => {
    s.shared = Array.from({ length: 1001 }, (_, i) => sharedRow(`v-${String(i).padStart(5, "0")}`, "2025-01-01T00:00:00+00:00", i));
    const html = await listHtml();
    expect(html).toContain("melebihi 1.000 baris");
    expect(html).not.toContain("<table");
    expect(listCalls().map(c => [c.args.p_dari, c.args.p_jumlah])).toEqual([[0, 200], [200, 200], [400, 200], [600, 200], [800, 200], [1000, 1]]);
  });
  it("shows exactly 1000 shared rows merged and paginated with the branch row, without duplicates", async () => {
    s.shared = Array.from({ length: 1000 }, (_, i) => sharedRow(`v-${String(i).padStart(5, "0")}`, `2025-01-01T${String(i % 24).padStart(2, "0")}:00:00+00:00`, i));
    s.mode = "semua";
    const html = await listHtml();
    expect(html).toMatch(/RIWAYAT TERSIMPAN<\/div><div[^>]*>1001</);
    expect(html).not.toContain('role="alert"');
    expect(occurrences(html, `href="/klinik/rekam-medis/${A1}"`)).toBe(1);
    expect(html.match(/href="\/klinik\/rekam-medis\/(v-|visit-)[^"]*"/g)).toHaveLength(50);
  });
});

describe("history detail", () => {
  const sharedProps = async (id: string) => {
    const out = await detail(id) as React.ReactElement<Record<string, unknown>>;
    expect(out.type).toBe(RiwayatBersamaDetail);
    return { props: out.props, html: renderToStaticMarkup(out) };
  };
  it.each(["cabang", "semua"] as const)("OWNER (%s) gets the same read-only renderer with date, doctor, clinical fields and therapy", async mode => {
    s.mode = mode;
    const { props, html } = await sharedProps(S1);
    expect((props.row as Record<string, unknown>).visit_id).toBe(S1);
    expect(html).toContain("15 Januari 2026");
    for (const text of ["drh. Uji 1", "Anamnesis uji 1", "Gejala uji 1", "UJI DIAGNOSIS 1 - BUKAN PASIEN NYATA", "UJI TERAPI 1", "UJI KUCING SINTETIS", "UJI SIM REKMED 291026", "baca saja"]) {
      expect(html).toContain(text);
    }
    // No edit/billing/consent/inpatient actions: no form controls and no links out except back to the pet history.
    expect(html).not.toMatch(/<form|<button|<input|<textarea|<select/i);
    expect(html.match(/href="[^"]*"/g)).toEqual([`href="/klinik/rekam-medis?pet=${PET}"`]);
    expect(html).toContain(`href="/klinik/rekam-medis?pet=${PET}"`);
    expect(s.rpcCalls).toEqual([{ name: "detail_riwayat_bersama", args: { p_visit: S1 } }]);
  });
  it("is not found only when the reader answers empty and the normal read found nothing", async () => {
    await expect(detail("visit-tidak-ada")).rejects.toThrow("NOT_FOUND");
  });
  it.each([
    ["the reader is refused", () => { s.rpcError = "detail"; }],
    ["the reader answers malformed", () => { s.detailOverride = { data: { visit_id: S1 }, error: null }; }],
    ["the profile cannot be read", () => { s.profileError = true; }],
    ["the pet belongs to another customer", () => { s.petCustomer = "cust-lain"; }],
    ["the pet cannot be read", () => { s.petError = true; }],
    ["the normal read sees a shared visit the reader refuses", () => { s.mode = "semua"; s.detailOverride = { data: [], error: null }; }],
  ])("shows a generic failure, not 404, when %s", async (_label, setup) => {
    setup();
    const out = await detail(S1) as React.ReactElement;
    expect(out.type).toBe(RekamMedisGagalDimuat);
    const html = renderToStaticMarkup(out);
    expect(html).toContain("Rekam medis belum dapat dimuat");
    expect(html).not.toContain("PRIVATE");
  });
  it("a failing normal read of a non-shared visit is a failure, not 404", async () => {
    s.visitError = true; s.role = "ADMIN";
    expect((await detail(A1) as React.ReactElement).type).toBe(RekamMedisGagalDimuat);
  });
  it.each(["ADMIN", "DOCTOR"])("%s is unchanged: shared visit hidden under the active branch stays not found, no reader call", async role => {
    s.role = role;
    await expect(detail(S1)).rejects.toThrow("NOT_FOUND");
    expect(s.rpcCalls.filter(c => c.name === "detail_riwayat_bersama")).toHaveLength(0);
  });
  it("ADMIN under Semua cabang keeps the existing page (no reader call)", async () => {
    s.role = "ADMIN"; s.mode = "semua";
    const out = await detail(S1) as React.ReactElement;
    expect(out.type).not.toBe(RiwayatBersamaDetail);
    expect(out.type).not.toBe(RekamMedisGagalDimuat);
    expect(s.rpcCalls.filter(c => c.name === "detail_riwayat_bersama")).toHaveLength(0);
  });
  it("OWNER opening a branch visit keeps the existing page (no reader call)", async () => {
    const out = await detail(A1) as React.ReactElement;
    expect(out.type).not.toBe(RiwayatBersamaDetail);
    expect(s.rpcCalls.filter(c => c.name === "detail_riwayat_bersama")).toHaveLength(0);
  });
});
