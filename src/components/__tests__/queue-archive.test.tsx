import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, type Call, type Reply } from "@/lib/__tests__/helpers/round-trip-client";

// Andri 4 Nov 2026: antrean yang menumpuk (percobaan / dibatalkan / sisa migrasi) harus bisa disembunyikan tanpa dihapus:
// tab "Diarsipkan", hanya OWNER/ADMIN yang melihat tab dan tombolnya; semua tab kerja, penghitung, "Panggilan berikutnya" dan
// bagian "belum selesai dari hari sebelumnya" TIDAK memuat kunjungan yang diarsipkan.
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  rows: [] as Record<string, unknown>[],
  role: "STAFF" as string | null,
  active: true,
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
    service_finished_at: null, checked_out_at: null, archived_at: null, archived_by: null, archive_reason: null,
    pets: { name: `Pet ${id}`, species: "Kucing", breed: null, dob: null, photo_url: null },
    customers: { name: `Pemilik ${id}`, phone: "0800", customer_review_statuses: null },
    branches: { code: "VET_CMGG" }, inpatient_records: [], ...extra,
  };
}
const archivedFields = { archived_at: "2026-11-02T01:00:00Z", archived_by: "admin-1", archive_reason: "Percobaan batal fiktif" };

const time = (value: unknown) => Date.parse(String(value));
function apply(call: Call): Reply {
  if (call.name === "profiles") {
    return call.single ? { data: s.role ? { role: s.role, is_active: s.active } : null } : { data: [{ id: "admin-1", full_name: "Admin Fiktif" }] };
  }
  if (call.name !== "visits") return { data: [] };
  let rows = s.rows.filter((row) => call.ops.every(([op, args]) => {
    const [column, value] = args as [string, unknown];
    switch (op) {
      case "in": return (value as unknown[]).includes(row[column]);
      case "eq": return row[column] === value;
      case "neq": return row[column] !== value;
      case "gte": return time(row[column]) >= time(value);
      case "lt": return time(row[column]) < time(value);
      case "is": return row[column] === value;
      case "not": { const [, , v] = args as [string, string, unknown]; return row[column] !== v; }
      default: return true;
    }
  }));
  const order = call.ops.find(([op]) => op === "order")?.[1] as [string, { ascending: boolean }] | undefined;
  if (order) rows = [...rows].sort((a, b) => (time(a[order[0]]) - time(b[order[0]])) * (order[1].ascending ? 1 : -1));
  const limit = call.ops.find(([op]) => op === "limit")?.[1][0] as number | undefined;
  return { data: limit === undefined ? rows : rows.slice(0, limit) };
}

async function render(params: Record<string, string> = {}) {
  s.rt = roundTripClient(apply, { userId: "user-1" });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}
const visitCalls = () => s.rt!.calls.filter((call) => call.name === "visits");

beforeEach(() => {
  s.role = "STAFF"; s.active = true;
  s.rows = [
    visit("pagi", "Menunggu", "2026-11-02T02:00:00Z"),
    visit("pagi-periksa", "Diperiksa", "2026-11-02T03:00:00Z"),
    // Diarsipkan: hari ini (Menunggu + Diperiksa) dan sisa hari lalu (Diperiksa macet).
    visit("arsip-tunggu", "Menunggu", "2026-11-02T01:30:00Z", archivedFields),
    visit("arsip-periksa", "Diperiksa", "2026-11-02T01:40:00Z", archivedFields),
    visit("arsip-lama", "Diperiksa", "2026-10-20T03:00:00Z", { ...archivedFields, archive_reason: "Sisa migrasi fiktif" }),
    // Sisa hari lalu yang masih sah.
    visit("sisa-sah", "Pembayaran", "2026-11-01T07:00:00Z"),
  ];
});

for (const role of ["OWNER", "ADMIN"]) {
  it(`${role} sees the 'Diarsipkan' tab and the Arsipkan control (with a required reason) on working rows`, async () => {
    s.role = role;
    const html = await render();
    expect(html).toContain("Diarsipkan");
    expect(html).toContain("filter=diarsipkan");
    expect(html).toContain("Arsipkan");
    expect(html).toMatch(/name="reason"[^>]*required|required[^>]*name="reason"/);
    expect(html).toMatch(/name="request_key"/);
  });
}

for (const role of ["STAFF", "DOCTOR", "FINANCE", null]) {
  it(`${role ?? "unknown"} never sees the tab or any archive control, and archived rows are never read for the Diarsipkan filter`, async () => {
    s.role = role;
    const html = await render();
    expect(html).not.toContain("Diarsipkan");
    expect(html).not.toContain("Arsipkan");
    expect(html).not.toContain("Pulihkan");
    const forced = await render({ filter: "diarsipkan" });
    expect(forced).not.toContain("Pulihkan");
    expect(forced).not.toContain("Sisa migrasi fiktif");
    expect(forced).not.toContain("Pet arsip-");
    // Tidak ada pembacaan baris arsip sama sekali untuk peran ini (RLS visits tidak membedakan peran).
    expect(visitCalls().some((call) => call.ops.some(([op]) => op === "not"))).toBe(false);
  });
}

