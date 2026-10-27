// Pengumpul data penggajian: menarik jadwal, absensi, cuti, lembur, komponen,
// kasbon, dan reimburse untuk satu periode lalu menyusunnya jadi input hitungan.
// Dipisah dari server action supaya layar "Hitung" dan "Sahkan" memakai sumber
// angka yang sama persis.

import { bacaGajiPokok } from "./employee-salary";
import { hitungGaji, type HariJadwal, type InputGaji, type RincianGaji } from "./payroll";
import { getAturanGaji } from "./payroll-aturan";
import { komisiPeriode } from "./komisi-data";
import { rentangTanggal } from "./tanggal";
import { assertServiceAttributionReady } from "./commission-readiness";
import { readCompleteList } from "./checked-list";
import { hitungKomponenOmzet, type TurnoverComponent } from "./payroll-turnover";
import { komponenEfektif, type BarisKaryawan, type BarisTemplate, type KomponenMaster } from "./payslip-template";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisGaji = {
  employeeId: string;
  nama: string;
  jabatan: string | null;
  rincian: RincianGaji;
  componentBreakdown: { name: string; type: "tunjangan" | "potongan"; basis: number | null; ratePercent: number | null; amount: number; source: string | null; scope: string | null;
    /** H02: template = from the employee's payslip template; pengecualian = explicit override; individu = extra. */
    origin?: "template" | "pengecualian" | "individu" }[];
  /** Cicilan periode ini per kasbon — satu karyawan bisa punya lebih dari satu utang. */
  cicilanKasbon: { id?: string; jumlah: number }[];
  reimburseIds: string[];
};

