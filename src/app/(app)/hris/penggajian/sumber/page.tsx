import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import type { InputGaji, RincianGaji } from "@/lib/payroll";
import type { BarisJual, HasilKomisi } from "@/lib/komisi";
type Snapshot = {
  input: InputGaji;
  rincian: RincianGaji;
  commission: { rows: BarisJual[]; result: HasilKomisi | null };
  components?: {
    id?: string;
    nama?: string;
    tipe: string;
    nominal: number;
    source?: string;
  }[];
  reimbursements?: {
    id: string;
    tanggal: string;
    kategori: string;
    jumlah: number;
  }[];
};
const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID")}`;
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; employee?: string }>;
}) {
  const db = await assertRole("/hris", "sumber gaji", [
      "OWNER",
      "ADMIN",
      "FINANCE",
    ]),
    sp = await searchParams;
  if (
    !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(sp.periode ?? "") ||
    !/^[0-9a-f-]{36}$/i.test(sp.employee ?? "")
  )
    return <p>Periode/karyawan tidak valid.</p>;
  const { data, error } = await db
    .from("payrolls")
    .select(
      "employee_id,periode,status,catatan,draft_version,created_at,source_snapshot,settlement_plan",
    )
    .eq("employee_id", sp.employee!)
    .eq("periode", sp.periode!)
    .maybeSingle();
  if (error || !data)
    return (
      <p role="alert">
        Sumber gaji tidak tersedia atau karyawan tidak diizinkan.
      </p>
    );
  const snap = data.source_snapshot as Snapshot | null;
  const back = `/hris/penggajian?periode=${sp.periode}`;
  if (!snap?.input || !snap.rincian)
    return (
      <div className="crm-sec">
        <Link href={back}>Kembali</Link>
        <p>
          Slip lama belum memiliki potret sumber. Angka final tetap disimpan;
          sumber historis tidak ditebak.
        </p>
      </div>
    );
  const i = snap.input,
    r = snap.rincian;
  const a = new Map(i.absen.map((x) => [x.tanggal, x])),
    leave = new Set(i.tanggalCuti);
  const days = [
    ...new Set([
      ...i.jadwal.map((x) => x.tanggal),
      ...i.absen.map((x) => x.tanggal),
      ...i.tanggalCuti,
    ]),
  ].sort();
  return (
    <div className="crm-sec">
      <Link href={back}>Kembali ke penggajian</Link>
      <h2>Sumber gaji {sp.periode}</h2>
      <p>
        {data.status === "final"
          ? "Potret saat gaji disahkan"
          : "Potret draft yang sedang diperiksa"}{" "}
        · versi {data.draft_version}
      </p>
      <p>
        Gaji pokok {rp(r.gajiPokok)} · tunjangan {rp(r.tunjangan)} · lembur
        disetujui {r.jamLembur} jam / {rp(r.upahLembur)} · komisi {rp(r.komisi)}{" "}
        · reimburse {rp(r.reimburse)} · koreksi {rp(r.penyesuaian)} · bersih{" "}
        {rp(r.total)}
      </p>
      {data.catatan && <p>Alasan penyesuaian: {data.catatan}</p>}
      <h3>Jadwal dan kehadiran</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Jadwal masuk</th>
            <th>Absen masuk</th>
            <th>Cuti/izin/sakit disetujui</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const shift = i.jadwal.find((x) => x.tanggal === d);
            return (
              <tr key={d}>
                <td>{d}</td>
                <td>
                  {shift?.isLibur
                    ? "Libur"
                    : (shift?.jamMasuk ?? "Tidak dijadwalkan")}
                </td>
                <td>{a.get(d)?.jamMasuk ?? "Tidak ada"}</td>
                <td>{leave.has(d) ? "Ya" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Potongan telat {rp(r.potonganTelat)} · potongan bolos{" "}
        {rp(r.potonganBolos)}.
      </p>
      <h3>Aturan tersimpan per tanggal</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Mulai telat (menit)</th>
            <th>Blok (menit)</th>
            <th>Potongan/blok</th>
            <th>Batas telat/hari</th>
            <th>Bolos/hari</th>
            <th>Tarif lembur/jam</th>
          </tr>
        </thead>
        <tbody>
          {(i.aturanPerTanggal
            ? Object.entries(i.aturanPerTanggal).sort(([a], [b]) =>
                a.localeCompare(b),
              )
            : [["Aturan tersimpan (tanpa tanggal)", i.aturan] as const]
          ).map(([date, rule]) => (
            <tr key={date}>
              <td>{date}</td>
              <td>{rule.telat_mulai_menit}</td>
              <td>{rule.telat_blok_menit}</td>
              <td>{rp(rule.telat_nominal_per_blok)}</td>
              <td>{rule.telat_maks ? rp(rule.telat_maks) : "tanpa batas"}</td>
              <td>{rp(rule.bolos_per_hari)}</td>
              <td>{rp(rule.lembur_per_jam)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Lembur disetujui per tanggal</h3>
      {i.lemburPerTanggal ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Jam disetujui</th>
              <th>Tarif/jam</th>
            </tr>
          </thead>
          <tbody>
            {i.lemburPerTanggal.map((l, n) => (
              <tr key={n}>
                <td>{l.tanggal}</td>
                <td>{l.jam}</td>
                <td>
                  {rp(
                    (i.aturanPerTanggal?.[l.tanggal] ?? i.aturan)
                      .lembur_per_jam,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          Potret lama menyimpan total {i.jamLembur} jam tanpa rincian tanggal.
        </p>
      )}
      <h3>Komponen tetap dan komponen periode</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Komponen</th>
            <th>Jenis</th>
            <th>Sumber</th>
            <th>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {(snap.components ?? i.komponen).map((c, n) => (
            <tr key={n}>
              <td>{"nama" in c ? c.nama : "Komponen tersimpan"}</td>
              <td>{c.tipe}</td>
              <td>
                {"source" in c
                  ? c.source === "fixed"
                    ? "Komponen tetap"
                    : c.source === "period" || c.source === "variable"
                      ? "Komponen periode"
                      : "Sumber lama"
                  : "Sumber lama"}
              </td>
              <td>{rp(c.nominal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Reimburse yang masuk slip</h3>
      {snap.reimbursements ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Pengajuan</th>
              <th>Kategori</th>
              <th>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {snap.reimbursements.map((c) => (
              <tr key={c.id}>
                <td>{c.tanggal}</td>
                <td>{c.id}</td>
                <td>{c.kategori}</td>
                <td>{rp(c.jumlah)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Potret lama tidak menyimpan rincian pengajuan.</p>
      )}
      <h3>Cicilan yang benar-benar dipotong</h3>
      {r.cicilanPerKasbon.length ? (
        r.cicilanPerKasbon.map((c) => (
          <p key={c.id}>
            {c.id} · {rp(c.jumlah)}
          </p>
        ))
      ) : (
        <p>Tidak ada cicilan yang tertutup gaji.</p>
      )}
      <h3>Komisi per aturan</h3>
      {snap.commission?.result?.rincian.map((c) => (
        <p key={c.aturanId}>
          {c.nama}: dasar {Number(c.dasar).toLocaleString("id-ID")} ·{" "}
          {rp(c.komisi)} ·{" "}
          {c.cair ? "Memenuhi ambang" : "Belum memenuhi ambang"}
        </p>
      ))}
      <h3>Aktivitas sumber komisi</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Sumber</th>
            <th>Jumlah</th>
            <th>Omzet</th>
            <th>Laba diketahui</th>
          </tr>
        </thead>
        <tbody>
          {snap.commission?.rows.map((x, n) => (
            <tr key={n}>
              <td>{x.tanggal}</td>
              <td>{x.sumber}</td>
              <td>{x.qty}</td>
              <td>{rp(x.omzet)}</td>
              <td>{x.laba === null ? "Tidak diketahui" : rp(x.laba)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
