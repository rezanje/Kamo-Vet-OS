import { rentangTanggal, tanggalWIB } from "./tanggal";
import type { SesiAbsensi } from "./attendance-session";
export type RekapShift = {
  id: string;
  nama: string;
  is_libur: boolean;
  jam_masuk: string | null;
  jam_pulang: string | null;
  branch_id: string | null;
};
export type DataRekap = {
  start: string;
  end: string;
  branch_id: string | null;
  employees: { id: string; nama: string }[];
  assignments: {
    employee_id: string;
    branch_id: string;
    effective_date: string;
  }[];
  schedules: { employee_id: string; tanggal: string; shift: RekapShift }[];
  attendance: (SesiAbsensi & { employee_id: string; status: string })[];
  leave: {
    employee_id: string;
    jenis: string;
    tanggal_mulai: string;
    tanggal_selesai: string | null;
  }[];
  overtime: { employee_id: string; tanggal: string; jam: number }[];
};
export type HariRekap = {
  employeeId: string;
  nama: string;
  tanggal: string;
  branchId: string | null;
  shift: string;
  status: string;
  terjadwal: boolean;
  isLibur: boolean;
  masuk: string | null;
  pulang: string | null;
  menitKerja: number | null;
  detikTelat: number;
  menitLemburDisetujui: number;
  flags: string[];
};
export type RingkasanRekap = {
  employeeId: string;
  nama: string;
  hariKerja: number;
  hadir: number;
  bolos: number;
  cuti: number;
  izin: number;
  sakit: number;
  hariTelat: number;
  detikTelat: number;
  menitKerja: number;
  hariJamTidakDiketahui: number;
  menitLemburDisetujui: number;
  hariBermasalah: number;
};
const timeMs = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const seconds = (value: string | null) => {
  if (!value) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(value);
  if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) >= 60) return null;
  return +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0);
};
export function rekapJadwal(d: DataRekap, today: string) {
  const names = new Map(d.employees.map((e) => [e.id, e.nama]));
  const schedule = new Map(
    d.schedules.map((s) => [`${s.employee_id}|${s.tanggal}`, s]),
  );
  const attendance = new Map(
    d.attendance
      .filter((a) => !a.is_void)
      .map((a) => [`${a.employee_id}|${a.tanggal}`, a]),
  );
  const leave = new Map<string, string[]>();
  for (const l of d.leave) {
    if (!["Cuti", "Izin", "Sakit"].includes(l.jenis)) continue;
    const start = l.tanggal_mulai < d.start ? d.start : l.tanggal_mulai;
    const end =
      (l.tanggal_selesai ?? l.tanggal_mulai) > d.end
        ? d.end
        : (l.tanggal_selesai ?? l.tanggal_mulai);
    for (const date of rentangTanggal(start, end)) {
      const key = `${l.employee_id}|${date}`;
      leave.set(key, [...(leave.get(key) ?? []), l.jenis]);
    }
  }
  const overtime = new Map<string, number>();
  for (const o of d.overtime) {
    const k = `${o.employee_id}|${o.tanggal}`;
    overtime.set(k, (overtime.get(k) ?? 0) + Number(o.jam) * 60);
  }
  const keys = new Set([
    ...schedule.keys(),
    ...attendance.keys(),
    ...leave.keys(),
    ...overtime.keys(),
  ]);
  const daily: HariRekap[] = [];
  for (const key of keys) {
    const [e, date] = key.split("|");
    if (!names.has(e) || date < d.start || date > d.end) continue;
    const s = schedule.get(key);
    const a = attendance.get(key);
    const l = leave.get(key) ?? [];
    const branches = [
      ...new Set(
        d.assignments
          .filter((x) => x.employee_id === e && x.effective_date <= date)
          .map((x) => x.branch_id),
      ),
    ];
    const branchId =
      a?.branch_id ??
      s?.shift.branch_id ??
      (branches.length === 1 ? branches[0] : null);
    if (d.branch_id && branchId && branchId !== d.branch_id) continue;
    if (d.branch_id && !branchId && !branches.includes(d.branch_id)) continue;
    const flags: string[] = [];
    const started = !!a?.jam_masuk;
    const inMs = timeMs(a?.checked_in_at ?? null);
    const outMs = timeMs(a?.checked_out_at ?? null);
    const unknownBranch = !branchId && !!s;
    if (unknownBranch) flags.push("Cabang jadwal belum pasti");
    if (a && !s) flags.push("Absensi tanpa jadwal");
    if (a && l.length) flags.push("Absensi bersamaan dengan izin/cuti");
    if (l.length > 1) flags.push("Izin/cuti bertumpuk");
    if (a?.branch_id && s?.shift.branch_id && a.branch_id !== s.shift.branch_id)
      flags.push("Cabang absensi berbeda dari shift");
    let menitKerja: number | null = null;
    let detikTelat = 0;
    if (started) {
      if (inMs === null) flags.push("Durasi legacy belum diketahui");
      else if (outMs === null)
        flags.push(
          a?.checked_out_at
            ? "Timestamp pulang tidak valid"
            : "Sesi belum ditutup",
        );
      else if (outMs < inMs) flags.push("Urutan timestamp tidak valid");
      else menitKerja = (outMs - inMs) / 60000;
      if (inMs !== null && tanggalWIB(new Date(inMs).toISOString()) !== date)
        flags.push("Tanggal masuk berbeda dari catatan");
      if (s && !s.shift.is_libur) {
        const expected = seconds(s.shift.jam_masuk);
        if (expected === null) flags.push("Jam shift tidak tersedia");
        else if (inMs !== null) {
          const startMs = Date.parse(`${date}T${s.shift.jam_masuk}+07:00`);
          if (Number.isFinite(startMs))
            detikTelat = Math.max(0, (inMs - startMs) / 1000);
        } else {
          const actual = seconds(a?.jam_masuk ?? null);
          if (actual !== null) detikTelat = Math.max(0, actual - expected);
        }
      }
    } else if (a) flags.push("Absensi tanpa jam masuk");
    const approved = overtime.get(key) ?? 0;
    if (approved > 0 && menitKerja !== null && approved > menitKerja)
      flags.push("Lembur disetujui melebihi durasi tercatat");
    const status = started
      ? "Hadir"
      : (l[0] ??
        (unknownBranch
          ? "Perlu koreksi"
          : s?.shift.is_libur
            ? "Libur"
            : s
              ? date >= today
                ? "Belum tiba"
                : "Alpha"
              : approved
                ? "Lembur disetujui"
                : "Tanpa jadwal"));
    daily.push({
      employeeId: e,
      nama: names.get(e)!,
      tanggal: date,
      branchId,
      shift: s?.shift.nama ?? "—",
      status,
      terjadwal: !!s,
      isLibur: !!s?.shift.is_libur,
      masuk: a?.checked_in_at ?? a?.jam_masuk ?? null,
      pulang: a?.checked_out_at ?? a?.jam_pulang ?? null,
      menitKerja,
      detikTelat,
      menitLemburDisetujui: approved,
      flags,
    });
  }
  daily.sort(
    (a, b) =>
      a.tanggal.localeCompare(b.tanggal) ||
      a.nama.localeCompare(b.nama) ||
      a.employeeId.localeCompare(b.employeeId),
  );
  const summary = new Map<string, RingkasanRekap>();
  for (const r of daily) {
    const x = summary.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      nama: r.nama,
      hariKerja: 0,
      hadir: 0,
      bolos: 0,
      cuti: 0,
      izin: 0,
      sakit: 0,
      hariTelat: 0,
      detikTelat: 0,
      menitKerja: 0,
      hariJamTidakDiketahui: 0,
      menitLemburDisetujui: 0,
      hariBermasalah: 0,
    };
    if (r.terjadwal && !r.isLibur) x.hariKerja++;
    if (r.status === "Hadir") {
      x.hadir++;
      if (r.menitKerja === null) x.hariJamTidakDiketahui++;
    }
    if (r.status === "Alpha") x.bolos++;
    if (r.status === "Cuti") x.cuti++;
    if (r.status === "Izin") x.izin++;
    if (r.status === "Sakit") x.sakit++;
    if (r.detikTelat > 0) x.hariTelat++;
    x.detikTelat += r.detikTelat;
    x.menitKerja += r.menitKerja ?? 0;
    x.menitLemburDisetujui += r.menitLemburDisetujui;
    if (r.flags.length) x.hariBermasalah++;
    summary.set(r.employeeId, x);
  }
  return {
    daily,
    summaries: [...summary.values()].sort((a, b) =>
      a.nama.localeCompare(b.nama),
    ),
  };
}
export async function buatExcelRekap(
  r: ReturnType<typeof rekapJadwal>,
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const b = new ExcelJS.Workbook();
  const daily = b.addWorksheet("Harian");
  daily.addRow([
    "ID karyawan",
    "Nama",
    "Tanggal masuk",
    "Cabang ID",
    "Shift",
    "Status",
    "Masuk",
    "Pulang",
    "Menit kerja diketahui",
    "Detik telat (fakta)",
    "Menit lembur disetujui",
    "Perlu koreksi",
  ]);
  for (const d of r.daily)
    daily.addRow([
      d.employeeId,
      d.nama,
      d.tanggal,
      d.branchId,
      d.shift,
      d.status,
      d.masuk,
      d.pulang,
      d.menitKerja,
      d.detikTelat,
      d.menitLemburDisetujui,
      d.flags.join("; "),
    ]);
  const summary = b.addWorksheet("Ringkasan");
  summary.addRow([
    "ID karyawan",
    "Nama",
    "Hari terjadwal",
    "Hadir",
    "Alpha",
    "Cuti",
    "Izin",
    "Sakit",
    "Hari telat",
    "Detik telat",
    "Menit kerja diketahui",
    "Hari jam belum diketahui",
    "Menit lembur disetujui",
    "Hari perlu koreksi",
  ]);
  for (const d of r.summaries)
    summary.addRow([
      d.employeeId,
      d.nama,
      d.hariKerja,
      d.hadir,
      d.bolos,
      d.cuti,
      d.izin,
      d.sakit,
      d.hariTelat,
      d.detikTelat,
      d.menitKerja,
      d.hariJamTidakDiketahui,
      d.menitLemburDisetujui,
      d.hariBermasalah,
    ]);
  for (const sheet of [daily, summary]) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    sheet.autoFilter = {
      from: "A1",
      to: sheet.getRow(1).cellCount === 12 ? "L1" : "N1",
    };
  }
  return new Uint8Array(await b.xlsx.writeBuffer());
}
