// Pengumpul data penggajian: menarik jadwal, absensi, cuti, lembur, komponen,
// kasbon, dan reimburse untuk satu periode lalu menyusunnya jadi input hitungan.
// Dipisah dari server action supaya layar "Hitung" dan "Sahkan" memakai sumber
// angka yang sama persis.

import {
  hitungGaji,
  type HariJadwal,
  type InputGaji,
  type RincianGaji,
} from "./payroll";
import { ATURAN_KOSONG, type AturanGaji } from "./payroll-aturan";
import { komisiPeriode } from "./komisi-data";
import {
  resolvePayrollPolicy,
  componentsForPeriod,
  type PolicyVersion,
  type PayMembership,
  type MasterVersion,
  type FixedVersion,
  type VariableComponent,
} from "./payroll-effective";
import { sourceRows } from "./source-rows";
import { rentangTanggal } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisGaji = {
  draftVersion: number;
  sourceRevision: number;
  sourceSnapshot: Record<string, unknown>;
  employeeId: string;
  nama: string;
  jabatan: string | null;
  rincian: RincianGaji;
  /** Cicilan periode ini per kasbon — satu karyawan bisa punya lebih dari satu utang. */
  cicilanKasbon: { id?: string; jumlah: number }[];
  reimburseIds: string[];
};

