import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { TabelKosong } from "@/components/LaporanPage";
import { JENIS_PERSETUJUAN, PERAN_PENYETUJU, labelJenis } from "@/lib/persetujuan";
import {
  hapusAturanPersetujuan, setujuiPengajuan, tambahAturanPersetujuan, tolakPengajuan, ubahStatusAturan,
} from "./actions";

// Penyetuju Transaksi (S6) — aturan "berapa nilai yang boleh dilepas tanpa bertanya"
// plus antrean pengajuan yang menunggu keputusan.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const waktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });

const WARNA_STATUS: Record<string, string> = {
  menunggu: "#b45309", disetujui: "#15803d", ditolak: "#b91c1c", terpakai: "var(--td)",
};

export default async function PenyetujuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me) redirect("/login");

  const peranSaya = String(me.role);
  const bolehAtur = ["OWNER", "ADMIN"].includes(peranSaya);

  const [{ data: rulesRaw }, { data: reqRaw }, { data: profiles }] = await Promise.all([
    supabase.from("approval_rules")
      .select("id, jenis, min_nilai, penyetuju_role, is_active")
      .order("jenis").order("min_nilai"),
    supabase.from("approval_requests")
      .select("id, jenis, ref_id, no_dokumen, nilai, keterangan, penyetuju_role, status, diajukan_oleh, diajukan_at, diputus_at, catatan")
      .order("diajukan_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name"),
  ]);

  type Rule = { id: string; jenis: string; min_nilai: number; penyetuju_role: string; is_active: boolean };
  type Req = {
    id: string; jenis: string; no_dokumen: string | null; nilai: number; keterangan: string | null;
    penyetuju_role: string; status: string; diajukan_oleh: string | null; diajukan_at: string;
    diputus_at: string | null; catatan: string | null;
  };

  const aturan = (rulesRaw ?? []) as Rule[];
  const pengajuan = (reqRaw ?? []) as Req[];
  const nama = new Map(((profiles ?? []) as { id: string; full_name: string | null }[])
    .map((p) => [p.id, p.full_name || "(tanpa nama)"]));

  const menunggu = pengajuan.filter((r) => r.status === "menunggu");
  const riwayat = pengajuan.filter((r) => r.status !== "menunggu");
  const bolehPutuskan = (r: Req) => peranSaya === "OWNER" || peranSaya === r.penyetuju_role;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penyetuju Transaksi</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}>
          <i className="ti ti-check" /> {success}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title={`MENUNGGU PERSETUJUAN (${menunggu.length})`}
          desc="Transaksi yang nilainya melewati batas dan ditahan sampai disetujui."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 940 }}>
            <thead>
              <tr>
                <th style={{ width: 170 }}>Jenis</th>
                <th>Keterangan</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 140 }}>Diajukan</th>
                <th style={{ width: 100 }}>Penyetuju</th>
                <th style={{ width: 250 }}>Keputusan</th>
              </tr>
            </thead>
            <tbody>
              {menunggu.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelJenis(r.jenis)}</td>
                  <td style={{ fontSize: 11 }}>
                    {r.keterangan ?? r.no_dokumen ?? "—"}
                    <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                      oleh {r.diajukan_oleh ? nama.get(r.diajukan_oleh) ?? "(akun terhapus)" : "—"}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(Number(r.nilai))}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{waktu(r.diajukan_at)}</td>
                  <td style={{ fontSize: 10.5, fontWeight: 600 }}>{r.penyetuju_role}</td>
                  <td>
                    {bolehPutuskan(r) ? (
                      <form action={setujuiPengajuan} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input className="fi" name="catatan" placeholder="alasan (wajib kalau menolak)"
                          style={{ fontSize: 10.5, width: 130 }} />
                        <button type="submit" className="btn-acc"
                          style={{ fontSize: 10.5, padding: "5px 9px" }}>Setujui</button>
                        <button type="submit" formAction={tolakPengajuan} className="btn-def"
                          style={{ fontSize: 10.5, padding: "5px 9px", color: "#b91c1c" }}>Tolak</button>
                      </form>
                    ) : (
                      <span style={{ fontSize: 10.5, color: "var(--td)" }}>menunggu {r.penyetuju_role}</span>
                    )}
                  </td>
                </tr>
              ))}
              {menunggu.length === 0 && (
                <TabelKosong kolom={6} pesan="Tidak ada transaksi yang menunggu persetujuan." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.7 }}>
          Transaksi yang ditahan TIDAK tersimpan setengah jalan — tidak ada jurnal, tidak ada
          nomor bukti, tidak ada uang muka yang terpakai. Setelah disetujui, yang mengajukan
          tinggal mengulangi transaksinya dan kali itu langsung lewat.
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="ATURAN PERSETUJUAN"
          desc="Di atas nilai berapa sebuah transaksi harus minta izin, dan ke siapa."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Jenis transaksi</th>
                <th style={{ width: 180, textAlign: "right" }}>Perlu izin di atas</th>
                <th style={{ width: 130 }}>Disetujui oleh</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 170 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {aturan.map((r) => (
                <tr key={r.id} style={r.is_active ? undefined : { opacity: .55 }}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelJenis(r.jenis)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(Number(r.min_nilai))}</td>
                  <td style={{ fontSize: 11 }}>{r.penyetuju_role}</td>
                  <td style={{ fontSize: 10.5, fontWeight: 600, color: r.is_active ? "#15803d" : "var(--td)" }}>
                    {r.is_active ? "aktif" : "mati"}
                  </td>
                  <td>
                    {bolehAtur && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <form action={ubahStatusAturan}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="aktif" value={r.is_active ? "0" : "1"} />
                          <button type="submit" className="btn-def" style={{ fontSize: 10.5, padding: "5px 9px" }}>
                            {r.is_active ? "Matikan" : "Nyalakan"}
                          </button>
                        </form>
                        <form action={hapusAturanPersetujuan}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="btn-def" style={{ fontSize: 10.5, padding: "5px 9px", color: "#b91c1c" }}>
                            Hapus
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {aturan.length === 0 && (
                <TabelKosong kolom={5} pesan="Belum ada aturan — semua transaksi jalan tanpa persetujuan." />
              )}
            </tbody>
          </table>
        </div>

        {bolehAtur && (
          <form action={tambahAturanPersetujuan}
            style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
            <div style={{ minWidth: 220 }}>
              <label className="flab">Jenis transaksi</label>
              <select className="fi" name="jenis" defaultValue={JENIS_PERSETUJUAN[0].jenis}>
                {JENIS_PERSETUJUAN.map((j) => <option key={j.jenis} value={j.jenis}>{j.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Perlu izin di atas (Rp)</label>
              <input className="fi" type="number" name="min_nilai" min={0} step={100000} defaultValue={5000000} style={{ width: 160 }} />
            </div>
            <div>
              <label className="flab">Disetujui oleh</label>
              <select className="fi" name="penyetuju_role" defaultValue="OWNER">
                {PERAN_PENYETUJU.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-acc"><i className="ti ti-plus" /> Tambah aturan</button>
          </form>
        )}

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10, lineHeight: 1.7 }}>
          Kalau ada beberapa aturan yang sama-sama kena, yang dipakai adalah yang AMBANGNYA
          PALING TINGGI — jadi &quot;di atas 50 juta harus OWNER&quot; tetap berlaku walau ada
          aturan &quot;di atas 1 juta cukup ADMIN&quot;.<br />
          Aturan ini menjaga nilai transaksi, bukan hak membuka layar. Siapa boleh membuka
          menu apa tetap diatur di Akses Grup.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="03" title="RIWAYAT KEPUTUSAN" desc="Pengajuan yang sudah diputuskan atau sudah dipakai." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 170 }}>Jenis</th>
                <th>Keterangan</th>
                <th style={{ width: 130, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 130 }}>Diputus</th>
                <th style={{ width: 180 }}>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {riwayat.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11 }}>{labelJenis(r.jenis)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.keterangan ?? r.no_dokumen ?? "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(r.nilai))}</td>
                  <td style={{ fontSize: 10.5, fontWeight: 700, color: WARNA_STATUS[r.status] ?? "var(--tm)" }}>
                    {r.status}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.diputus_at ? waktu(r.diputus_at) : "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.catatan ?? "—"}</td>
                </tr>
              ))}
              {riwayat.length === 0 && <TabelKosong kolom={6} pesan="Belum ada keputusan." />}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
