import { expect, it } from "vitest";
import {
  pilihanCabangJadwal,
  pilihanShiftJadwal,
  pesanJadwal,
  bolehUbahShift,
} from "../schedule-request";
const row = {
  tanggal: "2026-10-02",
  shift_id: "old",
  shift: { branch_id: "b" },
};
it("only lists branches assigned by the schedule day and matching the original branch", () => {
  expect(
    pilihanCabangJadwal(row, [
      { id: "b", name: "B", effective_date: "2026-10-01" },
      { id: "other", name: "Other", effective_date: "2026-01-01" },
      { id: "b", name: "Future", effective_date: "2026-10-03" },
    ]),
  ).toEqual([{ id: "b", name: "B", effective_date: "2026-10-01" }]);
});
it("shift choices exclude inactive, original, and foreign-branch options", () => {
  const shifts = [
    { id: "new", branch_id: "b", is_active: true },
    { id: "global", branch_id: null, is_active: true },
    { id: "old", branch_id: "b", is_active: true },
    { id: "inactive", branch_id: "b", is_active: false },
    { id: "foreign", branch_id: "c", is_active: true },
  ];
  expect(pilihanShiftJadwal(row, shifts, "b").map((s) => s.id)).toEqual([
    "new",
    "global",
  ]);
});
it("reports absent migration and concurrent writes without exposing arbitrary DB errors", () => {
  expect(
    pesanJadwal({ code: "PGRST202", message: "internal function" }),
  ).toMatch(/belum aktif/);
  expect(
    pesanJadwal({ code: "40P01", message: "private deadlock details" }),
  ).toMatch(/Muat ulang/);
  expect(pesanJadwal({ message: "secret DB connection" })).not.toContain(
    "secret",
  );
});

it("branch admins cannot edit global or foreign shifts; owner can", () => {
  expect(bolehUbahShift("ADMIN", null, ["b"])).toBe(false);
  expect(bolehUbahShift("ADMIN", "c", ["b"])).toBe(false);
  expect(bolehUbahShift("ADMIN", "b", ["b"])).toBe(true);
  expect(bolehUbahShift("OWNER", null, [])).toBe(true);
  expect(bolehUbahShift("STAFF", "b", ["b"])).toBe(false);
});
