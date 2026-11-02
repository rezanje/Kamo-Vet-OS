import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, type Call, type Reply } from "@/lib/__tests__/helpers/round-trip-client";

// Laporan klinik 2 Nov 2026: pasien shift malam (didaftarkan 1 Nov 20.21/21.11 WIB) yang
// belum diperiksa tuntas / belum dibayar "hilang" dari Antrian setelah 00.00 WIB, padahal
// datanya utuh. Fixture ini menerapkan saringan kueri sungguhan (cabang, tanggal, status,
// urutan, batas) supaya yang diuji adalah baris yang benar-benar dibaca layar.
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  rows: [] as Record<string, unknown>[],
  failCarryOver: false,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/operational-branch", () => ({ resolveOperationalBranch: async () => null, availableOperationalBranches: async () => [] }));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "branch-a", name: "Cimanggis" }) }));
vi.mock("@/app/(app)/klinik/antrian/LiveRefresh", () => ({ LiveRefresh: () => null }));
vi.mock("@/lib/tanggal", async (original) => ({ ...await original<typeof import("@/lib/tanggal")>(), hariIniWIB: () => "2026-11-02" }));
import Page from "@/app/(app)/klinik/antrian/page";

function visit(id: string, status: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    id, status, created_at: createdAt, branch_id: "branch-a", poli: "Poli Umum", dokter: null, keluhan: null,
    queue_number: `Q-${id}`, called_at: null, checked_in_at: null, service_started_at: null,
    service_finished_at: null, checked_out_at: null,
    pets: { name: `Pet ${id}`, species: "Kucing", breed: null, dob: null, photo_url: null },
    customers: { name: `Pemilik ${id}`, phone: "0800", customer_review_statuses: null },
    branches: { code: "VET_CMGG" }, inpatient_records: [], ...extra,
  };
}

const time = (value: unknown) => Date.parse(String(value));
function apply(call: Call): Reply {
  if (call.name !== "visits") return { data: [] };
  const isCarryOver = call.ops.some(([op]) => op === "limit");
  if (isCarryOver && s.failCarryOver) return { error: { message: "private DB detail" } };
  let rows = s.rows.filter((row) => call.ops.every(([op, args]) => {
    const [column, value] = args as [string, unknown];
    switch (op) {
      case "in": return (value as unknown[]).includes(row[column]);
      case "eq": return row[column] === value;
      case "neq": return row[column] !== value;
      case "gte": return time(row[column]) >= time(value);
      case "lt": return time(row[column]) < time(value);
      default: return true;
    }
  }));
  const order = call.ops.find(([op]) => op === "order")?.[1] as [string, { ascending: boolean }] | undefined;
  if (order) rows = [...rows].sort((a, b) => (time(a[order[0]]) - time(b[order[0]])) * (order[1].ascending ? 1 : -1));
  const limit = call.ops.find(([op]) => op === "limit")?.[1][0] as number | undefined;
  return { data: limit === undefined ? rows : rows.slice(0, limit) };
}

async function render(params: Record<string, string> = {}) {
  s.rt = roundTripClient(apply, { userId: "staff-pagi" });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  s.failCarryOver = false;
  s.rows = [
    // Shift malam 1 Nov, belum selesai.
    visit("malam-periksa", "Diperiksa", "2026-11-01T14:11:00Z"), // 21.11 WIB
    visit("malam-bayar", "Pembayaran", "2026-11-01T07:12:00Z"), // 14.12 WIB
    visit("lama-tunggu", "Menunggu", "2026-10-31T11:51:00Z"),
    // Tidak boleh ikut: sudah selesai, rawat inap aktif, cabang lain.
    visit("malam-selesai", "Selesai", "2026-11-01T13:00:00Z"),
    visit("malam-ranap", "Pembayaran", "2026-11-01T10:46:00Z", { inpatient_records: [{ discharged_at: null }] }),
    visit("cabang-lain", "Diperiksa", "2026-11-01T14:00:00Z", { branch_id: "branch-b" }),
    // Hari ini (2 Nov 09.00 WIB).
    visit("pagi", "Menunggu", "2026-11-02T02:00:00Z"),
  ];
});

