import { labelBatas, labelPeriode, rp, tanggalPanjang, tanggalPendek, namaHari, warnaBadge, type DetailSetoran } from "@/lib/setoran";

// Dashboard "Detail Setoran" (referensi Andri 26 Nov): informasi periode, ringkasan dana setoran, rincian sumber uang per hari.
// Tampilan staf DAN penyetuju memakai komponen yang sama; komponen ini tidak pernah menampilkan lebih/selisih (bagian itu hanya di PanelPenyetuju).
const label: React.CSSProperties = { fontSize: 11.5, color: "var(--tm)" };
const nilai: React.CSSProperties = { fontSize: 15, fontWeight: 700 };

export function Badge({ teks }: { teks: string }) {
  const w = warnaBadge(teks);
  return <span data-testid="badge-setoran" style={{ background: w.bg, color: w.fg, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{teks}</span>;
}

export function SetoranDashboard({ detail: d }: { detail: DetailSetoran }) {
  const totalHarian = d.harian.reduce((a, h) => a + h.total, 0);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="card" aria-label="Informasi periode">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", textTransform: "uppercase", letterSpacing: ".04em" }}>Kas &amp; Bank / Rekap Setoran</div>
            <h2 style={{ fontSize: 18, margin: "2px 0" }}>Detail Setoran</h2>
            <div style={{ fontSize: 12.5, color: "var(--tm)" }}>{d.cabang} · {d.no_setoran}</div>
          </div>
          <Badge teks={d.badge} />
        </div>
        <h3 style={{ fontSize: 14, margin: "14px 0 8px" }}>Informasi periode</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <div><div style={label}>Jadwal setoran</div><div style={nilai}>{tanggalPanjang(d.jadwal)}</div></div>
          <div><div style={label}>Batas waktu</div><div style={nilai}>{labelBatas(d.batas_jam)}</div></div>
          <div><div style={label}>Periode transaksi</div><div style={nilai}>{labelPeriode(d.periode_mulai, d.periode_selesai)}</div><div style={{ ...label, marginTop: 2 }}>{tanggalPendek(d.periode_mulai)}{d.periode_mulai !== d.periode_selesai ? ` – ${tanggalPendek(d.periode_selesai)}` : ""}</div></div>
          <div><div style={label}>Status periode</div><div style={nilai}>{d.status_periode}</div></div>
        </div>
      </section>

      <section className="card" aria-label="Ringkasan dana setoran">
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Ringkasan dana setoran</h3>
        <div style={label}>Total kewajiban setoran dari penjualan tunai</div>
        <div data-testid="kewajiban" style={{ fontSize: 24, fontWeight: 800, margin: "2px 0 10px" }}>{rp(d.kewajiban)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: ".5px solid var(--bd)" }}>
          <span style={{ color: "var(--tm)" }}>Pengeluaran dari dana setoran</span>
          <strong data-testid="pengeluaran" style={{ color: "#dc2626" }}>- {rp(d.pengeluaran)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: ".5px solid var(--bd)" }}>
          <span style={{ color: "var(--tm)" }}>Sudah ditransfer ke perusahaan</span>
          <strong data-testid="transfer" style={{ color: "#15803d" }}>- {rp(d.transfer)}</strong>
        </div>
        <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 10, marginTop: 4 }}>
          <div style={{ ...label, textTransform: "uppercase" }}>Sisa kewajiban yang harus disetor</div>
          <div data-testid="sisa" style={{ fontSize: 24, fontWeight: 800, color: "#15803d" }}>{rp(d.sisa)}</div>
          <div role="progressbar" aria-valuenow={d.persen} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, borderRadius: 999, background: "#e5e7eb", overflow: "hidden", margin: "6px 0 4px" }}>
            <div style={{ width: `${d.persen}%`, height: "100%", background: "#16a34a" }} />
          </div>
          <div data-testid="persen" style={{ fontSize: 11.5, color: "var(--tm)" }}>{d.persen}% kewajiban sudah diselesaikan</div>
        </div>
      </section>

      <section className="card" aria-label="Rincian sumber uang setoran">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Rincian sumber uang setoran</h3>
        {d.harian.map((h) => (
          <div key={h.tanggal} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: ".5px solid var(--bd)" }}>
            <div><div style={{ fontWeight: 600 }}>{namaHari(h.tanggal)}</div><div style={label}>{tanggalPendek(h.tanggal)}</div></div>
            <strong>{rp(h.total)}</strong>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8 }}>
          <strong>Total uang tunai</strong><strong data-testid="total-harian">{rp(totalHarian)}</strong>
        </div>
        <p style={{ ...label, marginTop: 8 }}>
          Angka per hari = uang fisik tiap shift yang sudah ditutup dikurangi modal awal laci (selisih tutup shift sudah dibukukan saat tutup shift, tidak dihitung ulang di sini).
          Pengeluaran tunai yang sudah dicatat kasir saat shift sudah ada di dalam angka itu.
        </p>
        {d.pengeluaran_shift.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Pengeluaran kasir saat shift ({d.pengeluaran_shift.length}) — informasi saja</summary>
            <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5 }}>
              {d.pengeluaran_shift.map((p, i) => <li key={i}>{p.kategori}{p.deskripsi ? ` · ${p.deskripsi}` : ""} — {rp(p.jumlah)}</li>)}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
