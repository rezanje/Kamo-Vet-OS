import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../master-guard", () => ({
  assertRole: async () => ({
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ name, args });
      return { error: null };
    },
  }),
}));
vi.mock("../supabase/server", () => ({
  createClient: async () => {
    throw new Error("Use authorized RPC");
  },
}));
import {
  koreksiAbsensi,
  simpanAbsensi,
  selesaikanSesiFinal,
} from "../../app/(app)/hris/absensi/actions";
beforeEach(() => {
  state.calls = [];
});
it("corrects explicit overnight WIB timestamps with original version and reason", async () => {
  const f = new FormData();
  Object.entries({
    id: "a",
    tgl: "2026-09-30",
    updated_at: "2026-10-01T01:00:00.123456Z",
    checked_in_at: "2026-09-30T20:00",
    checked_out_at: "2026-10-01T08:00",
    reason: "Tutup sesi lupa",
  }).forEach(([k, v]) => f.set(k, v));
  await expect(koreksiAbsensi(f)).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_correct_attendance",
      args: {
        p_id: "a",
        p_expected_updated_at: "2026-10-01T01:00:00.123456Z",
        p_checked_in_at: "2026-09-30T20:00:00+07:00",
        p_checked_out_at: "2026-10-01T08:00:00+07:00",
        p_reason: "Tutup sesi lupa",
        p_void: false,
      },
    },
  ]);
});
it("new manual record uses separate checkout date, not a same-day guess", async () => {
  const f = new FormData();
  Object.entries({
    employee_id: "e",
    tanggal: "2026-09-30",
    jam_masuk: "20:00",
    tanggal_pulang: "2026-10-01",
    jam_pulang: "08:00",
    status: "Hadir",
    keterangan: "Catatan fiktif",
  }).forEach(([k, v]) => f.set(k, v));
  await expect(simpanAbsensi(f)).rejects.toThrow("success=");
  expect(state.calls[0]).toMatchObject({
    name: "hris_record_attendance",
    args: {
      p_checked_in_at: "2026-09-30T20:00:00+07:00",
      p_checked_out_at: "2026-10-01T08:00:00+07:00",
    },
  });
});
it("preserves original sub-second timestamps when only the other field is edited", async () => {
  const f = new FormData();
  Object.entries({
    id: "a",
    tgl: "2026-09-30",
    updated_at: "2026-10-01T01:00:00.123456Z",
    checked_in_at: "2026-09-30T20:00:00.123",
    checked_in_at_original: "2026-09-30T13:00:00.123456Z",
    checked_out_at: "2026-10-01T08:00",
    reason: "Koreksi jam pulang",
  }).forEach(([k, v]) => f.set(k, v));
  await expect(koreksiAbsensi(f)).rejects.toThrow("success=");
  expect(state.calls[0]).toMatchObject({
    args: { p_checked_in_at: "2026-09-30T13:00:00.123456Z" },
  });
});
it("resolves a finalized old open session without sending guessed times or void", async () => {
  const f = new FormData();
  Object.entries({
    id: "a",
    tgl: "2026-09-30",
    updated_at: "2026-10-01T01:00:00.123456Z",
    reason: "Lepas blokir sesi warisan final",
  }).forEach(([k, v]) => f.set(k, v));
  await expect(selesaikanSesiFinal(f)).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_resolve_final_attendance",
      args: {
        p_id: "a",
        p_expected_updated_at: "2026-10-01T01:00:00.123456Z",
        p_reason: "Lepas blokir sesi warisan final",
      },
    },
  ]);
});