export const akhirBulan = (periode: string): string => {
  const [thn, bln] = periode.split("-").map(Number);
  return `${periode}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;
};

/** Payroll must never turn a failed or truncated source read into a zero amount. */
async function readEmployeeRows(ids: string[], label: string, query: (batch: string[]) => AnyClient) {
  const rows: { id: string }[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const ordered = query(ids.slice(start, start + 100)).order("id");
    rows.push(...await readCompleteList<{ id: string }>((from, to) => ordered.range(from, to), label, { maxRows: null }));
  }
  return rows;
}

export async function kumpulkanDataGaji(
  supabase: AnyClient,
  periode: string,
  penyesuaianPer: Map<string, number> = new Map(),
): Promise<BarisGaji[]> {
  const awal = `${periode}-01`;
  const akhir = akhirBulan(periode);

  const [aturan, karyawanDir, komisi] = await Promise.all([
    getAturanGaji(supabase),
    readCompleteList<{ id: string; nama: string; jabatan: string | null; branch_id: string | null }>((from, to) => supabase
      .from("employees").select("id, nama, jabatan, branch_id", { count: "exact" })
      .eq("status", "Aktif").order("id").range(from, to), "Karyawan penggajian", { maxRows: null }),
    komisiPeriode(supabase, periode),
  ]);
  assertServiceAttributionReady(komisi.baris ?? []);
  const komisiPer = new Map(komisi.hasil.map((h) => [h.employeeId, h.komisi]));
  if (karyawanDir.length === 0) return [];
  const gajiPer = await bacaGajiPokok(supabase, karyawanDir.map((k) => k.id));
  const karyawan = karyawanDir.map((k) => ({ ...k, gaji_pokok: gajiPer.get(k.id) ?? 0 }));
  karyawan.sort((a, b) => a.nama.localeCompare(b.nama, "id-ID") || a.id.localeCompare(b.id));

  const ids = karyawan.map((k) => k.id);

  const KOMPONEN = "nama, tipe, nominal, is_active, calculation_basis, sales_source, sales_scope, rate_percent";
  const [
    jadwalData, absenData, cutiData,
    lemburData, kompData, kasbonData, reimData, templateLinkData,
  ] = await Promise.all([
    readEmployeeRows(ids, "Jadwal penggajian", batch => supabase.from("employee_schedules")
      .select("id, employee_id, tanggal, work_shifts(is_libur, jam_masuk)", { count: "exact" })
      .in("employee_id", batch).gte("tanggal", awal).lte("tanggal", akhir)),
    readEmployeeRows(ids, "Absensi penggajian", batch => supabase.from("attendance")
      .select("id, employee_id, tanggal, jam_masuk", { count: "exact" })
      .in("employee_id", batch).gte("tanggal", awal).lte("tanggal", akhir)),
    readEmployeeRows(ids, "Cuti penggajian", batch => supabase.from("leave_requests")
      .select("id, employee_id, tanggal_mulai, tanggal_selesai, status", { count: "exact" })
      .in("employee_id", batch).eq("status", "Disetujui")),
    readEmployeeRows(ids, "Lembur penggajian", batch => supabase.from("overtime_requests")
      .select("id, employee_id, jam", { count: "exact" })
      .in("employee_id", batch).eq("status", "Disetujui").gte("tanggal", awal).lte("tanggal", akhir)),
    readEmployeeRows(ids, "Komponen penggajian", batch => supabase.from("employee_salary_components")
      .select(`id, employee_id, component_id, nominal, rate_percent_override, salary_components(${KOMPONEN})`, { count: "exact" })
      .in("employee_id", batch)),
    readEmployeeRows(ids, "Kasbon penggajian", batch => supabase.from("cash_advances")
      .select("id, employee_id, jumlah, tenor_bulan, cash_advance_installments(jumlah)", { count: "exact" })
      .in("employee_id", batch).eq("status", "Disetujui")),
    // Reimburse yang sudah disetujui tapi belum pernah ikut dibayar di periode mana pun.
    readEmployeeRows(ids, "Reimburse penggajian", batch => supabase.from("reimbursements")
      .select("id, employee_id, jumlah", { count: "exact" })
      .in("employee_id", batch).eq("status", "Disetujui").is("paid_periode", null)),
    // H02: one payslip template per employee (optional).
    readEmployeeRows(ids, "Template slip penggajian", batch => supabase.from("employee_payslip_templates")
      .select("id, employee_id, template_id", { count: "exact" })
      .in("employee_id", batch)),
  ]);

  type ShiftRel = { is_libur: boolean; jam_masuk: string | null } | { is_libur: boolean; jam_masuk: string | null }[] | null;
  const satu = <T,>(r: T | T[] | null): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

  const jadwalPer = new Map<string, HariJadwal[]>();
  for (const j of jadwalData as unknown as { employee_id: string; tanggal: string; work_shifts: ShiftRel }[]) {
    const s = satu(j.work_shifts);
    if (!s) throw new Error("Shift jadwal penggajian belum dapat diverifikasi. Coba muat ulang.");
    const arr = jadwalPer.get(j.employee_id) ?? [];
    arr.push({ tanggal: j.tanggal, isLibur: !!s?.is_libur, jamMasuk: s?.jam_masuk ?? null });
    jadwalPer.set(j.employee_id, arr);
  }

  const absenPer = new Map<string, { tanggal: string; jamMasuk: string | null }[]>();
  for (const a of absenData as unknown as { employee_id: string; tanggal: string; jam_masuk: string | null }[]) {
    const arr = absenPer.get(a.employee_id) ?? [];
    arr.push({ tanggal: a.tanggal, jamMasuk: a.jam_masuk });
    absenPer.set(a.employee_id, arr);
  }

  const cutiPer = new Map<string, string[]>();
  for (const c of cutiData as unknown as { employee_id: string; tanggal_mulai: string; tanggal_selesai: string | null }[]) {
    const arr = cutiPer.get(c.employee_id) ?? [];
    arr.push(...rentangTanggal(c.tanggal_mulai, c.tanggal_selesai ?? c.tanggal_mulai));
    cutiPer.set(c.employee_id, arr);
  }

  const lemburPer = new Map<string, number>();
  for (const l of lemburData as unknown as { employee_id: string; jam: number }[]) {
    lemburPer.set(l.employee_id, (lemburPer.get(l.employee_id) ?? 0) + Number(l.jam));
  }

  // H02: template rows for the templates linked to these employees.
  const templatePer = new Map((templateLinkData as unknown as { employee_id: string; template_id: string }[])
    .map((row) => [row.employee_id, row.template_id]));
  const templateIds = [...new Set(templatePer.values())];
  const templateRows: { template_id: string; component_id: string; nominal: number | null; rate_percent: number | null; salary_components: KomponenMaster | KomponenMaster[] | null }[] = [];
  for (let start = 0; start < templateIds.length; start += 100) {
    const batch = templateIds.slice(start, start + 100);
    templateRows.push(...await readCompleteList<typeof templateRows[number] & { id: string }>((from, to) => supabase
      .from("payslip_template_components")
      .select(`id, template_id, component_id, nominal, rate_percent, salary_components(${KOMPONEN})`, { count: "exact" })
      .in("template_id", batch).order("id").range(from, to), "Komponen template slip", { maxRows: null }));
  }
  const masterOf = (rel: KomponenMaster | KomponenMaster[] | null): KomponenMaster => {
    const c = satu(rel);
    if (!c) throw new Error("Komponen penggajian belum dapat diverifikasi. Coba muat ulang.");
    return c;
  };
  const templateKomp = new Map<string, BarisTemplate[]>();
  for (const row of templateRows) {
    const arr = templateKomp.get(row.template_id) ?? [];
    arr.push({ component_id: row.component_id, nominal: row.nominal, rate_percent: row.rate_percent, master: masterOf(row.salary_components) });
    templateKomp.set(row.template_id, arr);
  }
  const karyawanKomp = new Map<string, BarisKaryawan[]>();
  for (const k of kompData as unknown as { employee_id: string; component_id: string; nominal: number | null; rate_percent_override: number | null; salary_components: KomponenMaster | KomponenMaster[] | null }[]) {
    const arr = karyawanKomp.get(k.employee_id) ?? [];
    arr.push({ component_id: k.component_id, nominal: k.nominal, rate_percent_override: k.rate_percent_override, master: masterOf(k.salary_components) });
    karyawanKomp.set(k.employee_id, arr);
  }

  const kompPer = new Map<string, { tipe: "tunjangan" | "potongan"; nominal: number }[]>();
  const breakdownPer = new Map<string, BarisGaji["componentBreakdown"]>();
  const branchPer = new Map(karyawan.map(k => [k.id, k.branch_id]));
  for (const { id: employeeId } of karyawan) {
    const templateId = templatePer.get(employeeId);
    const efektif = komponenEfektif(templateId ? templateKomp.get(templateId) ?? [] : [], karyawanKomp.get(employeeId) ?? []);
    for (const e of efektif) {
      const c = e.master;
      // Monetary values apply only to fixed components; turnover components use their rate.
      const turnover = c.calculation_basis === "net_turnover"
        // Employee scope credits performers like commission does (split share / both full),
        // so it reads the per-actor calculation rows; branch/all scopes count each source line once.
        ? hitungKomponenOmzet(c.sales_scope === "employee" ? komisi.barisHitung ?? komisi.baris : komisi.baris, {
          source: c.sales_source as TurnoverComponent["source"], scope: c.sales_scope as TurnoverComponent["scope"],
          ratePercent: e.ratePercent,
        }, employeeId, branchPer.get(employeeId) ?? null)
        : null;
      const nominal = turnover?.amount ?? e.nominal;
      const arr = kompPer.get(employeeId) ?? [];
      arr.push({ tipe: c.tipe as "tunjangan" | "potongan", nominal });
      kompPer.set(employeeId, arr);
      const breakdown = breakdownPer.get(employeeId) ?? [];
      breakdown.push({ name: c.nama, type: c.tipe as "tunjangan" | "potongan",
        basis: turnover?.basis ?? null, ratePercent: turnover ? e.ratePercent : null,
        amount: nominal, source: turnover ? c.sales_source : null, scope: turnover ? c.sales_scope : null, origin: e.asal });
      breakdownPer.set(employeeId, breakdown);
    }
  }

  // SEMUA kasbon berjalan per karyawan, bukan satu. Dulu memakai `set` di dalam
  // loop sehingga hanya kasbon terakhir yang terbaca — utang lainnya diam-diam
  // tidak pernah dipotong dari gaji.
  const kasbonPer = new Map<string, { id: string; jumlah: number; tenor: number; sudahDibayar: number }[]>();
  for (const k of (kasbonData ?? []) as {
    id: string; employee_id: string; jumlah: number; tenor_bulan: number;
    cash_advance_installments: { jumlah: number }[] | null;
  }[]) {
    const arr = kasbonPer.get(k.employee_id) ?? [];
    arr.push({
      id: k.id,
      jumlah: Number(k.jumlah),
      tenor: k.tenor_bulan,
      sudahDibayar: (k.cash_advance_installments ?? []).reduce((a, i) => a + Number(i.jumlah), 0),
    });
    kasbonPer.set(k.employee_id, arr);
  }

  const reimPer = new Map<string, { ids: string[]; total: number }>();
  for (const r of (reimData ?? []) as { id: string; employee_id: string; jumlah: number }[]) {
    const cur = reimPer.get(r.employee_id) ?? { ids: [], total: 0 };
    cur.ids.push(r.id);
    cur.total += Number(r.jumlah);
    reimPer.set(r.employee_id, cur);
  }

  return karyawan.map((k) => {
    const kasbon = kasbonPer.get(k.id) ?? [];
    const reim = reimPer.get(k.id) ?? { ids: [], total: 0 };
    const input: InputGaji = {
      gajiPokok: Number(k.gaji_pokok),
      jadwal: jadwalPer.get(k.id) ?? [],
      absen: absenPer.get(k.id) ?? [],
      tanggalCuti: cutiPer.get(k.id) ?? [],
      jamLembur: lemburPer.get(k.id) ?? 0,
      komponen: kompPer.get(k.id) ?? [],
      reimburse: reim.total,
      komisi: komisiPer.get(k.id) ?? 0,
      kasbon,
      penyesuaian: penyesuaianPer.get(k.id) ?? 0,
      aturan,
    };
    const rincian = hitungGaji(input);
    return {
      employeeId: k.id,
      nama: k.nama,
      jabatan: k.jabatan,
      rincian,
      componentBreakdown: breakdownPer.get(k.id) ?? [],
      cicilanKasbon: rincian.cicilanPerKasbon,
      reimburseIds: reim.ids,
    };
  });
}
