// C1: layar Absensi Karyawan menampilkan shift terjadwal, telat dari shift, sumber absen, dan selfie;
// tetap jalan sebelum migrasi C1 terpasang (kolom baru belum ada).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";

const fixture = vi.hoisted(() => ({ client: null as unknown, selectAbsen: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/components/EmployeePicker", () => ({ EmployeePicker: () => null }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-11-20" }));
import AbsensiPage from "../../app/(app)/hris/absensi/page";

function klien(kolomBaruAda: boolean) {
  const { client } = clientFixture({ tables: {
    employees: [{ id: "e1", nama: "Ani", jabatan: "Kasir", status: "Aktif" }],
    attendance: [{
      id: "a1", employee_id: "e1", tanggal: "2026-11-20", jam_masuk: "08:20:11", jam_pulang: "16:30:00", status: "Hadir", keterangan: null,
      employees: { nama: "Ani", jabatan: "Kasir" }, sumber: "mandiri", foto_masuk: "e1/2026-11-20/in-x.jpg", foto_pulang: null,
      tanpa_jadwal: false, jarak_masuk_m: 40,
    }],
    employee_schedules: [{ employee_id: "e1", tanggal: "2026-11-20", work_shifts: { nama: "Pagi", jam_masuk: "08:00:00", jam_pulang: "17:00:00", is_libur: false } }],
  } });
  const c = client as unknown as Record<string, unknown> & { from: (t: string) => Record<string, unknown> };
  const asli = c.from.bind(c);
  c.from = (t: string) => {
    const q = asli(t);
    if (t !== "attendance" || kolomBaruAda) return q;
    let baru = false;
    const select = q.select as (...a: unknown[]) => unknown;
    const then = q.then as (r: (v: unknown) => unknown) => unknown;
    q.select = (...a: unknown[]) => { baru = String(a[0]).includes("foto_masuk"); fixture.selectAbsen.push(String(a[0])); select(...a); return q; };
    q.then = (r: (v: unknown) => unknown) => baru
      ? Promise.resolve({ data: null, error: { code: "42703", message: "column attendance.sumber does not exist" } }).then(r)
      : then(r);
    return q;
  };
  c.storage = { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })) }) }) };
  return c;
}

const render = async () => renderToStaticMarkup(await AbsensiPage({ searchParams: Promise.resolve({ tgl: "2026-11-20" }) }));

describe("/hris/absensi (C1)", () => {
  it("shift, telat & pulang cepat dari shift, sumber Mandiri, tautan selfie", async () => {
    fixture.client = klien(true);
    const html = await render();
    expect(html).toContain("Pagi");
    expect(html).toContain("Telat 20 mnt");
    expect(html).toContain("Cepat 30 mnt");
    expect(html).toContain("Mandiri");
    expect(html).toContain("https://signed/e1/2026-11-20/in-x.jpg");
  });
  it("sebelum migrasi C1: tetap tampil tanpa kolom baru", async () => {
    fixture.client = klien(false);
    fixture.selectAbsen = [];
    const html = await render();
    expect(html).toContain("Ani");
    expect(html).toContain("Telat 20 mnt");
    expect(fixture.selectAbsen).toHaveLength(2);
    expect(fixture.selectAbsen[1]).not.toContain("foto_masuk");
  });
});
