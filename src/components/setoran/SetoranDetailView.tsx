import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { muatAkses, muatDetail, muatKaryawan, muatRekening, muatSoTerakhir } from "@/lib/setoran-server";
import { pesanSetoran, type BasisSetoran } from "@/lib/setoran";
import { SetoranDashboard } from "./SetoranDashboard";
import { AksiPetugas, DaftarPengeluaran, DaftarTransfer, PanelPenyetuju, type Kunci, type UrlBukti } from "./SetoranAksi";

const KUNCI = ["pengeluaran", "transfer", "ajukan", "buang", "setujui", "tolak", "void"];

// Layar Detail Setoran (referensi Andri): dashboard di atas, input pengeluaran + setoran di bawahnya, lalu aksi.
export async function SetoranDetailView({ id, basis, error, success }: { id: string; basis: BasisSetoran; error?: string; success?: string }) {
  const supabase = await createClient();
  const akses = await muatAkses(supabase);
  const kembali = <Link href={basis} className="back-btn">← Daftar setoran</Link>;
  if (!akses.masuk) return <div className="card"><p>Anda tidak punya akses ke Rekap Setoran.</p>{kembali}</div>;
  let d;
  try { d = await muatDetail(supabase, id); } catch (e) {
    return <div className="card" role="alert"><p>{pesanSetoran(e instanceof Error ? e.message : "Setoran tidak dapat dimuat.")}</p>{kembali}</div>;
  }
  const penyetuju = akses.penyetuju && d.penyetuju;
  const kunci: Kunci = Object.fromEntries(KUNCI.map((k) => [k, crypto.randomUUID()]));
  for (const p of d.pengeluaran_baris) kunci[`hapus-${p.id}`] = crypto.randomUUID();
  for (const t of d.transfer_baris) { kunci[`hapust-${t.id}`] = crypto.randomUUID(); kunci[`putus-${t.id}`] = crypto.randomUUID(); }

  const [rekening, karyawan, so] = await Promise.all([
    muatRekening(supabase, d.branch_id),
    penyetuju ? muatKaryawan(supabase) : Promise.resolve([]),
    penyetuju && d.keuangan ? muatSoTerakhir(supabase, d.branch_id).catch(() => null) : Promise.resolve(null),
  ]);
  const paths = [...d.pengeluaran_baris.flatMap((p) => p.lampiran), ...d.transfer_baris.flatMap((t) => t.lampiran)].map((l) => l.path);
  const urls: UrlBukti = {};
  if (paths.length) {
    const { data } = await supabase.storage.from("dokumen").createSignedUrls(paths, 3600);
    for (const x of data ?? []) if (x.path && x.signedUrl) urls[x.path] = x.signedUrl;
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div>{kembali}</div>
      {error && <div className="p2ban" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{error}</div>}
      {success && <div className="p2ban" role="status" style={{ background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }}>{success}</div>}
      <SetoranDashboard detail={d} />
      <DaftarPengeluaran d={d} basis={basis} kunci={kunci} urls={urls} />
      <DaftarTransfer d={d} basis={basis} kunci={kunci} rekening={rekening} penyetuju={penyetuju} urls={urls} />
      <AksiPetugas d={d} basis={basis} kunci={kunci} />
      <PanelPenyetuju d={d} basis={basis} kunci={kunci} karyawan={karyawan} role={akses.role ?? ""} so={so} />
      {d.riwayat.length > 0 && (
        <section className="card" aria-label="Riwayat setoran">
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Riwayat</h3>
          <ul style={{ margin: "0 0 0 16px", fontSize: 12.5 }}>
            {d.riwayat.map((r, i) => <li key={i}>{new Date(r.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} · {r.jenis.replaceAll("_", " ")} · {r.oleh}{r.catatan ? ` — ${r.catatan}` : ""}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
