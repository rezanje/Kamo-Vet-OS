// D2 (meeting 12 Nov 2026): filter retensi pelanggan "tidak datang N bulan".
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bacaBulanRetensi, batasRetensi, muatTerakhirDatang, retensiBelumAktif } from "../retensi-pelanggan";

vi.stubGlobal("React", React);
const fx = vi.hoisted(() => ({ rpcBuilt: [] as { name: string; args: unknown; count?: string; select?: string; range?: [number, number]; or?: string }[],
  rpcPlain: [] as { name: string; args: unknown }[], tableCalls: [] as string[], retensiError: null as null | { code?: string; message?: string } }));

const ROW = (id: string, name: string) => ({ id, name, phone: "08" + id.slice(-4), tier: "Bronze", points: 0, total_spending: 1000, created_at: "2026-01-01T00:00:00Z", pets: [] });
const ROWS = [ROW("c1000000-0000-4000-8000-000000000001", "Lama Satu"), ROW("c1000000-0000-4000-8000-000000000002", "Lama Dua")];

vi.mock("@/lib/supabase/server", () => {
  const listQuery = (rows: unknown[], err: unknown, rec?: { range?: [number, number]; or?: string }) => {
    let range: [number, number] = [0, 999];
    const q = {
      select() { return q; }, or(f: string) { if (rec) rec.or = f; return q; }, not() { return q; }, order() { return q; }, eq() { return q; }, in() { return q; },
      range(a: number, b: number) { range = [a, b]; if (rec) rec.range = [a, b]; return q; },
      maybeSingle: async () => ({ data: { role: "OWNER" }, error: null }),
      then(resolve: (v: unknown) => void) { return Promise.resolve(err ? { data: null, count: null, error: err } : { data: rows.slice(range[0], range[1] + 1), count: rows.length, error: null }).then(resolve); },
    };
    return q;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    rpc(name: string, args: unknown, opts?: { count?: string }) {
      if (name === "pelanggan_tidak_datang") {
        const rec: { name: string; args: unknown; count?: string; range?: [number, number]; or?: string } = { name, args, count: opts?.count };
        fx.rpcBuilt.push(rec);
        return listQuery(ROWS, fx.retensiError, rec);
      }
      fx.rpcPlain.push({ name, args });
      if (name === "pelanggan_terakhir_datang") return Promise.resolve({ data: [{ customer_id: ROWS[0].id, terakhir_datang: "2026-08-03T02:00:00Z" }], error: null });
      return Promise.resolve({ data: false, error: null });
    },
    from(table: string) {
      fx.tableCalls.push(table);
      if (table === "customers") return listQuery([...ROWS, ROW("c1000000-0000-4000-8000-000000000003", "Baru Tiga")], null);
      return listQuery([], null);
    },
  };
  return { createClient: async () => client };
});

import PelangganPage from "../../app/(app)/crm/pelanggan/page";

type Props = { customers: { id: string; name: string }[]; total: number; retensi: null | { bulan: number; aktif: boolean; batas: string; terakhir: Record<string, string> } };
function clientProps(node: React.ReactNode): Props | null {
  if (!React.isValidElement<{ customers?: unknown; children?: React.ReactNode }>(node)) return null;
  if (node.props.customers) return node.props as unknown as Props;
  for (const child of React.Children.toArray(node.props.children)) { const found = clientProps(child); if (found) return found; }
  return null;
}
const props = async (sp: Record<string, string>) => clientProps(await PelangganPage({ searchParams: Promise.resolve(sp) }))!;

beforeEach(() => { fx.rpcBuilt.length = 0; fx.rpcPlain.length = 0; fx.tableCalls.length = 0; fx.retensiError = null; });

