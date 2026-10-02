import { expect, it } from "vitest";
import {
  rekapJadwal,
  buatExcelRekap,
  type DataRekap,
} from "../attendance-recap";
import ExcelJS from "exceljs";
const shift = {
  id: "s",
  nama: "Malam",
  is_libur: false,
  jam_masuk: "20:00:00",
  jam_pulang: "08:00:00",
  branch_id: "b",
};
const base = (): DataRekap => ({
  start: "2026-09-30",
  end: "2026-10-02",
  branch_id: null,
  employees: [{ id: "e", nama: "Fiksi" }],
  assignments: [
    { employee_id: "e", branch_id: "b", effective_date: "2026-01-01" },
  ],
  schedules: [{ employee_id: "e", tanggal: "2026-09-30", shift }],
  attendance: [
    {
      id: "a",
      employee_id: "e",
      tanggal: "2026-09-30",
      jam_masuk: "20:00:00",
      jam_pulang: "08:00:00",
      checked_in_at: "2026-09-30T13:00:00Z",
      checked_out_at: "2026-10-01T01:00:00Z",
      branch_id: "b",
      is_void: false,
      status: "Hadir",
    },
  ],
  leave: [],
  overtime: [],
});
it("overnight completed session is 720 minutes on entry date, not negative next-day duration", () => {
  const r = rekapJadwal(base(), "2026-10-02");
  expect(r.daily[0].menitKerja).toBe(720);
  expect(r.daily[0].tanggal).toBe("2026-09-30");
  expect(r.summaries[0].menitKerja).toBe(720);
  expect(r.daily[0].flags).toEqual([]);
});
it("approved effective 08:00 shift makes arrival at 08:00 zero lateness", () => {
  const d = base();
  d.schedules[0].shift = {
    ...shift,
    jam_masuk: "08:00:00",
    jam_pulang: "16:00:00",
  };
  d.attendance[0] = {
    ...d.attendance[0],
    jam_masuk: "08:00:00",
    checked_in_at: "2026-09-30T01:00:00Z",
    checked_out_at: "2026-09-30T09:00:00Z",
  };
  expect(rekapJadwal(d, "2026-10-02").daily[0].detikTelat).toBe(0);
});
it("approved leave suppresses past absence while future schedule remains upcoming", () => {
  const d = base();
  d.attendance = [];
  d.leave = [
    {
      employee_id: "e",
      jenis: "Cuti",
      tanggal_mulai: "2026-09-30",
      tanggal_selesai: "2026-09-30",
    },
  ];
  d.schedules.push({ ...d.schedules[0], tanggal: "2026-10-02" });
  const r = rekapJadwal(d, "2026-10-01");
  expect(r.daily.map((x) => x.status)).toEqual(["Cuti", "Belum tiba"]);
  expect(r.summaries[0].bolos).toBe(0);
  expect(r.summaries[0].cuti).toBe(1);
});
it("unknown legacy worked duration remains null and flags a correction rather than inventing hours", () => {
  const d = base();
  d.attendance[0].checked_in_at = null;
  d.attendance[0].checked_out_at = null;
  const r = rekapJadwal(d, "2026-10-02");
  expect(r.daily[0].menitKerja).toBeNull();
  expect(r.daily[0].flags).toContain("Durasi legacy belum diketahui");
  expect(r.summaries[0].hariJamTidakDiketahui).toBe(1);
});
it("void sessions do not count as presence and past scheduled day is absent", () => {
  const d = base();
  d.attendance[0].is_void = true;
  const r = rekapJadwal(d, "2026-10-02");
  expect(r.summaries[0].hadir).toBe(0);
  expect(r.summaries[0].bolos).toBe(1);
});
it("raw subminute lateness remains a fact and approved overtime is separate from duration", () => {
  const d = base();
  d.attendance[0].checked_in_at = "2026-09-30T13:00:30Z";
  d.overtime = [{ employee_id: "e", tanggal: "2026-09-30", jam: 1.5 }];
  const row = rekapJadwal(d, "2026-10-02").daily[0];
  expect(row.detikTelat).toBe(30);
  expect(row.menitLemburDisetujui).toBe(90);
  expect(row.menitKerja).toBe(719.5);
});
it("unscheduled presence, leave conflict and open sessions are visible anomalies", () => {
  const d = base();
  d.schedules = [];
  d.leave = [
    {
      employee_id: "e",
      jenis: "Sakit",
      tanggal_mulai: "2026-09-30",
      tanggal_selesai: null,
    },
  ];
  d.attendance[0].checked_out_at = null;
  const row = rekapJadwal(d, "2026-10-02").daily[0];
  expect(row.flags).toEqual(
    expect.arrayContaining([
      "Absensi tanpa jadwal",
      "Absensi bersamaan dengan izin/cuti",
      "Sesi belum ditutup",
    ]),
  );
});
it("branch filter uses historical session/shift instead of current primary employee branch", () => {
  const d = base();
  d.branch_id = "other";
  expect(rekapJadwal(d, "2026-10-02").daily).toEqual([]);
  d.schedules[0].shift = { ...shift, branch_id: null };
  d.attendance = [];
  d.assignments.push({
    employee_id: "e",
    branch_id: "other",
    effective_date: "2026-01-01",
  });
  const row = rekapJadwal(d, "2026-10-02").daily[0];
  expect(row.flags).toContain("Cabang jadwal belum pasti");
  expect(row.status).toBe("Perlu koreksi");
});
it("Excel and daily summary retain more than 1,000 source rows without rounding unknown duration to zero", async () => {
  const d = base();
  d.employees = [];
  d.schedules = [];
  d.attendance = [];
  for (let i = 0; i < 1100; i++) {
    const e = "e" + i;
    d.employees.push({ id: e, nama: "Fiksi " + i });
    d.schedules.push({ employee_id: e, tanggal: "2026-09-30", shift });
  }
  const r = rekapJadwal(d, "2026-10-02");
  expect(r.daily).toHaveLength(1100);
  const bytes = await buatExcelRekap(r);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  expect(book.getWorksheet("Harian")?.rowCount).toBe(1101);
  expect(book.getWorksheet("Ringkasan")?.rowCount).toBe(1101);
});
