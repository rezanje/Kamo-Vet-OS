import { expect, it } from "vitest";
import {
  resolvePayrollPolicy,
  componentsForPeriod,
} from "../payroll-effective";
import { ATURAN_KOSONG } from "../payroll-aturan";
const policy = (
  id: string,
  from: string,
  group: string | null,
  rate: number,
) => ({
  id,
  effective_date: from,
  group_id: group,
  values: { ...ATURAN_KOSONG, lembur_per_jam: rate },
});
const policies = [
  policy("global", "2026-10-10", null, 500),
  policy("group", "2026-10-12", "g", 1000),
];
const memberships = [
  {
    id: "m",
    employee_id: "e",
    group_id: "g",
    valid_from: "2026-10-15",
    valid_to: "2026-10-20",
  },
];
it("exact policy and membership boundaries preserve prior zero default", () => {
  const resolve = (date: string) =>
    resolvePayrollPolicy("e", date, ATURAN_KOSONG, policies, memberships);
  expect(resolve("2026-10-09").lembur_per_jam).toBe(0);
  expect(resolve("2026-10-10").lembur_per_jam).toBe(500);
  expect(resolve("2026-10-14").lembur_per_jam).toBe(500);
  expect(resolve("2026-10-15").lembur_per_jam).toBe(1000);
  expect(resolve("2026-10-20").lembur_per_jam).toBe(1000);
  expect(resolve("2026-10-21").lembur_per_jam).toBe(500);
});
it("overlapping employee groups fail instead of choosing an arbitrary pay rate", () => {
  expect(() =>
    resolvePayrollPolicy("e", "2026-10-16", ATURAN_KOSONG, policies, [
      ...memberships,
      { ...memberships[0], id: "other", group_id: "other" },
    ]),
  ).toThrow();
});
it("monthly fixed changes and one-period variable components are separated", () => {
  const masters = [
    {
      id: "v1",
      component_id: "c",
      effective_period: "0001-01",
      nama: "Fiction meal",
      tipe: "tunjangan",
      nominal: 500,
      is_active: true,
    },
    {
      id: "v2",
      component_id: "c",
      effective_period: "2026-11",
      nama: "Fiction meal",
      tipe: "tunjangan",
      nominal: 650,
      is_active: true,
    },
  ];
  const fixed = [
    {
      id: "a1",
      employee_id: "e",
      component_id: "c",
      effective_period: "2026-10",
      nominal: null,
      is_active: true,
    },
  ];
  const variable = [
    {
      id: "p1",
      employee_id: "e",
      periode: "2026-10",
      nama: "Fiction one-off",
      tipe: "tunjangan",
      nominal: 50,
      is_active: true,
    },
  ];
  expect(componentsForPeriod("e", "2026-09", masters, fixed, variable)).toEqual(
    [],
  );
  expect(
    componentsForPeriod("e", "2026-10", masters, fixed, variable).reduce(
      (a, r) => a + r.nominal,
      0,
    ),
  ).toBe(550);
  expect(
    componentsForPeriod("e", "2026-11", masters, fixed, variable).reduce(
      (a, r) => a + r.nominal,
      0,
    ),
  ).toBe(650);
});

it("same-date correction chooses its latest audited sequence", () => {
  expect(
    resolvePayrollPolicy(
      "e",
      "2026-10-10",
      ATURAN_KOSONG,
      [
        { ...policy("old", "2026-10-10", null, 100), sequence: 1 },
        { ...policy("new", "2026-10-10", null, 200), sequence: 2 },
      ],
      [],
    ).lembur_per_jam,
  ).toBe(200);
});
