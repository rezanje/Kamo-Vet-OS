import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { sourceRows } from "@/lib/source-rows";
import { hariIniWIB } from "@/lib/tanggal";
import { ATURAN_KOSONG } from "@/lib/payroll-aturan";
import {
  resolvePayrollPolicy,
  componentsForPeriod,
  type PolicyVersion,
  type PayMembership,
  type MasterVersion,
  type FixedVersion,
  type VariableComponent,
} from "@/lib/payroll-effective";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buatKelompok,
  simpanAturanKelompok,
  tambahAnggota,
  akhiriAnggota,
  simpanKomponenPeriode,
  hapusKomponenPeriode,
} from "./actions";
const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID")}`;
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    periode?: string;
    employee?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const db = await assertRole("/hris", "aturan gaji", [
      "OWNER",
      "ADMIN",
      "FINANCE",
    ]),
    sp = await searchParams;
  const {
      data: { user },
    } = await db.auth.getUser(),
    { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", user?.id ?? "")
      .maybeSingle();
  const owner = profile?.role === "OWNER",
    hr = owner || profile?.role === "ADMIN",
    today = hariIniWIB(),
    period = /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(sp.periode ?? "")
      ? sp.periode!
      : today.slice(0, 7);
  let loaded;
  try {
    loaded = await Promise.all([
      sourceRows<{ id: string; nama: string }>(
        db,
        "employees",
        "id,nama",
        (q) => q.eq("status", "Aktif"),
      ),
      sourceRows<{ id: string; nama: string }>(
        db,
        "payroll_policy_groups",
        "id,nama",
      ),
      sourceRows<PolicyVersion>(
        db,
        "payroll_policy_versions",
        "id,sequence,group_id,effective_date,values:settings",
      ),
      sourceRows<PayMembership>(
        db,
        "employee_pay_group_memberships",
        "id,employee_id,group_id,valid_from,valid_to",
      ),
      sourceRows<MasterVersion>(
        db,
        "salary_component_versions",
        "id,sequence,component_id,effective_period,nama,tipe,nominal,is_active",
      ),
      sourceRows<FixedVersion>(
        db,
        "employee_salary_component_versions",
        "id,sequence,employee_id,component_id,effective_period,nominal,is_active",
      ),
      sourceRows<VariableComponent>(
        db,
        "payroll_period_components",
        "id,employee_id,periode,nama,tipe,nominal,is_active",
        (q) => q.eq("periode", period),
      ),
      sourceRows<Record<string, unknown>>(
        db,
        "payroll_settings",
        "id,telat_mulai_menit,telat_blok_menit,telat_nominal_per_blok,telat_maks,bolos_per_hari,lembur_per_jam",
      ),
    ]);
  } catch {
    return (
      <div className="crm-sec" role="alert">
        Aturan bertanggal gagal dimuat lengkap. Periksa migrasi dan akses
        sebelum mengubah aturan.
      </div>
    );
  }
  const [
    employees,
    groups,
    policies,
    members,
    masters,
    fixed,
    variables,
    legacy,
  ] = loaded;
  const employee = employees.some((e) => e.id === sp.employee)
    ? sp.employee!
    : (employees[0]?.id ?? "");
  const baseline = Object.fromEntries(
    Object.keys(ATURAN_KOSONG).map((k) => [
      k,
      Number(legacy[0]?.[k] ?? ATURAN_KOSONG[k as keyof typeof ATURAN_KOSONG]),
    ]),
  ) as typeof ATURAN_KOSONG;
  const currentGlobal = resolvePayrollPolicy("", today, baseline, policies, []);
  const effective = resolvePayrollPolicy(
      employee,
      period + "-01",
      baseline,
      policies,
      members,
    ),
    components = componentsForPeriod(
      employee,
      period,
      masters,
      fixed,
      variables,
    );
  const employeeName = (id: string) =>
      employees.find((e) => e.id === id)?.nama ?? "Karyawan nonaktif",
    groupName = (id: string | null) =>
      id
        ? (groups.find((g) => g.id === id)?.nama ?? "Kelompok")
        : "Seluruh perusahaan";
  const chooseEmployee = (
    <select className="fi" name="employee_id" required defaultValue={employee}>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nama}
        </option>
      ))}
    </select>
  );
  const reason = (
    <label>
      Alasan *
      <input
        className="fi"
        name="reason"
        minLength={3}
        maxLength={1000}
        required
      />
    </label>
  );
  return (
    <div className="crm-sec">
      <Link href="/hris">Kembali ke HRIS</Link>
      <h2>Aturan bertanggal dan komponen periode</h2>
      <p>
        Perubahan berlaku mulai tanggal atau bulan yang dipilih. Gaji final
        memakai potret sumber yang sudah disahkan. Nilai sebelum riwayat
        bertanggal tersedia mengikuti baseline lama; perubahan historis lama
        tidak direkonstruksi.
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.success && <p>Perubahan dan alasan tersimpan.</p>}
      <form method="get">
        <label>
          Periode{" "}
          <input
            className="fi"
            type="month"
            name="periode"
            defaultValue={period}
            required
          />
        </label>
        <label>
          Karyawan{" "}
          <select className="fi" name="employee" defaultValue={employee}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nama}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-def">Lihat</button>
      </form>
      <h3>
        {employeeName(employee)} · {period}
      </h3>
      <p>
        Aturan pada tanggal 1: lembur {rp(effective.lembur_per_jam)}/jam, bolos{" "}
        {rp(effective.bolos_per_hari)}/hari. Perubahan di tengah bulan mengikuti
        tanggal kegiatan.
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>Komponen efektif</th>
            <th>Jenis</th>
            <th>Nominal</th>
            <th>Berlaku</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.source + c.id}>
              <td>{c.nama}</td>
              <td>{c.tipe}</td>
              <td>{rp(c.nominal)}</td>
              <td>{c.source === "period" ? "Periode ini" : "Tetap bulanan"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hr && (
        <>
          <h3>Komponen sekali pakai</h3>
          <form action={simpanKomponenPeriode}>
            {chooseEmployee}
            <label>
              Periode *
              <input
                className="fi"
                type="month"
                name="periode"
                defaultValue={period}
                required
              />
            </label>
            <label>
              Nama *<input className="fi" name="nama" maxLength={60} required />
            </label>
            <select className="fi" name="tipe">
              <option value="tunjangan">Tambahan</option>
              <option value="potongan">Potongan</option>
            </select>
            <label>
              Nominal *
              <input
                className="fi"
                name="nominal"
                type="number"
                min={0}
                step="any"
                required
              />
            </label>
            {reason}
            <SubmitButton className="btn-acc" pendingText="Menyimpan…">
              Simpan komponen periode
            </SubmitButton>
          </form>
          {variables
            .filter((v) => v.is_active)
            .map((v) => (
              <form action={hapusKomponenPeriode} key={v.id}>
                <p>
                  {employeeName(v.employee_id)} · {v.nama} · {v.tipe} ·{" "}
                  {rp(v.nominal)}
                </p>
                <input type="hidden" name="id" value={v.id} />
                {reason}
                <SubmitButton className="btn-def" pendingText="Menyimpan…">
                  Batalkan komponen periode
                </SubmitButton>
              </form>
            ))}
        </>
      )}
      <h3>Keanggotaan kelompok</h3>
      {hr && groups.length > 0 && (
        <form action={tambahAnggota}>
          {chooseEmployee}
          <select className="fi" name="group_id" required>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nama}
              </option>
            ))}
          </select>
          <label>
            Mulai *
            <input
              className="fi"
              type="date"
              name="valid_from"
              defaultValue={today}
              required
            />
          </label>
          <label>
            Sampai (opsional)
            <input className="fi" type="date" name="valid_to" />
          </label>
          {reason}
          <SubmitButton className="btn-acc" pendingText="Menyimpan…">
            Tambahkan keanggotaan
          </SubmitButton>
        </form>
      )}
      {members.map((m) => (
        <div key={m.id}>
          <p>
            {employeeName(m.employee_id)} · {groupName(m.group_id)} ·{" "}
            {m.valid_from} sampai {m.valid_to ?? "seterusnya"}
          </p>
          {hr && (
            <form action={akhiriAnggota}>
              <input type="hidden" name="id" value={m.id} />
              <label>
                Akhir keanggotaan *
                <input
                  className="fi"
                  type="date"
                  name="valid_to"
                  defaultValue={m.valid_to ?? today}
                  required
                />
              </label>
              {reason}
              <SubmitButton className="btn-def" pendingText="Menyimpan…">
                Simpan tanggal akhir
              </SubmitButton>
            </form>
          )}
        </div>
      ))}
      {owner && (
        <>
          <h3>Kelompok baru</h3>
          <form action={buatKelompok}>
            <label>
              Nama *
              <input
                className="fi"
                name="nama"
                minLength={3}
                maxLength={60}
                required
              />
            </label>
            {reason}
            <SubmitButton className="btn-acc" pendingText="Menyimpan…">
              Buat kelompok
            </SubmitButton>
          </form>
          <h3>Aturan perusahaan atau kelompok</h3>
          <form action={simpanAturanKelompok}>
            <select className="fi" name="group_id" defaultValue="">
              <option value="">Seluruh perusahaan</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nama}
                </option>
              ))}
            </select>
            <label>
              Mulai *
              <input
                className="fi"
                type="date"
                name="effective_date"
                defaultValue={today}
                required
              />
            </label>
            {Object.entries(currentGlobal).map(([key, value]) => (
              <label key={key}>
                {
                  (
                    {
                      telat_mulai_menit: "Telat mulai (menit)",
                      telat_blok_menit: "Blok telat (menit)",
                      telat_nominal_per_blok: "Potongan per blok (Rp)",
                      telat_maks: "Batas telat per hari (Rp, 0 tanpa batas)",
                      bolos_per_hari: "Potongan bolos per hari (Rp)",
                      lembur_per_jam: "Upah lembur per jam (Rp)",
                    } as Record<string, string>
                  )[key]
                }
                <input
                  className="fi"
                  type="number"
                  name={key}
                  min={key === "telat_blok_menit" ? 1 : 0}
                  step={key.includes("menit") ? 1 : "any"}
                  defaultValue={value}
                  required
                />
              </label>
            ))}
            {reason}
            <SubmitButton className="btn-acc" pendingText="Menyimpan…">
              Simpan versi aturan
            </SubmitButton>
          </form>
        </>
      )}
      <h3>Riwayat versi aturan</h3>
      {policies
        .slice()
        .sort(
          (a, b) =>
            b.effective_date.localeCompare(a.effective_date) ||
            (b.sequence ?? 0) - (a.sequence ?? 0),
        )
        .map((p) => (
          <p key={p.id}>
            {groupName(p.group_id)} mulai {p.effective_date} · lembur{" "}
            {rp(p.values.lembur_per_jam)}/jam · potongan bolos{" "}
            {rp(p.values.bolos_per_hari)}/hari
          </p>
        ))}
      <h3>Riwayat komponen tetap</h3>
      {fixed
        .filter((v) => v.employee_id === employee)
        .map((v) => {
          const master = masters.find((m) => m.component_id === v.component_id);
          return (
            <p key={v.id}>
              {master?.nama ?? "Komponen"} mulai {v.effective_period} ·{" "}
              {v.is_active
                ? v.nominal === null
                  ? "Mengikuti nominal master bertanggal"
                  : rp(v.nominal)
                : "Dihentikan"}
            </p>
          );
        })}
      <p>
        <Link href="/hris/komponen-gaji">Atur master dan komponen tetap</Link> ·{" "}
        <Link href="/hris/penggajian">Periksa draft dan sumber gaji</Link>
      </p>
    </div>
  );
}
