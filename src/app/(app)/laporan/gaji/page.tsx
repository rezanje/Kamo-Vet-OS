import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/followup";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Row = {
  id: string; gaji_pokok: number; tunjangan: number; potongan: number; total: number;
  employees: Rel<{ nama: string; jabatan: string | null; branches: Rel<{ name: string }> }>;
};

export default async function LaporanGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const periode = sp.periode || hariIniWIB().slice(0, 7);
  const cabang = sp.cabang || "";

  const supabase = await createClient();
  const [{ data }, { data: cabangList }] = await Promise.all([
    supabase.from("payrolls")
      .select("id, gaji_pokok, tunjangan, potongan, total, employees(nama, jabatan, branches(name))")
      .eq("periode", periode),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => {
      const emp = one(r.employees);
      return {
        id: r.id,
        nama: emp?.nama ?? "—",
        jabatan: emp?.jabatan ?? "—",
        cabangNama: one(emp?.branches ?? null)?.name ?? "—",
        gaji_pokok: Number(r.gaji_pokok), tunjangan: Number(r.tunjangan),
        potongan: Number(r.potongan), total: Number(r.total),
      };
    })
    .filter((r) => !cabang || r.cabangNama === cabang)
    .sort((a, b) => b.total - a.total);

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);

  // Rekap per cabang: yang paling sering ditanya bukan gaji per orang, tapi
  // beban gaji tiap cabang bulan itu.
  const perCabang = new Map<string, { orang: number; total: number }>();
  for (const r of rows) {
    const c = perCabang.get(r.cabangNama) ?? { orang: 0, total: 0 };
    c.orang++; c.total += r.total;
    perCabang.set(r.cabangNama, c);
  }

  return (
    <LaporanPage
      icon="ti-moneybag" title="REKAP GAJI"
      desc="Beban gaji per bulan, per karyawan dan per cabang."
      filter={
        <>
          <div>
            <label className="flab">Periode</label>
            <input className="fi" type="month" name="periode" defaultValue={periode} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Karyawan digaji", nilai: `${rows.length} orang` },
          { label: "Gaji pokok", nilai: rp(sum((r) => r.gaji_pokok)) },
          { label: "Tunjangan", nilai: rp(sum((r) => r.tunjangan)) },
          { label: "Potongan", nilai: rp(sum((r) => r.potongan)), warna: "#b91c1c" },
          { label: "Total dibayar", nilai: rp(sum((r) => r.total)), warna: "#15803d" },
        ]} />
      }
    >
      {perCabang.size > 1 && (
        <div className="crm-sec">
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 7 }}>
            <i className="ti ti-building-store" /> Beban gaji per cabang
          </div>
          <table className="tbl" style={{ minWidth: 420 }}>
            <thead><tr><th>Cabang</th><th style={{ width: 90, textAlign: "center" }}>Orang</th><th style={{ width: 140, textAlign: "right" }}>Total</th></tr></thead>
            <tbody>
              {[...perCabang.entries()].sort((a, b) => b[1].total - a[1].total).map(([nama, c]) => (
                <tr key={nama}>
                  <td style={{ fontSize: 11 }}>{nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{c.orang}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Karyawan</th><th style={{ width: 150 }}>Cabang</th>
                <th style={{ width: 120, textAlign: "right" }}>Gaji pokok</th>
                <th style={{ width: 110, textAlign: "right" }}>Tunjangan</th>
                <th style={{ width: 110, textAlign: "right" }}>Potongan</th>
                <th style={{ width: 130, textAlign: "right" }}>Diterima</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {r.nama}
                    <div style={{ fontSize: 9.5, color: "var(--td)" }}>{r.jabatan}</div>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.cabangNama}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.gaji_pokok)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{r.tunjangan ? rp(r.tunjangan) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.potongan ? "#b91c1c" : "var(--td)" }}>
                    {r.potongan ? `- ${rp(r.potongan)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <TabelKosong kolom={7} pesan="Belum ada slip gaji untuk periode ini. Buat dulu di HRIS → Slip Gaji." />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </LaporanPage>
  );
}