it("keeps last night's unfinished patients on this morning's default queue with their actions and date", async () => {
  const html = await render();
  expect(html).toContain("BELUM SELESAI DARI HARI SEBELUMNYA · 3 PASIEN");
  expect(html).toContain("Ada 3 pasien dari hari sebelumnya yang belum selesai (1 belum dibayar · 1 sedang diperiksa · 1 belum dipanggil)");
  // Diperiksa → lanjut rekam medis; Pembayaran → Bayar; Menunggu → Panggil/Batal.
  expect(html).toContain('href="/klinik/rekam-medis/malam-periksa"');
  expect(html).toContain('href="/klinik/pembayaran/malam-bayar"');
  expect(html).toContain('name="id" value="lama-tunggu"');
  // Nomor antrian berulang tiap hari, jadi tanggal daftarnya ikut tampil.
  expect(html).toContain("Daftar 1 Nov 21.11");
  expect(html).toContain("Daftar 31 Okt");
  // Yang selesai, rawat inap aktif, dan cabang lain tidak ikut.
  for (const hidden of ["malam-selesai", "malam-ranap", "cabang-lain"]) expect(html).not.toContain(`/klinik/antrian/${hidden}"`);
  // Antrian hari ini tetap ada di bawahnya.
  expect(html).toContain("ANTRIAN HARI INI");
  expect(html).toContain('href="/klinik/antrian/pagi"');
  // Newest first: the night-shift patient is the first leftover row.
  expect(html.indexOf("/klinik/antrian/malam-periksa\"")).toBeLessThan(html.indexOf("/klinik/antrian/lama-tunggu\""));
  expect(html.indexOf("/klinik/antrian/lama-tunggu\"")).toBeLessThan(html.indexOf("ANTRIAN HARI INI"));
});

it("keeps today's counters and next-up to today's registrations", async () => {
  const html = await render();
  expect(html).toMatch(/TOTAL ANTRIAN<\/div><div[^>]*>1<\/div>/);
  const nextUp = html.slice(html.indexOf("PANGGILAN BERIKUTNYA"), html.indexOf("INFORMASI POLI"));
  expect(nextUp).toContain("Pet pagi");
  expect(nextUp).not.toContain("Pet lama-tunggu");
});

it("reads leftovers once, in parallel, only from before today within the active branch", async () => {
  await render();
  const visits = s.rt!.calls.filter((call) => call.name === "visits");
  expect(visits).toHaveLength(3);
  const carry = visits.filter((call) => call.ops.some(([op]) => op === "limit"));
  expect(carry).toHaveLength(1);
  expect(carry[0].ops).toContainEqual(["in", ["branch_id", ["branch-a"]]]);
  expect(carry[0].ops).toContainEqual(["neq", ["status", "Selesai"]]);
  expect(carry[0].ops).toContainEqual(["lt", ["created_at", "2026-11-01T17:00:00.000Z"]]);
  expect(carry[0].ops.some(([op]) => op === "gte")).toBe(false);
  expect(carry[0].ops).toContainEqual(["limit", [200]]);
  expect(new Set(visits.map((call) => call.wave)).size).toBe(1);
});

it("does not mix leftovers into a past date's history view", async () => {
  const html = await render({ tanggal: "2026-11-01" });
  expect(s.rt!.calls.filter((call) => call.name === "visits")).toHaveLength(2);
  expect(html).not.toContain("BELUM SELESAI DARI HARI SEBELUMNYA");
  expect(html).not.toContain("pasien dari hari sebelumnya");
  expect(html).toContain('href="/klinik/rekam-medis/malam-periksa"');
  expect(html).toContain("Sedang melihat antrian 2026-11-01, bukan hari ini.");
});

it("follows the status tab and still points to the leftovers from the Selesai tab", async () => {
  const waiting = await render({ filter: "menunggu" });
  expect(waiting).toContain("BELUM SELESAI DARI HARI SEBELUMNYA · 1 PASIEN");
  expect(waiting).toContain('name="id" value="lama-tunggu"');
  expect(waiting).not.toContain('href="/klinik/rekam-medis/malam-periksa"');

  const done = await render({ filter: "selesai" });
  expect(done).not.toContain("BELUM SELESAI DARI HARI SEBELUMNYA");
  expect(done).toContain("Ada 3 pasien dari hari sebelumnya yang belum selesai");
  expect(done).toContain("Lihat di tab Aktif");
});

it("says so when the leftover list is capped instead of silently dropping older patients", async () => {
  s.rows = Array.from({ length: 205 }, (_, i) =>
    visit(`sisa-${i}`, "Pembayaran", new Date(Date.parse("2026-10-20T03:00:00Z") + i * 60_000).toISOString()));
  const html = await render();
  expect(html).toContain("BELUM SELESAI DARI HARI SEBELUMNYA · 200 PASIEN");
  expect(html).toContain("Menampilkan 200 pasien terbaru");
});

it("treats a failed leftover read as a failed queue, not as 'nothing left over'", async () => {
  s.failCarryOver = true;
  const html = await render();
  expect(html).toContain("Antrian gagal dimuat");
  expect(html).not.toContain("private DB detail");
  expect(html).not.toContain("TOTAL ANTRIAN");
});