export const akhirBulan = (periode: string): string => {
  const [thn, bln] = periode.split("-").map(Number);
  return `${periode}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;
};

export async function kumpulkanDataGaji(
  supabase: AnyClient,
  periode: string,
  penyesuaianPer: Map<string, number> = new Map(),
): Promise<BarisGaji[]> {
  // Existing callers process the entire company, including settlement. Refuse
  // incomplete branch visibility before interpreting hidden sources as no work.
  const scope = await supabase.rpc("hris_assert_payroll_scope");
  if (scope.error || scope.data !== true) {
    throw new Error(
      scope.error?.message?.startsWith("HRIS:")
        ? scope.error.message.replace(/^HRIS:\s*/, "")
        : "Data gaji gagal diverifikasi. Periksa akses cabang dan migrasi HRIS.",
    );
  }
  const awal = `${periode}-01`;
  const akhir = akhirBulan(periode);

  const before = await supabase.rpc("hris_payroll_source_state", {
    p_period: periode,
  });
  if (before.error || !Number.isSafeInteger(before.data?.revision))
    throw new Error("Data gaji: versi sumber tidak tersedia");
  const revision = before.data.revision as number;
  const [settingRows, empData, komisi] = await Promise.all([
    sourceRows<AturanGaji & { id: boolean }>(
      supabase,
      "payroll_settings",
      "id,telat_mulai_menit,telat_blok_menit,telat_nominal_per_blok,telat_maks,bolos_per_hari,lembur_per_jam",
      (q) => q.eq("id", true),
    ),
    sourceRows<{
      id: string;
      nama: string;
      jabatan: string | null;
      gaji_pokok: number;
    }>(supabase, "employees", "id,nama,jabatan,gaji_pokok", (q) =>
      q.eq("status", "Aktif"),
    ),
    komisiPeriode(supabase, periode),
  ]);
  if (settingRows.length !== 1)
    throw new Error("Data gaji: pengaturan tidak lengkap");
  const aturan: AturanGaji = Object.fromEntries(
    Object.keys(ATURAN_KOSONG).map((k) => [
      k,
      Number(settingRows[0][k as keyof AturanGaji]),
    ]),
  ) as AturanGaji;
  if (
    Object.values(aturan).some((v) => !Number.isFinite(v) || v < 0) ||
    aturan.telat_blok_menit <= 0
  )
    throw new Error("Data gaji: pengaturan tidak valid");
  const komisiPer = new Map(komisi.hasil.map((h) => [h.employeeId, h.komisi]));
  const karyawan = empData;
  const [
    policies,
    memberships,
    masterVersions,
    fixedVersions,
    periodComponents,
    jadwalData,
    absenData,
    cutiData,
    lemburData,
    kasbonData,
    installmentData,
    reimData,
  ] = await Promise.all([
    sourceRows<PolicyVersion>(
      supabase,
      "payroll_policy_versions",
      "id,sequence,group_id,effective_date,values:settings",
    ),
    sourceRows<PayMembership>(
      supabase,
      "employee_pay_group_memberships",
      "id,employee_id,group_id,valid_from,valid_to",
    ),
    sourceRows<MasterVersion>(
      supabase,
      "salary_component_versions",
      "id,sequence,component_id,effective_period,nama,tipe,nominal,is_active",
    ),
    sourceRows<FixedVersion>(
      supabase,
      "employee_salary_component_versions",
      "id,sequence,employee_id,component_id,effective_period,nominal,is_active",
    ),
    sourceRows<VariableComponent>(
      supabase,
      "payroll_period_components",
      "id,employee_id,periode,nama,tipe,nominal,is_active",
      (q) => q.eq("periode", periode),
    ),
    sourceRows<Record<string, unknown>>(
      supabase,
      "employee_schedules",
      "id,employee_id,tanggal,work_shifts(is_libur,jam_masuk)",
      (q) => q.gte("tanggal", awal).lte("tanggal", akhir),
    ),
    sourceRows<Record<string, unknown>>(
      supabase,
      "attendance",
      "id,employee_id,tanggal,jam_masuk,checked_in_at,checked_out_at,branch_id",
      (q) => q.eq("is_void", false).gte("tanggal", awal).lte("tanggal", akhir),
    ),
    sourceRows<Record<string, unknown>>(
      supabase,
      "leave_requests",
      "id,employee_id,jenis,tanggal_mulai,tanggal_selesai,status",
      (q) =>
        q
          .eq("status", "Disetujui")
          .in("jenis", ["Cuti", "Izin", "Sakit"])
          .lte("tanggal_mulai", akhir),
    ),
    sourceRows<Record<string, unknown>>(
      supabase,
      "overtime_requests",
      "id,employee_id,tanggal,jam",
      (q) =>
        q.eq("status", "Disetujui").gte("tanggal", awal).lte("tanggal", akhir),
    ),
    sourceRows<Record<string, unknown>>(
      supabase,
      "cash_advances",
      "id,employee_id,jumlah,tenor_bulan,disbursed_at",
      (q) => q.eq("status", "Disetujui"),
    ),
    sourceRows<{
      id: string;
      advance_id: string;
      jumlah: number;
      periode: string;
    }>(supabase, "cash_advance_installments", "id,advance_id,jumlah,periode"),
    sourceRows<Record<string, unknown>>(
      supabase,
      "reimbursements",
      "id,employee_id,tanggal,kategori,jumlah",
      (q) => q.eq("status", "Disetujui").is("paid_periode", null),
    ),
  ]);
  for (const k of kasbonData) {
    if (!k.disbursed_at)
      throw new Error(
        "Data gaji: kasbon disetujui belum memiliki bukti pencairan",
      );
    k.cash_advance_installments = installmentData.filter(
      (i) => i.advance_id === k.id,
    );
  }

  type ShiftRel =
    | { is_libur: boolean; jam_masuk: string | null }
    | { is_libur: boolean; jam_masuk: string | null }[]
    | null;
  const satu = <T>(r: T | T[] | null): T | null =>
    Array.isArray(r) ? (r[0] ?? null) : r;

  const jadwalPer = new Map<string, HariJadwal[]>();
  for (const j of (jadwalData ?? []) as {
    employee_id: string;
    tanggal: string;
    work_shifts: ShiftRel;
  }[]) {
    const s = satu(j.work_shifts);
    if (!s || (!s.is_libur && !s.jam_masuk))
      throw new Error("Data gaji: definisi shift jadwal tidak tersedia");
    const arr = jadwalPer.get(j.employee_id) ?? [];
    arr.push({
      tanggal: j.tanggal,
      isLibur: !!s?.is_libur,
      jamMasuk: s?.jam_masuk ?? null,
    });
    jadwalPer.set(j.employee_id, arr);
  }

  const absenPer = new Map<
    string,
    { tanggal: string; jamMasuk: string | null; checkedInAt?: string | null }[]
  >();
  for (const a of (absenData ?? []) as {
    employee_id: string;
    tanggal: string;
    jam_masuk: string | null;
    checked_in_at?: string | null;
  }[]) {
    const arr = absenPer.get(a.employee_id) ?? [];
    arr.push({
      tanggal: a.tanggal,
      jamMasuk: a.jam_masuk,
      checkedInAt: a.checked_in_at,
    });
    absenPer.set(a.employee_id, arr);
  }

  const cutiPer = new Map<string, string[]>();
  for (const c of (cutiData ?? []) as {
    employee_id: string;
    tanggal_mulai: string;
    tanggal_selesai: string | null;
  }[]) {
    const arr = cutiPer.get(c.employee_id) ?? [];
    arr.push(
      ...rentangTanggal(c.tanggal_mulai, c.tanggal_selesai ?? c.tanggal_mulai),
    );
    cutiPer.set(c.employee_id, arr);
  }

  const lemburPer = new Map<string, number>();
  for (const l of (lemburData ?? []) as {
    employee_id: string;
    jam: number;
  }[]) {
    lemburPer.set(
      l.employee_id,
      (lemburPer.get(l.employee_id) ?? 0) + Number(l.jam),
    );
  }

  // SEMUA kasbon berjalan per karyawan, bukan satu. Dulu memakai `set` di dalam
  // loop sehingga hanya kasbon terakhir yang terbaca — utang lainnya diam-diam
  // tidak pernah dipotong dari gaji.
  const kasbonPer = new Map<
    string,
    { id: string; jumlah: number; tenor: number; sudahDibayar: number }[]
  >();
  for (const k of (kasbonData ?? []) as {
    id: string;
    employee_id: string;
    jumlah: number;
    tenor_bulan: number;
    cash_advance_installments: { jumlah: number }[] | null;
  }[]) {
    const arr = kasbonPer.get(k.employee_id) ?? [];
    arr.push({
      id: k.id,
      jumlah: Number(k.jumlah),
      tenor: k.tenor_bulan,
      sudahDibayar: (k.cash_advance_installments ?? []).reduce(
        (a, i) => a + Number(i.jumlah),
        0,
      ),
    });
    kasbonPer.set(k.employee_id, arr);
  }

  const reimPer = new Map<string, { ids: string[]; total: number }>();
  for (const r of (reimData ?? []) as {
    id: string;
    employee_id: string;
    jumlah: number;
  }[]) {
    const cur = reimPer.get(r.employee_id) ?? { ids: [], total: 0 };
    cur.ids.push(r.id);
    cur.total += Number(r.jumlah);
    reimPer.set(r.employee_id, cur);
  }

  const result = karyawan.map((k) => {
    const kasbon = kasbonPer.get(k.id) ?? [];
    const reim = reimPer.get(k.id) ?? { ids: [], total: 0 };
    const input: InputGaji = {
      gajiPokok: Number(k.gaji_pokok),
      jadwal: jadwalPer.get(k.id) ?? [],
      absen: absenPer.get(k.id) ?? [],
      tanggalCuti: cutiPer.get(k.id) ?? [],
      jamLembur: lemburPer.get(k.id) ?? 0,
      komponen: componentsForPeriod(
        k.id,
        periode,
        masterVersions,
        fixedVersions,
        periodComponents,
      ),
      reimburse: reim.total,
      komisi: komisiPer.get(k.id) ?? 0,
      kasbon,
      penyesuaian: penyesuaianPer.get(k.id) ?? 0,
      aturan,
      aturanPerTanggal: Object.fromEntries(
        rentangTanggal(awal, akhir).map((date) => [
          date,
          resolvePayrollPolicy(k.id, date, aturan, policies, memberships),
        ]),
      ),
      lemburPerTanggal: lemburData
        .filter((r) => r.employee_id === k.id)
        .map((r) => ({ tanggal: String(r.tanggal), jam: Number(r.jam) })),
    };
    const rincian = hitungGaji(input);
    return {
      draftVersion: before.data.version,
      sourceRevision: revision,
      sourceSnapshot: {
        input,
        employee: k,
        period: periode,
        schedules: jadwalData.filter((r) => r.employee_id === k.id),
        attendance: absenData.filter((r) => r.employee_id === k.id),
        leave: cutiData.filter((r) => r.employee_id === k.id),
        overtime: lemburData.filter((r) => r.employee_id === k.id),
        components: input.komponen,
        memberships: memberships.filter((r) => r.employee_id === k.id),
        advances: kasbonData.filter((r) => r.employee_id === k.id),
        reimbursements: reimData.filter((r) => r.employee_id === k.id),
        commission: {
          rows: komisi.baris.filter((r) => r.employeeId === k.id),
          result: komisi.hasil.find((r) => r.employeeId === k.id) ?? null,
        },
        rincian,
      },
      employeeId: k.id,
      nama: k.nama,
      jabatan: k.jabatan,
      rincian,
      cicilanKasbon: rincian.cicilanPerKasbon,
      reimburseIds: reim.ids,
    };
  });
  const after = await supabase.rpc("hris_payroll_source_state", {
    p_period: periode,
  });
  if (
    after.error ||
    after.data?.revision !== revision ||
    after.data?.version !== before.data.version
  )
    throw new Error(
      "Data gaji berubah selama perhitungan. Muat ulang dan hitung lagi",
    );
  return result;
}