describe("helper", () => {
  it("bacaBulanRetensi: 1..60, selain itu mati", () => {
    expect(bacaBulanRetensi("2")).toBe(2);
    expect(bacaBulanRetensi(" 12 ")).toBe(12);
    for (const x of ["0", "61", "-1", "2.5", "abc", "", undefined, 3]) expect(bacaBulanRetensi(x)).toBeNull();
  });
  it("batasRetensi: N bulan sebelum hari ini (WIB)", () => {
    expect(batasRetensi(2, new Date("2026-11-14T08:00:00Z"))).toBe("2026-09-14");
    expect(batasRetensi(1, new Date("2026-11-13T18:00:00Z"))).toBe("2026-10-14"); // 01.00 WIB 14 Nov
  });
  it("retensiBelumAktif & muatTerakhirDatang fail-safe", async () => {
    expect(retensiBelumAktif({ code: "PGRST202" })).toBe(true);
    expect(retensiBelumAktif({ message: "boom" })).toBe(false);
    expect(await muatTerakhirDatang({ rpc: () => Promise.resolve({ data: null, error: { message: "x" } }) }, ["a"])).toEqual({});
    expect(await muatTerakhirDatang({ rpc: () => { throw new Error("x"); } }, ["a"])).toEqual({});
    expect(await muatTerakhirDatang({ rpc: () => Promise.resolve({ data: [], error: null }) }, [])).toEqual({});
  });
});

describe("halaman CRM › Pelanggan", () => {
  it("tanpa saringan: daftar biasa dari tabel, tanpa fungsi retensi", async () => {
    const p = await props({});
    expect(fx.rpcBuilt).toHaveLength(0);
    expect(p.retensi).toBeNull();
    expect(p.customers.map((c) => c.name)).toContain("Baru Tiga");
  });
  it("?tidak_datang=2: daftar dari fungsi retensi (hitung + halaman + cari) + tanggal terakhir datang", async () => {
    const p = await props({ tidak_datang: "2", cari: "Lama" });
    expect(fx.rpcBuilt[0]).toMatchObject({ name: "pelanggan_tidak_datang", args: { p_bulan: 2 }, count: "exact", range: [0, 49] });
    expect(fx.rpcBuilt[0].or).toBeTruthy();
    expect(p.customers.map((c) => c.name)).toEqual(["Lama Satu", "Lama Dua"]);
    expect(p.total).toBe(2);
    expect(p.retensi).toMatchObject({ bulan: 2, aktif: true, terakhir: { [ROWS[0].id]: "2026-08-03T02:00:00Z" } });
    expect(fx.rpcPlain.find((c) => c.name === "pelanggan_terakhir_datang")?.args).toEqual({ p_ids: ROWS.map((r) => r.id) });
  });
  it("fungsi retensi belum terpasang: daftar biasa + tanda belum aktif, tidak gagal", async () => {
    fx.retensiError = { code: "PGRST202", message: "Could not find the function public.pelanggan_tidak_datang" };
    const p = await props({ tidak_datang: "3" });
    expect(p.customers.map((c) => c.name)).toContain("Baru Tiga");
    expect(p.retensi).toMatchObject({ bulan: 3, aktif: false, terakhir: {} });
    expect(fx.rpcPlain.some((c) => c.name === "pelanggan_terakhir_datang")).toBe(false);
  });
  it("bulan tidak sah: saringan mati", async () => {
    const p = await props({ tidak_datang: "99" });
    expect(p.retensi).toBeNull();
    expect(fx.rpcBuilt).toHaveLength(0);
  });
});

describe("sinkron migrasi", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261118400000_d2_filter_retensi.sql"), "utf8");
  it("fungsi & parameter sama dengan yang dipanggil; satu transaksi", () => {
    expect(sql).toContain("create function public.pelanggan_tidak_datang(p_bulan integer) returns setof public.customers");
    expect(sql).toContain("create function public.pelanggan_terakhir_datang(p_ids uuid[])");
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql.split("\n").slice(0, 3).join("\n").toLowerCase()).toContain("apply as one transaction");
  });
});
