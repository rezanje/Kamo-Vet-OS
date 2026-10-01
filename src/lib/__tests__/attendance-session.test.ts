import { expect, it } from "vitest";
import { pilihSesiAbsensi, menitSesi } from "../attendance-session";
const row = {
  id: "a",
  tanggal: "2026-09-30",
  jam_masuk: "20:00",
  jam_pulang: null,
  checked_in_at: "2026-09-30T13:00:00Z",
  checked_out_at: null,
  is_void: false,
  branch_id: "b",
};
it("offers checkout of prior-day open session at next month 08 WIB", () => {
  expect(pilihSesiAbsensi([row], null, "2026-10-01T01:00:00Z")).toMatchObject({
    action: "clockOut",
    row: { id: "a" },
    correction: false,
  });
});
it("measures overnight elapsed time only from explicit timestamps", () => {
  expect(menitSesi({ ...row, checked_out_at: "2026-10-01T01:00:00Z" })).toBe(
    720,
  );
});
it("does not guess hours for legacy or still-open sessions", () => {
  expect(menitSesi(row)).toBeNull();
  expect(
    menitSesi({
      ...row,
      checked_in_at: null,
      checked_out_at: "2026-10-01T01:00:00Z",
    }),
  ).toBeNull();
});
it.each([
  { opens: [{ ...row, checked_in_at: null }] },
  { opens: [{ ...row, tanggal: "2026-09-28" }] },
  { opens: [row, row] },
])(
  "requires correction for legacy, stale and multiple open sessions %j",
  ({ opens }) => {
    expect(pilihSesiAbsensi(opens, null, "2026-10-01T01:00:00Z")).toMatchObject(
      { action: null, correction: true },
    );
  },
);
it("does not let voided rows block a new clock-in", () => {
  expect(
    pilihSesiAbsensi([], { ...row, is_void: true }, "2026-10-01T01:00:00Z"),
  ).toMatchObject({ action: "clockIn" });
});
it("rejects negative/invalid elapsed timestamps", () => {
  expect(
    menitSesi({ ...row, checked_out_at: "2026-09-30T12:00:00Z" }),
  ).toBeNull();
});