it("an inactive OWNER profile is treated as no role: no tab, no controls", async () => {
  s.role = "OWNER"; s.active = false;
  const html = await render();
  expect(html).not.toContain("Diarsipkan");
  expect(html).not.toContain("Arsipkan");
});

it("every working tab excludes archived visits, including the leftovers from earlier days", async () => {
  s.role = "STAFF";
  for (const filter of ["semua", "aktif", "menunggu", "diperiksa", "selesai"]) {
    const html = await render({ filter });
    expect(html, filter).not.toContain("arsip-tunggu");
    expect(html, filter).not.toContain("arsip-periksa");
    expect(html, filter).not.toContain("arsip-lama");
  }
  const aktif = await render({ filter: "aktif" });
  expect(aktif).toContain("pagi-periksa");
  expect(aktif).toContain("sisa-sah");
});

it("filters archived rows in EVERY visits read of the page (list, counters, leftovers) server-side", async () => {
  await render({ filter: "aktif" });
  const calls = visitCalls();
  expect(calls).toHaveLength(3);
  for (const call of calls) expect(call.ops).toContainEqual(["is", ["archived_at", null]]);
  // The leftovers read keeps its cap: archived rows must not eat the 200-row window.
  const carry = calls.filter((call) => call.ops.some(([op]) => op === "limit"));
  expect(carry).toHaveLength(1);
  expect(carry[0].ops).toContainEqual(["is", ["archived_at", null]]);
});

it("counters, next-up and the leftover banner do not count archived visits", async () => {
  s.role = "OWNER";
  const html = await render();
  expect(html).toMatch(/TOTAL ANTRIAN<\/div><div[^>]*>2<\/div>/);          // pagi + pagi-periksa, bukan 4
  expect(html).toMatch(/MENUNGGU<\/div><div[^>]*>1<\/div>/);
  expect(html).toMatch(/SEDANG DIPERIKSA<\/div><div[^>]*>1<\/div>/);        // arsip-periksa tidak dihitung
  const nextUp = html.slice(html.indexOf("PANGGILAN BERIKUTNYA"), html.indexOf("INFORMASI POLI"));
  expect(nextUp).toContain("Pet pagi");
  expect(nextUp).not.toContain("arsip-tunggu");
  expect(html).toContain("Ada 1 pasien dari hari sebelumnya yang belum selesai (1 belum dibayar)");
  expect(html).toContain("BELUM SELESAI DARI HARI SEBELUMNYA · 1 PASIEN");
});

it("Diarsipkan tab (OWNER/ADMIN): lists archived visits of any day with reason, who and when, plus a Pulihkan form; no call/examine/pay actions", async () => {
  s.role = "ADMIN";
  const html = await render({ filter: "diarsipkan" });
  for (const id of ["arsip-tunggu", "arsip-periksa", "arsip-lama"]) expect(html).toContain(`/klinik/antrian/${id}"`);
  expect(html).toContain("Percobaan batal fiktif");
  expect(html).toContain("Sisa migrasi fiktif");
  expect(html).toContain("Admin Fiktif");
  expect(html).toContain("Pulihkan");
  expect(html).toContain('name="id" value="arsip-lama"');
  // Panggilan berikutnya di sidebar tetap memakai kunjungan yang BELUM diarsipkan; tabelnya tanpa Panggil.
  const tabel = html.slice(0, html.indexOf("PANGGILAN BERIKUTNYA"));
  expect(tabel).not.toContain('name="status" value="Diperiksa"');
  expect(tabel).not.toContain("Panggil");
  expect(html).not.toContain('href="/klinik/pembayaran/arsip-');
  expect(html).not.toContain('href="/klinik/rekam-medis/arsip-');
  expect(html).not.toContain("Pet pagi-periksa");
  expect(html).not.toContain("Pet sisa-sah");
  // Archived-only read: server-side, capped.
  const archived = visitCalls().find((call) => call.ops.some(([op]) => op === "not"));
  expect(archived).toBeTruthy();
  expect(archived!.ops).toContainEqual(["not", ["archived_at", "is", null]]);
  expect(archived!.ops.some(([op]) => op === "limit")).toBe(true);
});

it("the Arsipkan control is absent on Selesai rows and on rows in the Diarsipkan tab", async () => {
  s.role = "OWNER";
  s.rows = [visit("tuntas", "Selesai", "2026-11-02T02:00:00Z"), visit("arsip-x", "Diperiksa", "2026-11-02T02:10:00Z", archivedFields)];
  const done = await render({ filter: "selesai" });
  expect(done).toContain("tuntas");
  expect(done).not.toContain("Arsipkan");
  const tab = await render({ filter: "diarsipkan" });
  expect(tab).not.toContain('action="Arsipkan"');
  expect(tab.match(/Arsipkan/g) ?? []).toHaveLength(0);
});

it("shows the action error and the archive success messages (redirect target of the actions)", async () => {
  s.role = "OWNER";
  expect(await render({ error: "Kunjungan tidak dapat diarsipkan karena sudah ada pembayaran." })).toContain("sudah ada pembayaran");
  expect(await render({ success: "arsip" })).toContain("diarsipkan");
  expect(await render({ success: "pulih" })).toContain("dipulihkan");
});
