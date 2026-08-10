import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Slip = {
  employee_id: string; gaji_pokok: number; tunjangan: number; potongan: number; total: number;
  hari_kerja: number; hari_hadir: number; hari_bolos: number; menit_telat: number;
  jam_lembur: number; upah_lembur: number; potongan_telat: number; potongan_bolos: number;
  cicilan_kasbon: number; reimburse: number; komisi: number; penyesuaian: number; catatan: string | null;
  status: string;
  employees: Rel<{ nama: string; nik: string | null; jabatan: string | null; branches: Rel<{ name: string }> }>;
};

export default async function SlipPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : hariIniWIB().slice(0, 7);
  const supabase = await createClient();

  const { data } = await supabase
    .from("payrolls")
    .select("employee_id, gaji_pokok, tunjangan, potongan, total, hari_kerja, hari_hadir, hari_bolos, menit_telat, jam_lembur, upah_lembur, potongan_telat, potongan_bolos, cicilan_kasbon, reimburse, komisi, penyesuaian, catatan, status, employees(nama, nik, jabatan, branches(name))")
    .eq("periode", periode);

  const slip = ((data ?? []) as unknown as Slip[])
    .sort((a, b) => (one(a.employees)?.nama ?? "").localeCompare(one(b.employees)?.nama ?? ""));

  const namaBulan = new Date(`${periode}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href={`/hris/penggajian?periode=${periode}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Slip Gaji {namaBulan}</span>
        <span style={{ marginLeft: "auto" }}><PrintButton label="Cetak semua slip" /></span>
      </div>

      {slip.length === 0 && (
        <div className="crm-sec" style={{ fontSize: 11, color: "var(--td)" }}>
          Belum ada perhitungan gaji untuk periode ini.
        </div>
      )}

      {slip.map((s) => {
        const emp = one(s.employees);
        const cabang = one(emp?.branches ?? null);
        const potongan = Number(s.potongan_telat) + Number(s.potongan_bolos);
        return (
          // Tiap slip mulai di halaman baru saat dicetak.
          <div key={s.employee_id} className="crm-sec" style={{ breakInside: "avoid", pageBreakAfter: "always" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #16213e", paddingBottom: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--sb)" }}>SLIP GAJI</div>
                <div style={{ fontSize: 11, color: "var(--tm)" }}>PT Kamo Group · periode {namaBulan}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11 }}>
                <div style={{ fontWeight: 700 }}>{emp?.nama ?? "—"}</div>
                <div style={{ color: "var(--tm)" }}>
                  {emp?.nik ? `NIK ${emp.nik} · ` : ""}{emp?.jabatan ?? "—"}
                </div>
                <div style={{ color: "var(--tm)" }}>{cabang?.name ?? "—"}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 10.5, color: "var(--tm)", marginBottom: 10 }}>
              <span>Hari kerja: <b>{s.hari_kerja}</b></span>
              <span>Hadir: <b>{s.hari_hadir}</b></span>
              <span>Tidak hadir: <b>{s.hari_bolos}</b></span>
              <span>Total telat: <b>{s.menit_telat} menit</b></span>
              <span>Lembur: <b>{Number(s.jam_lembur)} jam</b></span>
            </div>

            <div className="grid2" style={{ alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 6, color: "#15803d" }}>PENERIMAAN</div>
                <Baris k="Gaji pokok" v={rp(s.gaji_pokok)} />
                <Baris k="Tunjangan tetap" v={rp(s.tunjangan)} />
                <Baris k={`Upah lembur (${Number(s.jam_lembur)} jam)`} v={rp(s.upah_lembur)} />
                <Baris k="Penggantian (reimburse)" v={rp(s.reimburse)} />
                <Baris k="Komisi penjualan" v={rp(s.komisi)} />
                {Number(s.penyesuaian) !== 0 && (
                  <Baris k={`Penyesuaian${s.catatan ? ` — ${s.catatan}` : ""}`} v={rp(s.penyesuaian)} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 6, color: "#b91c1c" }}>POTONGAN</div>
                <Baris k={`Keterlambatan (${s.menit_telat} menit)`} v={rp(s.potongan_telat)} />
                <Baris k={`Tidak hadir (${s.hari_bolos} hari)`} v={rp(s.potongan_bolos)} />
                <Baris k="Cicilan kasbon" v={rp(s.cicilan_kasbon)} />
                {/* potongan = seluruh potongan; sisanya setelah telat/bolos/kasbon = potongan tetap komponen */}
                <Baris k="Potongan tetap" v={rp(Math.max(0,
                  Number(s.potongan) - potongan - Number(s.cicilan_kasbon)))} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "2px solid #16213e" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>GAJI DITERIMA</span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{rp(s.total)}</span>
            </div>

            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
              {s.status === "final"
                ? "Slip ini sudah disahkan dan dibukukan."
                : "DRAFT — belum disahkan, angka masih bisa berubah."}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Baris({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
      <span style={{ color: "var(--tm)" }}>{k}</span><span>{v}</span>
    </div>
  );
}
