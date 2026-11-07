import Link from "next/link";
import { infoStatusRacikan, type RacikanKunjungan } from "./racikan-pasien";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Bagian "Racikan pasien ini" di detail rawat inap: status tiap racikan dan jalan langsung ke
 * Kembalikan bahan (void racikan). `recipes` null = bacaan gagal (bukan "belum ada"). Server component. */
export function RacikanPasien({ recipes }: { recipes: RacikanKunjungan[] | null }) {
  return <section id="racikan-pasien" className="crm-sec" aria-label="Racikan pasien ini">
    <h3 style={{ fontSize: 13, fontWeight: 700 }}>Racikan pasien ini</h3>
    {recipes === null && <p role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>Daftar racikan tidak terbaca. Muat ulang halaman; bila tetap gagal, buka menu Klinik &gt; Racik obat.</p>}
    {recipes !== null && recipes.length === 0 && <p style={{ fontSize: 12, color: "var(--tm)" }}>Belum ada racikan untuk kunjungan ini.</p>}
    {recipes?.map(row => {
      const info = infoStatusRacikan(row.status);
      return <article key={row.id} data-racikan-id={row.id} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10, marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{row.recipe_name}</div>
          <div style={{ fontSize: 11, color: "var(--tm)" }}>Status: {info.label}{fmt(row.created_at) ? ` · ${fmt(row.created_at)}` : ""}</div>
          {info.bisaAksi
            ? <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>Bila kunjungan ini sudah punya DP/pembayaran, sistem akan menolak dengan penjelasan; bahan dikembalikan hanya bila belum ditagih.</div>
            : <div style={{ fontSize: 11, color: "var(--td)", marginTop: 2 }}>{info.alasan}</div>}
        </div>
        {info.bisaAksi && <Link href={`/klinik/racik/${encodeURIComponent(row.id)}#aksi`} className="btn-def" style={{ textDecoration: "none", color: "#b91c1c", borderColor: "#fca5a5" }}>
          <i className="ti ti-arrow-back-up" /> Koreksi / Kembalikan bahan
        </Link>}
      </article>;
    })}
  </section>;
}
