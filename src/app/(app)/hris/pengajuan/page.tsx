import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ALASAN_SELISIH_KAS } from "@/lib/kasbon";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { jadwalCicilan } from "@/lib/kasbon";
import { getAturanGaji } from "@/lib/payroll-aturan";
import {
  setujuiKasbon, setujuiLembur, setujuiReimburse,
  tolakKasbon, tolakLembur, tolakReimburse,
} from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
type Emp = { nama: string; jabatan: string | null };

export default async function PengajuanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: lemburData }, { data: kasbonData }, { data: reimData }, rekening, aturan] = await Promise.all([
    supabase.from("overtime_requests")
      .select("id, tanggal, jam, alasan, status, employees(nama, jabatan)")
      .eq("status", "Menunggu").order("tanggal"),
    supabase.from("cash_advances")
      .select("id, tanggal, jumlah, tenor_bulan, alasan, status, employees(nama, jabatan)")
      .eq("status", "Menunggu").order("tanggal"),
    supabase.from("reimbursements")
      .select("id, tanggal, kategori, jumlah, keterangan, status, employees(nama, jabatan)")
      .eq("status", "Menunggu").order("tanggal"),
    loadRekeningAktif(supabase),
    getAturanGaji(supabase),
  ]);

  // Utang berjalan yang SUDAH disetujui — termasuk utang selisih kas yang lahir
  // otomatis saat tutup shift. Tanpa daftar ini, utang itu tidak terlihat oleh HR
  // maupun keuangan sama sekali: satu-satunya yang bisa melihatnya adalah
  // karyawannya sendiri di layar /me.
  const { data: berjalanData } = await supabase
    .from("cash_advances")
    .select("id, tanggal, jumlah, tenor_bulan, alasan, employees(nama, jabatan), cash_advance_installments(jumlah)")
    .eq("status", "Disetujui").order("tanggal", { ascending: false });

  const lembur = (lemburData ?? []) as unknown as { id: string; tanggal: string; jam: number; alasan: string | null; employees: Rel<Emp> }[];
  const kasbon = (kasbonData ?? []) as unknown as { id: string; tanggal: string; jumlah: number; tenor_bulan: number; alasan: string | null; employees: Rel<Emp> }[];
  const reimburse = (reimData ?? []) as unknown as { id: string; tanggal: string; kategori: string; jumlah: number; keterangan: string | null; employees: Rel<Emp> }[];
  const total = lembur.length + kasbon.length + reimburse.length;

  const berjalan = ((berjalanData ?? []) as unknown as {
    id: string; tanggal: string; jumlah: number; tenor_bulan: number; alasan: string | null;
    employees: Rel<Emp>; cash_advance_installments: { jumlah: number }[] | null;
  }[]).map((k) => {
    const dibayar = (k.cash_advance_installments ?? []).reduce((a, i) => a + Number(i.jumlah), 0);
    return { ...k, dibayar, sisa: Math.max(0, Number(k.jumlah) - dibayar) };
  }).filter((k) => k.sisa > 0);
  const totalSisa = berjalan.reduce((a, k) => a + k.sisa, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pengajuan Karyawan</span>
        <span className={`bge ${total > 0 ? "o" : "g"}`}>{total} menunggu</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Keputusan tersimpan.
        </div>
      )}
      {!bolehKelola && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-lock" /> Hanya OWNER/ADMIN yang bisa menyetujui pengajuan.
        </div>
      )}

      {/* ── Lembur ─────────────────────────────────────────────── */}
      <div className="crm-sec">
        <SecHeader
          num="01" title="LEMBUR"
          desc={aturan.lembur_per_jam > 0
            ? `Upah lembur ${rp(aturan.lembur_per_jam)}/jam sesuai Aturan Gaji.`
            : "Upah lembur per jam belum diatur — isi dulu di Pengaturan → Aturan gaji, kalau tidak lembur bernilai nol."}
        />
        {lembur.length === 0 ? (
          <Kosong teks="Tidak ada pengajuan lembur." />
        ) : lembur.map((l) => (
          <form key={l.id} action={setujuiLembur} style={barisStyle}>
            <div style={{ flex: "1 1 240px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{one(l.employees)?.nama ?? "—"}</div>
              <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
                {tgl(l.tanggal)} · {Number(l.jam)} jam
                {aturan.lembur_per_jam > 0 && <> · <b>{rp(Number(l.jam) * aturan.lembur_per_jam)}</b></>}
                {l.alasan ? ` · ${l.alasan}` : ""}
              </div>
            </div>
            <input type="hidden" name="id" value={l.id} />
            <input className="fi" name="catatan" placeholder="catatan (opsional)" style={{ width: 180, height: 28, fontSize: 10.5 }} />
            <Tombol bolehKelola={bolehKelola} tolak={tolakLembur} />
          </form>
        ))}
      </div>

      {/* ── Kasbon ─────────────────────────────────────────────── */}
      <div className="crm-sec">
        <SecHeader
          num="02" title="KASBON"
          desc="Disetujui = uang cair saat itu juga & tercatat sebagai piutang karyawan. Cicilan otomatis kepotong di slip gaji."
        />
        {kasbon.length === 0 ? (
          <Kosong teks="Tidak ada pengajuan kasbon." />
        ) : kasbon.map((k) => (
          <form key={k.id} action={setujuiKasbon} style={barisStyle}>
            <div style={{ flex: "1 1 220px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{one(k.employees)?.nama ?? "—"}</div>
              <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
                {tgl(k.tanggal)} · <b>{rp(Number(k.jumlah))}</b>
                {" · usul "}{k.tenor_bulan}× {rp(jadwalCicilan(Number(k.jumlah), k.tenor_bulan)[0] ?? 0)}/bln
                {k.alasan ? ` · ${k.alasan}` : ""}
              </div>
            </div>
            <input type="hidden" name="id" value={k.id} />
            <div>
              <label className="flab">Cicil (bulan)</label>
              <input className="fi" name="tenor_bulan" type="number" min={1} max={24} step={1}
                defaultValue={k.tenor_bulan} style={{ width: 90, height: 28, fontSize: 10.5 }} />
            </div>
            <PilihRekening rekening={rekening} label="Uang keluar dari" width={150} />
            <input className="fi" name="catatan" placeholder="catatan (opsional)" style={{ width: 150, height: 28, fontSize: 10.5 }} />
            <Tombol bolehKelola={bolehKelola} tolak={tolakKasbon} labelSetuju="Setujui &amp; cairkan" />
          </form>
        ))}
      </div>

      {/* ── Reimburse ──────────────────────────────────────────── */}
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="03" title="REIMBURSE"
          desc="Yang disetujui dibayarkan bersama gaji periode berjalan."
        />
        {reimburse.length === 0 ? (
          <Kosong teks="Tidak ada pengajuan reimburse." />
        ) : reimburse.map((r) => (
          <form key={r.id} action={setujuiReimburse} style={barisStyle}>
            <div style={{ flex: "1 1 240px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{one(r.employees)?.nama ?? "—"}</div>
              <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
                {tgl(r.tanggal)} · {r.kategori} · <b>{rp(Number(r.jumlah))}</b>
                {r.keterangan ? ` · ${r.keterangan}` : ""}
              </div>
            </div>
            <input type="hidden" name="id" value={r.id} />
            <input className="fi" name="catatan" placeholder="catatan (opsional)" style={{ width: 180, height: 28, fontSize: 10.5 }} />
            <Tombol bolehKelola={bolehKelola} tolak={tolakReimburse} />
          </form>
        ))}
      </div>

      {/* ── Utang berjalan ─────────────────────────────────────── */}
      <div className="crm-sec" style={{ marginBottom: 0, marginTop: 14 }}>
        <SecHeader
          num="04" title="UTANG KARYAWAN BERJALAN"
          desc="Kasbon & selisih kas yang belum lunas. Dipotong otomatis dari gaji periode berikutnya."
        />
        {berjalan.length === 0 ? (
          <Kosong teks="Tidak ada utang karyawan yang berjalan." />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th style={{ width: 96 }}>Tanggal</th>
                    <th>Asal</th>
                    <th style={{ width: 110, textAlign: "right" }}>Jumlah</th>
                    <th style={{ width: 110, textAlign: "right" }}>Sudah dibayar</th>
                    <th style={{ width: 110, textAlign: "right" }}>Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {berjalan.map((k) => {
                    const dariSelisih = String(k.alasan ?? "").startsWith(ALASAN_SELISIH_KAS);
                    return (
                      <tr key={k.id}>
                        <td style={{ fontSize: 11.5, fontWeight: 600 }}>{one(k.employees)?.nama ?? "—"}</td>
                        <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl(k.tanggal)}</td>
                        <td style={{ fontSize: 10.5 }}>
                          <span className={`bge ${dariSelisih ? "o" : "b"}`} style={{ fontSize: 9 }}>
                            {dariSelisih ? "Selisih kas" : "Kasbon"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(k.jumlah))}</td>
                        <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(k.dibayar)}</td>
                        <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(k.sisa)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ fontSize: 11.5, fontWeight: 800 }}>TOTAL SISA</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totalSisa)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
              Utang bertanda <b>Selisih kas</b> lahir otomatis saat tutup shift dan tidak
              menghalangi karyawan mengajukan kasbon sendiri.
            </div>
          </>
        )}
      </div>
    </>
  );
}

const barisStyle: React.CSSProperties = {
  display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap",
  padding: "8px 0", borderBottom: ".5px solid var(--bd)",
};

function Kosong({ teks }: { teks: string }) {
  return <div style={{ fontSize: 11, color: "var(--td)", padding: "6px 0" }}>{teks}</div>;
}

// Tombol "Tolak" memakai formAction sendiri — nama/value tombol submit tidak
// terkirim ke server action, jadi keputusan tidak boleh dititipkan ke sana.
function Tombol({
  bolehKelola, tolak, labelSetuju = "Setujui",
}: {
  bolehKelola: boolean;
  tolak: (formData: FormData) => Promise<void>;
  labelSetuju?: string;
}) {
  if (!bolehKelola) return null;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <SubmitButton className="btn-acc"
        style={{ background: "#16a34a", padding: "5px 10px", fontSize: 10.5 }} pendingText="…">
        {labelSetuju}
      </SubmitButton>
      <SubmitButton className="btn-def" formAction={tolak}
        style={{ padding: "5px 10px", fontSize: 10.5 }} pendingText="…">
        Tolak
      </SubmitButton>
    </div>
  );
}
